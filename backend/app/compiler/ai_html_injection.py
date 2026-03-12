"""
AI-powered HTML Span Injection Agent

Uses LangGraph workflow with Claude to inject <span class="kg-entity"> tags into HTML.
This agent processes sections in sequence, using structured outputs for reliable span placement.

Pipeline:
1. Initialize - Parse HTML and prepare entity list
2. Process Sections - For each section, use LLM to inject spans
3. Validate & Apply - Validate text integrity and apply changes
4. Finalize - Return modified HTML with injection stats
"""

import os
import re
from typing import TypedDict, List, Dict, Any, Tuple
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from langchain_core.prompts import ChatPromptTemplate
from backend.app.llm import AIConfig, TASK_HTML_INJECTION, create_chat_model

# Import shared utilities
from backend.app.agents.utils import (
    TimeoutException,
    run_with_retry,
    strip_html_tags,
    filter_processable_sections,
    get_debug_flag,
)

load_dotenv()


# =============================================================================
# Configuration
# =============================================================================

def _get_worker_count() -> int:
    """Get the number of parallel workers from environment variable."""
    return int(os.getenv("KG_WORKERS", "4"))


# =============================================================================
# State Schema
# =============================================================================

class InjectionState(TypedDict):
    """Shared state for HTML injection workflow"""
    # Input
    html_content: str
    sections_data: List[Dict[str, Any]]
    suggestions: List[Dict[str, Any]]

    # Processed entity list
    entities: List[Dict[str, str]]

    # Tracking
    current_html: str
    sections_processed: int
    sections_total: int

    # Output
    modified_html: str
    injection_count: int
    errors: List[str]
    ai_config: AIConfig | Dict[str, Any] | None


# =============================================================================
# Pydantic Models for Structured Output
# =============================================================================

class SpanInjection(BaseModel):
    """A single span injection location"""
    original_text: str = Field(
        description="The exact text fragment to wrap (must match exactly in the HTML)"
    )
    entity_id: str = Field(
        description="The entity_id to use in data-entity-id attribute"
    )
    entity_type: str = Field(
        description="The entity_type to use in data-entity-type attribute"
    )


class SectionInjectionOutput(BaseModel):
    """Output from section injection - list of spans to inject"""
    injections: List[SpanInjection] = Field(
        default_factory=list,
        description="List of text spans to wrap with kg-entity tags"
    )
    reasoning: str = Field(
        description="Brief explanation of which terms were found and wrapped"
    )


# =============================================================================
# Prompt Templates
# =============================================================================

INJECTION_SYSTEM_PROMPT = """You are an HTML annotation assistant. Your task is to identify text spans in HTML content that should be wrapped with semantic annotation tags.

You will be given:
1. HTML content from a research paper section
2. A list of entities (terms) to find and annotate

For each entity term that appears in the TEXT CONTENT of the HTML:
1. Find the exact text as it appears (case-insensitive matching is OK, but return the exact text from the HTML)
2. Report it for annotation with the corresponding entity_id and entity_type

IMPORTANT RULES:
- Only match terms in the visible TEXT content, not in HTML attributes or tag names
- Do NOT match text inside <math>, <mi>, <mo>, <annotation> or other MathML tags
- Do NOT match text that is already inside a <span class="kg-entity"> tag
- Match whole words/phrases only (don't match "the" inside "theorem")
- Return the EXACT text as it appears in the HTML (preserve case)
- If a term appears multiple times, report each occurrence separately

Example:
If looking for "gradient descent" in "We use Gradient Descent for optimization. The gradient descent method..."
Report two injections:
1. original_text: "Gradient Descent", entity_id: "def_gradient_descent", entity_type: "definition"
2. original_text: "gradient descent", entity_id: "def_gradient_descent", entity_type: "definition"
"""

INJECTION_USER_PROMPT = """HTML Content:
```html
{html_content}
```

Entities to find and annotate:
{entity_list}

Find all occurrences of these entity terms in the text content and report them for annotation."""


# =============================================================================
# Agent Functions
# =============================================================================

