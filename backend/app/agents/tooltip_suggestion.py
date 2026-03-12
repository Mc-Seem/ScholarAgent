"""
Tooltip Suggestion Agent

Filters knowledge graph entities based on user expertise and generates tooltip content.
Part of Phase 2: Semantic Tooltips implementation.
"""

import os
from typing import List, Dict, Any, Optional, Callable
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from backend.app.llm import AIConfig, TASK_TOOLTIP_FILTER, create_chat_model

# Debug mode controlled by environment variable
DEBUG = os.getenv("TOOLTIP_AGENT_DEBUG", "false").lower() == "true"

def debug_print(message: str):
    """Print debug message if DEBUG mode is enabled"""
    if DEBUG:
        print(f"[Tooltip Suggestion] {message}")


# =============================================================================
# Pydantic Models for Structured Output
# =============================================================================

class FilterOutput(BaseModel):
    """Output from entity filtering agent"""
    selected_entity_ids: List[str] = Field(description="IDs of entities that should have tooltips")
    reasoning: Optional[str] = Field(default=None, description="Brief explanation of filtering decisions")


# =============================================================================
# Filtering Agent
# =============================================================================

FILTER_SYSTEM_PROMPT = """You are an academic paper annotation assistant.
Your job is to select which terms from a knowledge graph should have tooltips,
based on the reader's background and expertise.

Guidelines:
- Consider the reader's stated background and knowledge
- Annotate terms that would be unfamiliar or need clarification given their background
- Skip terms that are clearly within their stated expertise
- Include paper-specific notation, novel concepts, and domain-specific jargon they may not know
- Be selective but err on the side of over-annotation rather than missing important terms
- Consider context: common terms used in unusual ways should be annotated
- Mathematical symbols are often worth annotating unless trivial

Important:
- The user will provide a free-form description of their background
- Interpret their expertise level and domain knowledge from this description
- Tailor suggestions specifically to fill gaps in their knowledge
"""

FILTER_USER_PROMPT = """Reader's background and expertise:
{expertise_level}

Knowledge graph entities from the paper:

SYMBOLS:
{symbols_list}

DEFINITIONS:
{definitions_list}

THEOREMS:
{theorems_list}

Based on the reader's background, select which entities should have tooltips.
Select terms that would help this specific reader understand the paper better.

Return a JSON object with:
- selected_entity_ids: array of entity IDs to annotate
- reasoning: brief explanation of your selection criteria (optional)

Example:
{{
  "selected_entity_ids": ["symbol_alpha_t", "def_ELBO", "thm_3.2"],
  "reasoning": "Selected RL-specific notation and variational inference concepts that may be unfamiliar to ML engineers without RL background"
}}
"""


def filter_entities_by_expertise(
    entities: List[Dict[str, Any]],
    expertise_level: str,
    progress_callback: Optional[Callable[[str], None]] = None,
    ai_config: AIConfig | Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    """
    Use LLM to filter entities based on user expertise.

    Args:
        entities: List of all KG nodes (symbols, definitions, theorems)
        expertise_level: Free-form text describing the reader's background and expertise
        progress_callback: Optional callback for progress updates

    Returns:
        Filtered list of entities that should have tooltips
    """
    if not entities:
        return []

    # No validation needed - expertise_level is free-form text

    debug_print(f"Starting entity filtering with {len(entities)} total entities")
    debug_print(f"User expertise: {expertise_level[:100]}...")
    if progress_callback:
        progress_callback("Analyzing knowledge graph entities...")

    # Group entities by type for better prompt formatting
    symbols = [e for e in entities if e.get('type') == 'symbol']
    definitions = [e for e in entities if e.get('type') == 'definition']
    theorems = [e for e in entities if e.get('type') == 'theorem']

    debug_print(f"Entity breakdown: {len(symbols)} symbols, {len(definitions)} definitions, {len(theorems)} theorems")

    # Format entity lists for prompt
    def format_symbols(symbols_list):
        return "\n".join([
            f"- {s['id']}: {s.get('symbol', s.get('label', ''))} - {s.get('context', '')[:100]}"
            for s in symbols_list[:50]  # Limit to avoid token overflow
        ]) or "(none)"

    def format_definitions(defs_list):
        return "\n".join([
            f"- {d['id']}: {d.get('term', d.get('label', ''))} - {d.get('summary', d.get('definition_text', ''))[:100]}"
            for d in defs_list[:50]
        ]) or "(none)"

    def format_theorems(thms_list):
        return "\n".join([
            f"- {t['id']}: {t.get('label', '')} - {t.get('summary', t.get('statement', ''))[:100]}"
            for t in thms_list[:50]
        ]) or "(none)"

    symbols_text = format_symbols(symbols)
    definitions_text = format_definitions(definitions)
    theorems_text = format_theorems(theorems)

    debug_print("Formatted entity lists for LLM prompt")

    # Create prompt
    prompt = ChatPromptTemplate.from_messages([
        ("system", FILTER_SYSTEM_PROMPT),
        ("user", FILTER_USER_PROMPT)
    ])

    # Call LLM with structured output
    debug_print("Calling LLM to filter entities based on expertise...")
    if progress_callback:
        progress_callback("Filtering entities with AI based on your expertise...")

    try:
        llm = create_chat_model(task=TASK_TOOLTIP_FILTER, config=ai_config)
        structured_llm = llm.with_structured_output(FilterOutput)
        chain = prompt | structured_llm

        response = chain.invoke({
            "expertise_level": expertise_level,
            "symbols_list": symbols_text,
            "definitions_list": definitions_text,
            "theorems_list": theorems_text
        })

        # Filter entities by selected IDs
        selected_ids = set(response.selected_entity_ids)
        filtered = [e for e in entities if e.get('id') in selected_ids]

        debug_print(f"LLM filtering complete: {len(entities)} → {len(filtered)} entities selected")
        if response.reasoning:
            debug_print(f"LLM reasoning: {response.reasoning}")

        if progress_callback:
            progress_callback(f"Selected {len(filtered)} entities for annotation")

        return filtered

    except Exception as e:
        debug_print(f"Warning: Entity filtering failed ({e}), returning all entities as fallback")
        if progress_callback:
            progress_callback("Entity filtering failed, using all entities")
        # Fallback: return all entities if filtering fails
        return entities


# =============================================================================
# Tooltip Content Generation
# =============================================================================

def generate_tooltip_content(entity: Dict[str, Any]) -> str:
    """
    Generate tooltip content from KG node data.

    Phase 1 (MVP): Simple template from KG fields
    Phase 2 (Future): Add LLM refinement for clarity

    Args:
        entity: KG node dict with fields like label, context, definition_text, statement

    Returns:
        Tooltip content string (plain text or markdown)
    """
    entity_type = entity.get('type', '')

    if entity_type == 'symbol':
        # For symbols: use context field
        context = entity.get('context', '')
        if context:
            return context
        else:
            return f"Mathematical symbol: {entity.get('label', entity.get('symbol', ''))}"

    elif entity_type == 'definition':
        # For definitions: use summary (concise) or definition_text (detailed)
        summary = entity.get('summary', '')
        definition_text = entity.get('definition_text', '')

        if summary and definition_text:
            # Use summary as primary, with option to see full definition
            return f"{summary}\n\nFull definition: {definition_text}"
        elif summary:
            return summary
        elif definition_text:
            return definition_text
        else:
            return f"Definition of {entity.get('label', entity.get('term', ''))}"

    elif entity_type == 'theorem':
        # For theorems: use summary with reference to full statement
        summary = entity.get('summary', '')
        statement = entity.get('statement', '')
        theorem_label = entity.get('label', f"{entity.get('type', 'Theorem')} {entity.get('number', '')}")

        if summary:
            content = f"{theorem_label}: {summary}"
            if statement and len(statement) < 200:
                # Include statement if it's short enough
                content += f"\n\nStatement: {statement}"
            return content
        elif statement:
            return f"{theorem_label}: {statement}"
        else:
            return theorem_label

    else:
        # Fallback for unknown types
        return entity.get('context', entity.get('summary', entity.get('label', 'See knowledge graph')))


# =============================================================================
# Main Suggestion Function
# =============================================================================

def suggest_tooltips(
    knowledge_graph: Dict[str, Any],
    user_expertise: str,
    entity_type_filter: Optional[List[str]] = None,
    progress_callback: Optional[Callable[[str], None]] = None,
    ai_config: AIConfig | Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Main function to suggest tooltips based on knowledge graph.

    Args:
        knowledge_graph: The KG dict from paper.knowledge_graph
        user_expertise: Free-form text describing the reader's background and expertise
        entity_type_filter: Optional list of types to include (e.g., ["symbol", "definition"])
        progress_callback: Optional callback for progress updates

    Returns:
        Dict with:
        - suggestions: List of TooltipSuggestion dicts
        - total_entities: Total count before filtering
        - suggested_count: Count after filtering
    """
    debug_print("=" * 60)
    debug_print("Starting tooltip suggestion pipeline")
    if progress_callback:
        progress_callback("Loading knowledge graph...")

    if not knowledge_graph or 'nodes' not in knowledge_graph:
        debug_print("No knowledge graph available")
        return {
            "suggestions": [],
            "total_entities": 0,
            "suggested_count": 0
        }

    all_entities = knowledge_graph['nodes']
    total_count = len(all_entities)
    debug_print(f"Knowledge graph loaded: {total_count} total entities")

    # Apply type filter if specified
    if entity_type_filter:
        entities_to_consider = [
            e for e in all_entities
            if e.get('type') in entity_type_filter
        ]
        debug_print(f"Type filter applied: {len(entities_to_consider)} entities match types {entity_type_filter}")
    else:
        entities_to_consider = all_entities

    # Filter by expertise
    if progress_callback:
        progress_callback("Filtering entities based on your expertise...")
    filtered_entities = filter_entities_by_expertise(
        entities_to_consider,
        user_expertise,
        progress_callback,
        ai_config=ai_config,
    )

    # Generate suggestions
    debug_print(f"Generating tooltip content for {len(filtered_entities)} entities...")
    if progress_callback:
        progress_callback(f"Generating content for {len(filtered_entities)} tooltips...")

    suggestions = []
    for idx, entity in enumerate(filtered_entities, 1):
        # Generate tooltip content
        tooltip_content = generate_tooltip_content(entity)

        # Extract occurrences (from Phase 1)
        occurrences = entity.get('occurrences', [])

        suggestion = {
            "entity_id": entity['id'],
            "entity_label": entity.get('latex') if entity.get('type') == 'symbol' else entity.get('label',
                                                                                      entity.get('term', 'Unknown')),
            "entity_type": entity.get('type', 'unknown'),
            "tooltip_content": tooltip_content,
            "occurrences": occurrences
        }

        suggestions.append(suggestion)

        if idx % 10 == 0:
            debug_print(f"  Generated {idx}/{len(filtered_entities)} tooltips...")

    debug_print(f"Tooltip generation complete: {len(suggestions)} suggestions created")
    debug_print("=" * 60)

    if progress_callback:
        progress_callback(f"Complete! Generated {len(suggestions)} tooltip suggestions")

    return {
        "suggestions": suggestions,
        "total_entities": total_count,
        "suggested_count": len(suggestions)
    }