def initialize_injection(state: InjectionState) -> InjectionState:
    """
    Initialize the injection workflow.

    Prepares entity list and validates inputs.
    """
    print(f"[HTML Injection] Initializing...")

    # Build entity list from suggestions
    entities = []
    for s in state["suggestions"]:
        label = s.get("entity_label")
        if label and len(label) >= 2:  # Skip single-char entities
            entities.append({
                "label": label,
                "entity_id": s.get("entity_id", ""),
                "entity_type": s.get("entity_type", "unknown")
            })

    # Count processable sections using shared utility
    sections_total = len(filter_processable_sections(state["sections_data"]))

    print(f"[HTML Injection] Found {len(entities)} entities to inject across {sections_total} sections")

    return {
        **state,
        "entities": entities,
        "current_html": state["html_content"],
        "sections_processed": 0,
        "sections_total": sections_total,
        "injection_count": 0,
        "errors": [],
    }


def process_sections(state: InjectionState) -> InjectionState:
    """
    Process all sections using LLM to identify injection points.

    For each section:
    1. Extract content_html and convert to plain text for LLM
    2. Use LLM to find entity occurrences
    3. Apply injections directly to the parsed HTML DOM

    Entities are processed in batches of 10 to avoid overwhelming the LLM.
    """
    if not state["entities"]:
        print("[HTML Injection] No entities to inject, skipping")
        return {
            **state,
            "modified_html": state["current_html"],
        }

    # Batch size for processing entities
    BATCH_SIZE = 10
    total_entities = len(state["entities"])
    num_batches = (total_entities + BATCH_SIZE - 1) // BATCH_SIZE  # Ceiling division

    if num_batches > 1:
        print(f"[HTML Injection] Processing {total_entities} entities in {num_batches} batches of {BATCH_SIZE}")

    llm = create_chat_model(
        task=TASK_HTML_INJECTION,
        config=state.get("ai_config"),
        max_tokens=8000,
    )
    structured_llm = llm.with_structured_output(SectionInjectionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", INJECTION_SYSTEM_PROMPT),
        ("user", INJECTION_USER_PROMPT)
    ])

    chain = prompt | structured_llm

    # Parse the full HTML document once - we'll modify this DOM directly
    soup = BeautifulSoup(state["current_html"], 'html.parser')

    errors = list(state["errors"])
    total_injections = 0
    sections_processed = 0

    debug = get_debug_flag("HTML_INJECTION_DEBUG")
    worker_count = _get_worker_count()

    # Filter sections using shared utility
    sections_to_process = filter_processable_sections(state["sections_data"])

    # Process entities in batches
    for batch_idx in range(num_batches):
        start_idx = batch_idx * BATCH_SIZE
        end_idx = min(start_idx + BATCH_SIZE, total_entities)
        entity_batch = state["entities"][start_idx:end_idx]

        if num_batches > 1:
            print(f"\n[HTML Injection] === Batch {batch_idx + 1}/{num_batches}: Processing entities {start_idx + 1}-{end_idx} ===")

        # Format entity list for prompt (only current batch)
        entity_list_str = "\n".join(
            f"- Term: \"{e['label']}\" → entity_id: \"{e['entity_id']}\", entity_type: \"{e['entity_type']}\""
            for e in entity_batch
        )

        print(f"[HTML Injection] Processing {len(sections_to_process)} sections with {len(entity_batch)} entities...")

        def process_section(idx_section):
            """Process a single section (for parallel execution)."""
            idx, section = idx_section
            content_html = section.get("content_html", "")
            section_title = section.get("title", "Untitled")[:40]
            section_id = section.get("id", "")

            # Get plain text for LLM (same as knowledge_graph.py)
            content_text = strip_html_tags(content_html)

            print(f"  [{idx}/{len(sections_to_process)}] {section_title}...", end=" ", flush=True)

            if debug:
                print(f"\n    Section ID: {section_id}")
                print(f"    Content preview ({len(content_text)} chars): {content_text[:150]}...")
                print(f"    Looking for entities: {[e['label'] for e in entity_batch]}")

            try:
                # Call LLM with plain text (simpler and more reliable)
                invoke_args = {
                    "html_content": content_html[:12000],
                    "entity_list": entity_list_str,
                }

                if debug:
                    print(f"    Calling LLM...")

                response = run_with_retry(
                    func=chain.invoke,
                    max_retries=2,
                    base_delay=1.0,
                    timeout_seconds=60,
                    func_args=(invoke_args,)
                )

                if debug:
                    print(f"    LLM response: {len(response.injections)} injections")
                    if response.reasoning:
                        print(f"    Reasoning: {response.reasoning[:150]}...")

                if not response.injections:
                    print("(no matches)")
                    return section_id, [], None

                if debug:
                    print(f"    Injections to apply:")
                    for inj in response.injections:
                        print(f"      - \"{inj.original_text}\" → {inj.entity_id}")

                print(f"✓ ({len(response.injections)} found)")
                return section_id, response.injections, None

            except TimeoutException:
                error_msg = f"Section '{section_title}': Timeout during LLM call"
                print("⏱ timeout")
                return section_id, [], error_msg
            except Exception as e:
                error_msg = f"Section '{section_title}': {str(e)}"
                print(f"✗ error: {e}")
                if debug:
                    import traceback
                    traceback.print_exc()
                return section_id, [], error_msg

        # Process sections in parallel
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(process_section, (idx, section)): idx
                for idx, section in enumerate(sections_to_process, 1)
            }

            completed = 0
            for future in as_completed(futures):
                completed += 1
                section_id, injections, error = future.result()

                # Only count sections_processed once (in the first batch)
                if batch_idx == 0:
                    sections_processed += 1

                if error:
                    errors.append(error)
                elif injections:
                    # Apply injections to the soup DOM (sequentially, thread-safe)
                    injection_count = _apply_injections_to_soup(
                        soup,
                        section_id,
                        injections,
                        debug
                    )
                    if injection_count > 0:
                        total_injections += injection_count

    # Serialize the modified DOM back to HTML
    modified_html = str(soup)

    print(f"[HTML Injection] Complete: {total_injections} spans injected, {len(errors)} errors")

    return {
        **state,
        "current_html": modified_html,
        "modified_html": modified_html,
        "sections_processed": sections_processed,
        "injection_count": total_injections,
        "errors": errors,
    }


def _apply_injections_to_soup(
    soup: BeautifulSoup,
    section_id: str,
    injections: List[SpanInjection],
    debug: bool = False
) -> int:
    """
    Apply span injections directly to the BeautifulSoup DOM.

    This modifies the soup in-place, searching the entire document
    for text matches and wrapping them with kg-entity spans.

    Args:
        soup: The BeautifulSoup object to modify (modified in-place)
        section_id: The section ID (for scoping, currently unused but available)
        injections: List of SpanInjection objects from the LLM
        debug: Whether to print debug info

    Returns:
        Number of successful injections
    """
    count = 0

    # Sort injections by length (longest first) to avoid partial replacements
    sorted_injections = sorted(injections, key=lambda x: len(x.original_text), reverse=True)

    # Track already-wrapped text to avoid double-wrapping
    wrapped_texts = set()

    for injection in sorted_injections:
        original = injection.original_text

        if not original or len(original) < 2:
            if debug:
                print(f"    Skipping too short: \"{original}\"")
            continue

        # Skip if we've already wrapped this text
        if original.lower() in wrapped_texts:
            if debug:
                print(f"    Skipping already processed: \"{original}\"")
            continue

        # Find and wrap all occurrences in the DOM
        injection_count = _wrap_text_in_soup(
            soup,
            original,
            injection.entity_id,
            injection.entity_type,
            debug
        )

        if injection_count > 0:
            count += injection_count
            wrapped_texts.add(original.lower())
            if debug:
                print(f"    Applied {injection_count}x: \"{original}\"")
        else:
            if debug:
                print(f"    No matches found for: \"{original}\"")

    return count


def _wrap_text_in_soup(
    soup: BeautifulSoup,
    text: str,
    entity_id: str,
    entity_type: str,
    debug: bool = False
) -> int:
    """
    Find and wrap all occurrences of text in the soup with kg-entity spans.

    Args:
        soup: BeautifulSoup object to modify in-place
        text: The text to find and wrap
        entity_id: Entity ID for the span
        entity_type: Entity type for the span
        debug: Whether to print debug info

    Returns:
        Number of wrappings performed
    """
    count = 0

    # We need to iterate carefully because we're modifying the tree
    # Find all text nodes, then process them
    # Use list() to avoid iterator invalidation
    text_nodes = list(soup.find_all(string=True))

    for text_node in text_nodes:
        # Skip if inside problematic elements
        parent = text_node.parent
        if not parent:
            continue

        if parent.name in ['script', 'style', 'math', 'annotation', 'mi', 'mo', 'mn', 'mtext', 'mrow']:
            continue

        # Skip if already inside a kg-entity span
        if parent.name == 'span' and 'kg-entity' in parent.get('class', []):
            continue

        # Check ancestors too - don't wrap if any ancestor is kg-entity or math
        dominated_by_skip = False
        for ancestor in parent.parents:
            if ancestor.name == 'math':
                dominated_by_skip = True
                break
            if ancestor.name == 'span' and 'kg-entity' in ancestor.get('class', []):
                dominated_by_skip = True
                break
        if dominated_by_skip:
            continue

        # Check if this text node contains our target (case-insensitive)
        node_text = str(text_node)
        if text.lower() not in node_text.lower():
            continue

        # Find all occurrences (case-insensitive but preserve original case)
        pattern = re.compile(re.escape(text), re.IGNORECASE)
        matches = list(pattern.finditer(node_text))

        if not matches:
            continue

        # Build replacement HTML by processing matches from end to start
        new_text = node_text
        for match in reversed(matches):
            matched_text = match.group()
            span_html = f'<span class="kg-entity" data-entity-id="{entity_id}" data-entity-type="{entity_type}">{matched_text}</span>'
            new_text = new_text[:match.start()] + span_html + new_text[match.end():]
            count += 1

        # Replace the text node with the new HTML
        new_soup = BeautifulSoup(new_text, 'html.parser')
        text_node.replace_with(new_soup)

    return count


def finalize_injection(state: InjectionState) -> InjectionState:
    """
    Finalize the injection workflow.

    Ensures modified_html is set and logs summary.
    """
    print(f"\n[HTML Injection] Summary:")
    print(f"  Sections processed: {state['sections_processed']}/{state['sections_total']}")
    print(f"  Spans injected: {state['injection_count']}")
    print(f"  Errors: {len(state['errors'])}")

    return state


# =============================================================================
# LangGraph Workflow
# =============================================================================

def create_injection_workflow() -> StateGraph:
    """Create the LangGraph workflow for HTML span injection."""
    workflow = StateGraph(InjectionState)

    # Add nodes
    workflow.add_node("initialize", initialize_injection)
    workflow.add_node("process_sections", process_sections)
    workflow.add_node("finalize", finalize_injection)

    # Define edges (sequential pipeline)
    workflow.set_entry_point("initialize")
    workflow.add_edge("initialize", "process_sections")
    workflow.add_edge("process_sections", "finalize")
    workflow.add_edge("finalize", END)

    return workflow


# =============================================================================
# Public API
# =============================================================================

def inject_spans_with_ai(
    html_content: str,
    sections_data: List[Dict[str, Any]],
    suggestions: List[Dict[str, Any]],
    ai_config: AIConfig | Dict[str, Any] | None = None,
) -> Tuple[str, List[str]]:
    """
    Inject <span class="kg-entity"> tags using AI model.

    This is the main entry point, compatible with the existing API.

    Args:
        html_content: The full HTML document to modify
        sections_data: List of section dicts with 'content_html' and 'id' fields
        suggestions: List of entity dicts with entity_id, entity_label, entity_type

    Returns:
        Tuple of (modified_html, errors)
    """
    if not html_content:
        return html_content, ["No HTML content provided"]

    if not suggestions:
        return html_content, []

    workflow = create_injection_workflow()
    app = workflow.compile()

    initial_state: InjectionState = {
        "html_content": html_content,
        "sections_data": sections_data or [],
        "suggestions": suggestions,
        "entities": [],
        "current_html": "",
        "sections_processed": 0,
        "sections_total": 0,
        "modified_html": "",
        "injection_count": 0,
        "errors": [],
        "ai_config": ai_config,
    }

    result = app.invoke(initial_state)

    return result["modified_html"] or html_content, result["errors"]


# =============================================================================
# CLI for Testing
# =============================================================================

if __name__ == "__main__":
    # Simple test
    test_html = """
    <div>
        <p data-id="p1">The gradient descent algorithm is widely used in machine learning.</p>
        <p data-id="p2">We apply gradient descent to minimize the loss function.</p>
    </div>
    """

    test_sections = [
        {
            "id": "sec1",
            "title": "Introduction",
            "content_html": '<p data-id="p1">The gradient descent algorithm is widely used in machine learning.</p>\n<p data-id="p2">We apply gradient descent to minimize the loss function.</p>'
        }
    ]

    test_suggestions = [
        {
            "entity_id": "def_gradient_descent",
            "entity_label": "gradient descent",
            "entity_type": "definition"
        },
        {
            "entity_id": "def_loss_function",
            "entity_label": "loss function",
            "entity_type": "definition"
        }
    ]

    print("Testing HTML injection agent...")
    modified, errors = inject_spans_with_ai(test_html, test_sections, test_suggestions)

    print("\nOriginal HTML:")
    print(test_html)
    print("\nModified HTML:")
    print(modified)
    print(f"\nErrors: {errors}")
