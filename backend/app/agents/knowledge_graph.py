"""
Knowledge Graph Agent Pipeline

Multi-agent workflow using LangGraph to extract semantic structure from papers
and build a navigable knowledge graph.

Pipeline:
1. Data Loader - Fetches pre-extracted metadata from database
2. Symbol Extraction Agent - Identifies mathematical symbols and notation
3. Definition Extraction Agent - Finds formal and informal definitions
4. Theorem Extraction Agent - Extracts theorems, lemmas, corollaries
5. Dependency Extraction Agent - Maps relationships between entities
6. Graph Builder - Assembles final graph structure
"""

import os
from typing import TypedDict, List, Dict, Any, Optional, Annotated
try:
    from typing import NotRequired
except ImportError:
    from typing_extensions import NotRequired
from pydantic import BaseModel, Field
import operator
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from langchain_core.prompts import ChatPromptTemplate
from backend.app.llm import AIConfig, TASK_KNOWLEDGE_GRAPH, create_chat_model

# Import shared utilities
from backend.app.agents.utils import (
    TimeoutException,
    run_with_retry,
    strip_html_tags,
    filter_processable_sections,
    get_debug_flag,
)

# Load environment variables
load_dotenv()


# =============================================================================
# State Schema
# =============================================================================

class GraphState(TypedDict):
    """Shared state passed between agents"""
    paper_id: str

    # Pre-extracted data from Phase 0 (already in database)
    sections: List[Dict[str, Any]]
    equations: List[Dict[str, Any]]
    citations: List[Dict[str, Any]]
    latex_source: Optional[str]

    # Agent-extracted entities (use Annotated with operator.add for concurrent updates)
    symbols: Annotated[List[Dict[str, Any]], operator.add]
    definitions: Annotated[List[Dict[str, Any]], operator.add]
    theorems: Annotated[List[Dict[str, Any]], operator.add]

    # Relationships
    relationships: List[Dict[str, Any]]

    # Final output
    graph_data: Dict[str, Any]

    # Error tracking (use Annotated for concurrent error collection)
    errors: Annotated[List[str], operator.add]

    # Progress reporting (optional callback)
    progress_callback: NotRequired[Any]
    ai_config: NotRequired[AIConfig | dict[str, Any] | None]


# =============================================================================
# Pydantic Models for Structured Output
# =============================================================================

class Occurrence(BaseModel):
    """A single occurrence of an entity in the document"""
    section_id: str = Field(description="ID of the section where this occurs")
    dom_node_id: str = Field(description="ID of the DOM node (paragraph/block)")
    char_offset: int = Field(description="Character offset from start of node's text content")
    length: int = Field(description="Length of the matched text")
    snippet: str = Field(description="Text snippet around the occurrence (for context)")


class Symbol(BaseModel):
    """A mathematical symbol extracted from the paper"""
    symbol: str = Field(description="The symbol as it appears (e.g., α_t, x)")
    latex: str = Field(description="LaTeX representation wrapped in dollar signs for rendering (e.g., $\\alpha_t$, $x$)")
    context: str = Field(description="Brief explanation of what it represents (1 sentence)")
    is_definition: bool = Field(description="Is this where the symbol is first defined/introduced?")
    occurrences: List[Occurrence] = Field(default_factory=list, description="All occurrences of this symbol in the document")


class SymbolExtractionOutput(BaseModel):
    """Output from symbol extraction agent"""
    symbols: List[Symbol]


class Definition(BaseModel):
    """A definition extracted from the paper"""
    term: str = Field(description="The term being defined")
    definition_text: str = Field(description="The definition itself")
    summary: str = Field(description="1-2 sentence summary of the definition for quick understanding")
    is_formal: bool = Field(description="Is this a numbered/formal definition (e.g., 'Definition 3.2')?")
    definition_number: Optional[str] = Field(default=None, description="The number if formal (e.g., '3.2')")
    occurrences: List[Occurrence] = Field(default_factory=list, description="All occurrences of this term in the document")


class DefinitionExtractionOutput(BaseModel):
    """Output from definition extraction agent"""
    definitions: List[Definition]


class Theorem(BaseModel):
    """A theorem/lemma/corollary extracted from the paper"""
    type: str = Field(description="One of: theorem, lemma, corollary, proposition")
    number: str = Field(description="The number (e.g., '3.2')")
    name: Optional[str] = Field(default=None, description="Optional name (e.g., 'Convergence Theorem')")
    statement: str = Field(description="The actual theorem statement")
    summary: str = Field(description="1-2 sentence summary of what the theorem establishes")
    occurrences: List[Occurrence] = Field(default_factory=list, description="All references to this theorem in the document")


class TheoremExtractionOutput(BaseModel):
    """Output from theorem extraction agent"""
    theorems: List[Theorem]


class Relationship(BaseModel):
    """A relationship between entities"""
    from_entity: str = Field(description="Source entity (name or identifier)")
    to_entity: str = Field(description="Target entity (name or identifier)")
    relationship_type: str = Field(description="One of: uses, depends_on, defines, mentions")
    evidence_text: str = Field(description="Text snippet showing this relationship")


class RelationshipExtractionOutput(BaseModel):
    """Output from dependency extraction agent"""
    relationships: List[Relationship]


# =============================================================================
# Prompt Templates
# =============================================================================

SYMBOL_SYSTEM_PROMPT = """You are a mathematical symbol extractor for academic papers.
Extract ONLY mathematically significant symbols that represent core concepts, variables, or functions in the paper's theoretical framework.

EXTRACT:
- Mathematical variables with specific meaning: $\\alpha$ (smoothness parameter), $t$ (time variable), $\\theta$ (angle)
- Functions and operators: $f(x)$ (objective function), $\\nabla$ (gradient), $\\mathcal{{L}}$ (Lagrangian), $H$ (Hamiltonian)
- Probability and statistics: $p(x|y)$ (conditional probability), $\\mu$ (mean), $\\sigma^2$ (variance), $\\mathbb{{E}}$ (expectation)
- Sets and spaces: $\\mathbb{{R}}^n$ (n-dimensional real space), $\\Omega$ (sample space), $X$ (domain)
- Matrix/vector notation: $A$ (matrix), $v$ (vector), $x_i$ (indexed element)
- Constants with paper-specific meaning: $c$ (speed of light in a physics paper), $\\lambda$ (decay constant)

DO NOT EXTRACT:
- Plain numbers or measurements: "1.45 TB", "8,000", "256", "0.001", "32 GB"
- Section/equation/figure references: "Section 3", "Figure 2", "Eq. 4", "Table 1"
- Generic placeholder variables mentioned only once without mathematical definition
- Non-mathematical abbreviations: "RAM", "GPU", "CPU", "API", "URL"
- Method/definition acronyms: "DPO", "SimPO", "RLHF", "SGD", "Adam" (these are definitions, not symbols)
- Model names: "GPT-4", "BERT", "ResNet", "Transformer" (these are proper nouns, not mathematical symbols)
- Universal constants without special treatment: $\\pi$, $e$ (unless given paper-specific interpretation)
- Index variables with no substantive role: $i$, $j$, $k$ (unless they represent something meaningful)

EXAMPLES:

Good extraction:
Symbol: $\\lambda_k$
Context: The $k$-th eigenvalue of the Laplacian operator, characterizes oscillation frequency
Is definition: true

Good extraction:
Symbol: $\\mathcal{{H}}$
Context: Hilbert space of square-integrable functions on the domain $\\Omega$
Is definition: true

Bad extraction (too generic):
Symbol: $n$
Context: A number
Is definition: false

Bad extraction (not a symbol):
Symbol: 8,000
Context: The number of iterations
Is definition: false

Bad extraction (trivial index):
Symbol: $i$
Context: Loop index
Is definition: false

For each symbol, provide:
1. The symbol in LaTeX wrapped in dollar signs (e.g., $\\alpha_t$, $\\mathcal{{H}}$)
2. A brief context explaining its mathematical role (1 sentence, use $...$ for math)
3. Whether this is where the symbol is first formally defined/introduced

IMPORTANT: Be selective. Only extract symbols that are mathematically significant to understanding the paper's contributions."""

SYMBOL_USER_PROMPT = """Section: {section_title}

Content:
{content_text}

Extract all mathematical symbols and key notation from this section."""


DEFINITION_SYSTEM_PROMPT = """You are a definition extractor for academic papers.
Extract ONLY substantive definitions that introduce new concepts, terms, or mathematical objects with clear explanatory content.

EXTRACT:
- Formal definitions: "Definition 3.2: A diffusion process is a stochastic process..."
- Conceptual definitions: "We define the attention mechanism as a function that maps queries to outputs..."
- Mathematical object definitions: "Let $f: \\mathbb{{R}}^n \\to \\mathbb{{R}}$ be a smooth function..."
- Term introductions with explanation: "Self-attention, which allows each position to attend to all positions..."

DO NOT EXTRACT:
- Pure equations without explanation: "$L_\\text{{dist}}(\\theta)=\\lambda_d\\mathbb{{E}}[l_\\text{{hard}}\\cdot l_\\text{{soft}}]$"
- Variable assignments: "Let $n = 100$" or "Set $\\epsilon = 0.01$"
- Citations or references: "As defined in [Smith et al., 2020]..."
- Abbreviated notation: "We write $x$ for $x_1, x_2, ..., x_n$"
- Implementation details: "We use batch size 32"

EXAMPLES:

Good extraction:
Term: Attention mechanism
Definition: A function that maps a query and a set of key-value pairs to an output, computed as a weighted sum of values where weights are determined by compatibility between query and keys.
Summary: Weighted combination of values based on query-key similarity.
Is formal: false

Good extraction:
Term: KL divergence
Definition: For probability distributions $P$ and $Q$, the KL divergence $D_{{KL}}(P||Q) = \\mathbb{{E}}_P[\\log P - \\log Q]$ measures how much $P$ differs from $Q$.
Summary: Measures the difference between two probability distributions.
Is formal: false

Bad extraction (no explanation):
Term: $L_\\text{{dist}}(\\theta)$
Definition: $L_\\text{{dist}}(\\theta)=\\lambda_d\\mathbb{{E}}[l_\\text{{hard}}\\cdot l_\\text{{soft}}]$
(This is just a formula with no conceptual explanation)

Bad extraction (too trivial):
Term: $n$
Definition: The number of samples.
(Too generic, not a substantive concept)

For each definition, provide:
1. The term being defined (use LaTeX with $...$ if needed)
2. The definition text - must include conceptual explanation, not just a formula
3. A 1-2 sentence summary for quick understanding
4. Whether it's a formal numbered definition

IMPORTANT: Only extract definitions that provide substantive conceptual or mathematical content. Skip trivial variable assignments and pure equations."""

DEFINITION_USER_PROMPT = """Section: {section_title}

Content:
{content_text}

Extract all definitions (formal and informal) from this section."""


THEOREM_SYSTEM_PROMPT = """You are a theorem extractor for academic papers.
Identify all formal mathematical statements: theorems, lemmas, corollaries, propositions.

For each, extract:
- Type (theorem/lemma/corollary/proposition)
- Number (e.g., "3.2")
- Name (if given, e.g., "Convergence Theorem")
- Statement (the actual claim being made, use $...$ for any math notation)
- A 1-2 sentence summary of what the theorem establishes

Look for patterns like:
- "Theorem N.M: ..."
- "Lemma N.M (Name): ..."
- "Corollary: ..."
- "Proposition N.M: ..."

Only extract formal statements with clear theorem-like structure, not informal claims.

IMPORTANT: Wrap all LaTeX/math notation in dollar signs for proper rendering (e.g., $f(x) = 0$, $\\forall x \\in X$)."""

THEOREM_USER_PROMPT = """Section: {section_title}

Content:
{content_text}

Extract all theorems, lemmas, corollaries, and propositions from this section."""


DEPENDENCY_SYSTEM_PROMPT = """You are analyzing dependencies in an academic paper.
Identify relationships between concepts:

Relationship types:
- "uses": X uses Y in its proof/derivation/formula
- "depends_on": X logically requires Y to be defined first
- "defines": X defines symbol/term Y
- "extends": X extends or generalizes Y
- "mentions": X references Y

Look for patterns like:
- "By Theorem X..."
- "Using Definition Y..."
- "From Lemma Z, we have..."
- "Recall that..." (refers to earlier concept)
- "As shown in Section..."
- Symbol usage that refers to earlier definitions

Only extract relationships where there's clear textual evidence."""

DEPENDENCY_USER_PROMPT = """Section: {section_title}

Content:
{content_text}

Known entities in this paper (with brief descriptions):
Symbols:
{symbol_list}

Definitions:
{definition_list}

Theorems:
{theorem_list}

Extract all dependency relationships visible in this section."""


# =============================================================================
# Occurrence Detection Utilities
# =============================================================================

def find_all_occurrences_plaintext(text: str, term: str, case_sensitive: bool = True) -> List[int]:
    """
    Find all occurrences of a term in text using plain text search.

    Args:
        text: The text to search in
        term: The term to find
        case_sensitive: Whether to match case exactly

    Returns:
        List of character offsets where term appears
    """
    import re

    if not text or not term:
        return []

    # Escape special regex characters in the term
    escaped_term = re.escape(term)

    # Create pattern - use word boundaries for better matching
    # But be flexible for math symbols that might not have word boundaries
    pattern = escaped_term

    flags = 0 if case_sensitive else re.IGNORECASE

    try:
        matches = re.finditer(pattern, text, flags)
        return [m.start() for m in matches]
    except re.error:
        # Fallback to simple string search if regex fails
        if case_sensitive:
            offset = 0
            positions = []
            while True:
                pos = text.find(term, offset)
                if pos == -1:
                    break
                positions.append(pos)
                offset = pos + 1
            return positions
        else:
            text_lower = text.lower()
            term_lower = term.lower()
            offset = 0
            positions = []
            while True:
                pos = text_lower.find(term_lower, offset)
                if pos == -1:
                    break
                positions.append(pos)
                offset = pos + 1
            return positions


def extract_occurrences_for_entity(
    term: str,
    sections: List[Dict[str, Any]],
    max_snippet_chars: int = 40
) -> List[Dict[str, Any]]:
    """
    Find all occurrences of a term across all sections.

    Args:
        term: The term to find (plain text representation)
        sections: List of section dicts with content_html
        max_snippet_chars: Characters to include in context snippet (before and after)

    Returns:
        List of occurrence dicts with section_id, dom_node_id, char_offset, length, snippet
    """
    from bs4 import BeautifulSoup

    occurrences = []

    for section in sections:
        section_id = section.get("id", "unknown")
        content_html = section.get("content_html", "")

        if not content_html:
            continue

        # Parse the section HTML to find individual elements with data-id
        soup = BeautifulSoup(content_html, 'html.parser')

        # Find all elements with data-id (these are the actual DOM nodes we can target)
        elements_with_id = soup.find_all(attrs={'data-id': True})

        for element in elements_with_id:
            dom_node_id = element.get('data-id')

            # Get plain text of this specific element
            element_text = element.get_text(separator=' ', strip=True)

            if not element_text:
                continue

            # Find all occurrences in this element
            offsets = find_all_occurrences_plaintext(element_text, term, case_sensitive=False)

            for offset in offsets:
                # Extract snippet (context around the match)
                snippet_start = max(0, offset - max_snippet_chars)
                snippet_end = min(len(element_text), offset + len(term) + max_snippet_chars)
                snippet = element_text[snippet_start:snippet_end]

                # Add ellipsis if truncated
                if snippet_start > 0:
                    snippet = "..." + snippet
                if snippet_end < len(element_text):
                    snippet = snippet + "..."

                occurrences.append({
                    "section_id": section_id,
                    "dom_node_id": dom_node_id,
                    "char_offset": offset,
                    "length": len(term),
                    "snippet": snippet
                })

    return occurrences


# =============================================================================
# Agent Functions
# =============================================================================

def load_paper_data(state: GraphState) -> GraphState:
    """
    Load pre-extracted metadata from database.

    This replaces parsing - data already extracted at compile time (Phase 0).
    """
    # Handle imports for both module and script execution
    try:
        from backend.app.database.connection import SessionLocal
        from backend.app.database.models import Paper
    except ModuleNotFoundError:
        import sys
        from pathlib import Path
        # Add project root to path
        project_root = Path(__file__).parent.parent.parent.parent
        sys.path.insert(0, str(project_root))
        from backend.app.database.connection import SessionLocal
        from backend.app.database.models import Paper

    db = SessionLocal()
    try:
        paper = db.query(Paper).filter(Paper.id == state["paper_id"]).first()

        if not paper:
            state["errors"].append(f"Paper {state['paper_id']} not found")
            return state

        # Load pre-extracted data
        all_sections = paper.sections_data or []

        # Optional: limit to first N sections (0 = process all)
        max_sections = int(os.getenv("KG_MAX_SECTIONS", "0"))
        if max_sections > 0 and len(all_sections) > max_sections:
            state["sections"] = all_sections[:max_sections]
            print(f"Note: Processing first {max_sections} sections only (set KG_MAX_SECTIONS=0 to process all)")
        else:
            state["sections"] = all_sections

        state["equations"] = paper.equations_data or []
        state["citations"] = paper.citations_data or []
        state["latex_source"] = paper.latex_source

        return state
    finally:
        db.close()


def _report_progress(state: GraphState, stage: str, current: int, total: int):
    """Helper to report progress if callback is available."""
    if state.get("progress_callback"):
        state["progress_callback"](stage, current, total)


def _get_worker_count() -> int:
    """Get the number of parallel workers from environment variable."""
    return int(os.getenv("KG_WORKERS", "4"))


def extract_symbols(state: GraphState) -> GraphState:
    """Extract mathematical symbols using LLM."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[1/4] Extracting symbols from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = create_chat_model(
        task=TASK_KNOWLEDGE_GRAPH,
        config=state.get("ai_config"),
    )
    structured_llm = llm.with_structured_output(SymbolExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", SYMBOL_SYSTEM_PROMPT),
        ("user", SYMBOL_USER_PROMPT)
    ])

    chain = prompt | structured_llm

    symbols = []
    errors = []

    _report_progress(state, "symbols", 0, len(sections_to_process))

    def process_section(idx_section):
        """Process a single section (for parallel execution)."""
        idx, section = idx_section
        section_symbols = []
        section_errors = []

        try:
            content_text = strip_html_tags(section.get("content_html", ""))
            section_title = section.get("title", "Untitled")
            section_id = section.get("id", "unknown")

            print(f"  [{idx}/{len(sections_to_process)}] {section_title[:50]}...", end=" ", flush=True)
            if os.getenv("KG_DEBUG"):
                print()
                print(f"      Section ID: {section_id}")
                print(f"      Content length: {len(content_text)} chars")
                print(f"      Content preview: {content_text[:200].strip()}...")
                print(f"      Processing...", end=" ", flush=True)

            # Use retry with timeout to handle rate limits and transient errors
            try:
                invoke_args = {
                    "section_title": section_title,
                    "content_text": content_text[:8000]  # Limit context size
                }
                response = run_with_retry(
                    func=chain.invoke,
                    max_retries=3,
                    base_delay=2.0,
                    timeout_seconds=120,
                    func_args=(invoke_args,)
                )
            except TimeoutException as te:
                print(f"⏱ Timeout after all retries!")
                section_errors.append(f"Symbol extraction timed out for section {section_id} ({section_title})")
                return section_symbols, section_errors
            except Exception as e:
                # This catches non-retryable errors or exhausted retries
                print(f"✗ Failed after retries!")
                error_details = f"Symbol extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
                section_errors.append(error_details)
                if os.getenv("KG_DEBUG"):
                    import traceback
                    print(f"\n      Full traceback:\n{traceback.format_exc()}")
                return section_symbols, section_errors

            count = len(response.symbols)
            print(f"✓ ({count} symbols)")

            for symbol in response.symbols:
                section_symbols.append({
                    "symbol": symbol.symbol,
                    "latex": symbol.latex,
                    "context": symbol.context,
                    "is_definition": symbol.is_definition,
                    "section_id": section_id,
                    "dom_node_id": section_id,
                    # Note: occurrences are found lazily at tooltip application time
                })

        except Exception as e:
            print(f"✗ Error: {str(e)}")
            error_details = f"Symbol extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
            section_errors.append(error_details)
            if os.getenv("KG_DEBUG"):
                import traceback
                print(f"\n      Full traceback:\n{traceback.format_exc()}")

        return section_symbols, section_errors

    # Process sections in parallel
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(process_section, (idx, section)): idx
            for idx, section in enumerate(sections_to_process, 1)
        }

        completed = 0
        for future in as_completed(futures):
            completed += 1
            section_symbols, section_errors = future.result()
            symbols.extend(section_symbols)
            errors.extend(section_errors)
            _report_progress(state, "symbols", completed, len(sections_to_process))

    print(f"  → Total: {len(symbols)} symbols extracted")
    # Return only the keys we're updating (for parallel execution compatibility)
    return {"symbols": symbols, "errors": errors}


def extract_definitions(state: GraphState) -> GraphState:
    """Extract definitions using LLM."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[2/4] Extracting definitions from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = create_chat_model(
        task=TASK_KNOWLEDGE_GRAPH,
        config=state.get("ai_config"),
    )
    structured_llm = llm.with_structured_output(DefinitionExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", DEFINITION_SYSTEM_PROMPT),
        ("user", DEFINITION_USER_PROMPT)
    ])

    chain = prompt | structured_llm

    definitions = []
    errors = []

    _report_progress(state, "definitions", 0, len(sections_to_process))

    def process_section(idx_section):
        """Process a single section (for parallel execution)."""
        idx, section = idx_section
        section_definitions = []
        section_errors = []

        try:
            content_text = strip_html_tags(section.get("content_html", ""))
            section_title = section.get("title", "Untitled")
            section_id = section.get("id", "unknown")

            print(f"  [{idx}/{len(sections_to_process)}] {section_title[:50]}...", end=" ", flush=True)
            if os.getenv("KG_DEBUG"):
                print()
                print(f"      Section ID: {section_id}")
                print(f"      Content length: {len(content_text)} chars")
                print(f"      Content preview: {content_text[:200].strip()}...")
                print(f"      Processing...", end=" ", flush=True)

            # Use retry with timeout to handle rate limits and transient errors
            try:
                invoke_args = {
                    "section_title": section_title,
                    "content_text": content_text[:8000]
                }
                response = run_with_retry(
                    func=chain.invoke,
                    max_retries=3,
                    base_delay=2.0,
                    timeout_seconds=120,
                    func_args=(invoke_args,)
                )
            except TimeoutException as te:
                print(f"⏱ Timeout after all retries!")
                section_errors.append(f"Definition extraction timed out for section {section_id} ({section_title})")
                return section_definitions, section_errors
            except Exception as e:
                # This catches non-retryable errors or exhausted retries
                print(f"✗ Failed after retries!")
                error_details = f"Definition extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
                section_errors.append(error_details)
                if os.getenv("KG_DEBUG"):
                    import traceback
                    print(f"\n      Full traceback:\n{traceback.format_exc()}")
                return section_definitions, section_errors

            count = len(response.definitions)
            print(f"✓ ({count} definitions)")

            for defn in response.definitions:
                section_definitions.append({
                    "term": defn.term,
                    "definition_text": defn.definition_text,
                    "summary": defn.summary,
                    "is_formal": defn.is_formal,
                    "definition_number": defn.definition_number,
                    "section_id": section_id,
                    "dom_node_id": section_id,
                    # Note: occurrences are found lazily at tooltip application time
                })

        except Exception as e:
            print(f"✗ Error: {str(e)}")
            error_details = f"Definition extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
            section_errors.append(error_details)
            if os.getenv("KG_DEBUG"):
                import traceback
                print(f"\n      Full traceback:\n{traceback.format_exc()}")

        return section_definitions, section_errors

    # Process sections in parallel
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(process_section, (idx, section)): idx
            for idx, section in enumerate(sections_to_process, 1)
        }

        completed = 0
        for future in as_completed(futures):
            completed += 1
            section_definitions, section_errors = future.result()
            definitions.extend(section_definitions)
            errors.extend(section_errors)
            _report_progress(state, "definitions", completed, len(sections_to_process))

    print(f"  → Total: {len(definitions)} definitions extracted")
    # Return only the keys we're updating (for parallel execution compatibility)
    return {"definitions": definitions, "errors": errors}


def extract_theorems(state: GraphState) -> GraphState:
    """Extract theorems, lemmas, corollaries using LLM."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[3/4] Extracting theorems from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = create_chat_model(
        task=TASK_KNOWLEDGE_GRAPH,
        config=state.get("ai_config"),
    )
    structured_llm = llm.with_structured_output(TheoremExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", THEOREM_SYSTEM_PROMPT),
        ("user", THEOREM_USER_PROMPT)
    ])

    chain = prompt | structured_llm

    theorems = []
    errors = []

    _report_progress(state, "theorems", 0, len(sections_to_process))

    def process_section(idx_section):
        """Process a single section (for parallel execution)."""
        idx, section = idx_section
        section_theorems = []
        section_errors = []

        try:
            content_text = strip_html_tags(section.get("content_html", ""))
            section_title = section.get("title", "Untitled")
            section_id = section.get("id", "unknown")

            print(f"  [{idx}/{len(sections_to_process)}] {section_title[:50]}...", end=" ", flush=True)
            if os.getenv("KG_DEBUG"):
                print()
                print(f"      Section ID: {section_id}")
                print(f"      Content length: {len(content_text)} chars")
                print(f"      Content preview: {content_text[:200].strip()}...")
                print(f"      Processing...", end=" ", flush=True)

            # Use retry with timeout to handle rate limits and transient errors
            try:
                invoke_args = {
                    "section_title": section_title,
                    "content_text": content_text[:8000]
                }
                response = run_with_retry(
                    func=chain.invoke,
                    max_retries=3,
                    base_delay=2.0,
                    timeout_seconds=120,
                    func_args=(invoke_args,)
                )
            except TimeoutException as te:
                print(f"⏱ Timeout after all retries!")
                section_errors.append(f"Theorem extraction timed out for section {section_id} ({section_title})")
                return section_theorems, section_errors
            except Exception as e:
                # This catches non-retryable errors or exhausted retries
                print(f"✗ Failed after retries!")
                error_details = f"Theorem extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
                section_errors.append(error_details)
                if os.getenv("KG_DEBUG"):
                    import traceback
                    print(f"\n      Full traceback:\n{traceback.format_exc()}")
                return section_theorems, section_errors

            count = len(response.theorems)
            print(f"✓ ({count} theorems)")

            for thm in response.theorems:
                section_theorems.append({
                    "type": thm.type,
                    "number": thm.number,
                    "name": thm.name,
                    "statement": thm.statement,
                    "summary": thm.summary,
                    "section_id": section_id,
                    "dom_node_id": section_id,
                    # Note: occurrences are found lazily at tooltip application time
                })

        except Exception as e:
            print(f"✗ Error: {str(e)}")
            error_details = f"Theorem extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
            section_errors.append(error_details)
            if os.getenv("KG_DEBUG"):
                import traceback
                print(f"\n      Full traceback:\n{traceback.format_exc()}")

        return section_theorems, section_errors

    # Process sections in parallel
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(process_section, (idx, section)): idx
            for idx, section in enumerate(sections_to_process, 1)
        }

        completed = 0
        for future in as_completed(futures):
            completed += 1
            section_theorems, section_errors = future.result()
            theorems.extend(section_theorems)
            errors.extend(section_errors)
            _report_progress(state, "theorems", completed, len(sections_to_process))

    print(f"  → Total: {len(theorems)} theorems extracted")
    # Return only the keys we're updating (for parallel execution compatibility)
    return {"theorems": theorems, "errors": errors}


def extract_dependencies(state: GraphState) -> GraphState:
    """Extract relationships between entities."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[4/4] Extracting relationships from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = create_chat_model(
        task=TASK_KNOWLEDGE_GRAPH,
        config=state.get("ai_config"),
    )
    structured_llm = llm.with_structured_output(RelationshipExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", DEPENDENCY_SYSTEM_PROMPT),
        ("user", DEPENDENCY_USER_PROMPT)
    ])

    chain = prompt | structured_llm

    # Prepare entity lists for context with summaries (pass ALL entities to each section)
    symbol_list = [f"{s['symbol']}: {s['context']}" for s in state["symbols"]]
    definition_list = [f"{d['term']}: {d['summary']}" for d in state["definitions"]]
    theorem_list = [
        f"{t['type'].capitalize()} {t['number']}" +
        (f" ({t['name']})" if t.get('name') else "") +
        f": {t['summary']}"
        for t in state["theorems"]
    ]

    print(f"  Context: {len(symbol_list)} symbols, {len(definition_list)} definitions, {len(theorem_list)} theorems")

    relationships = []
    errors = []

    _report_progress(state, "dependencies", 0, len(sections_to_process))

    def process_section(idx_section):
        """Process a single section (for parallel execution)."""
        idx, section = idx_section
        section_relationships = []
        section_errors = []

        try:
            content_text = strip_html_tags(section.get("content_html", ""))
            section_title = section.get("title", "Untitled")
            section_id = section.get("id", "unknown")

            print(f"  [{idx}/{len(sections_to_process)}] {section_title[:50]}...", end=" ", flush=True)
            if os.getenv("KG_DEBUG"):
                print()
                print(f"      Section ID: {section_id}")
                print(f"      Content length: {len(content_text)} chars")
                print(f"      Content preview: {content_text[:200].strip()}...")
                print(f"      Processing...", end=" ", flush=True)

            # Use retry with timeout to handle rate limits and transient errors
            try:
                invoke_args = {
                    "section_title": section_title,
                    "content_text": content_text[:8000],
                    "symbol_list": "\n".join(f"- {s}" for s in symbol_list[:50]) if symbol_list else "None found",
                    "definition_list": "\n".join(f"- {d}" for d in definition_list[:30]) if definition_list else "None found",
                    "theorem_list": "\n".join(f"- {t}" for t in theorem_list[:20]) if theorem_list else "None found",
                }
                response = run_with_retry(
                    func=chain.invoke,
                    max_retries=3,
                    base_delay=2.0,
                    timeout_seconds=120,
                    func_args=(invoke_args,)
                )
            except TimeoutException as te:
                print(f"⏱ Timeout after all retries!")
                section_errors.append(f"Dependency extraction timed out for section {section_id} ({section_title})")
                return section_relationships, section_errors
            except Exception as e:
                # This catches non-retryable errors or exhausted retries
                print(f"✗ Failed after retries!")
                error_details = f"Dependency extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
                section_errors.append(error_details)
                if os.getenv("KG_DEBUG"):
                    import traceback
                    print(f"\n      Full traceback:\n{traceback.format_exc()}")
                return section_relationships, section_errors

            count = len(response.relationships)
            print(f"✓ ({count} relationships)")

            for rel in response.relationships:
                section_relationships.append({
                    "from_entity": rel.from_entity,
                    "to_entity": rel.to_entity,
                    "type": rel.relationship_type,
                    "evidence": rel.evidence_text,
                    "section_id": section_id,
                })

        except Exception as e:
            print(f"✗ Error: {str(e)}")
            error_details = f"Dependency extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
            section_errors.append(error_details)
            if os.getenv("KG_DEBUG"):
                import traceback
                print(f"\n      Full traceback:\n{traceback.format_exc()}")

        return section_relationships, section_errors

    # Process sections in parallel
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(process_section, (idx, section)): idx
            for idx, section in enumerate(sections_to_process, 1)
        }

        completed = 0
        for future in as_completed(futures):
            completed += 1
            section_relationships, section_errors = future.result()
            relationships.extend(section_relationships)
            errors.extend(section_errors)
            _report_progress(state, "dependencies", completed, len(sections_to_process))

    print(f"  → Total: {len(relationships)} relationships extracted")
    state["relationships"] = relationships
    state["errors"].extend(errors)
    return state


def _sanitize_id(name: str) -> str:
    """Convert entity name to valid ID."""
    return name.lower().replace(" ", "_").replace("\\", "").replace("{", "").replace("}", "")[:64]


def _resolve_entity_id(entity_name: str, state: GraphState) -> str:
    """Map entity name to its node ID."""
    entity_lower = entity_name.lower()
    
    # Check symbols
    for symbol in state["symbols"]:
        if symbol["symbol"].lower() == entity_lower or symbol["latex"].lower() == entity_lower:
            return f"symbol_{_sanitize_id(symbol['symbol'])}"
    
    # Check definitions
    for defn in state["definitions"]:
        if defn["term"].lower() == entity_lower:
            return f"def_{_sanitize_id(defn['term'])}"
    
    # Check theorems
    for thm in state["theorems"]:
        thm_label = f"{thm['type']} {thm['number']}".lower()
        if thm_label == entity_lower or thm["number"] == entity_name:
            return f"thm_{thm['number']}"
    
    # Fallback: sanitize the name
    return _sanitize_id(entity_name)


def build_graph(state: GraphState) -> GraphState:
    """Assemble final graph structure from extracted entities."""
    print(f"\n[5/5] Building graph from extracted entities...")
    print(f"  Symbols: {len(state['symbols'])}")
    print(f"  Definitions: {len(state['definitions'])}")
    print(f"  Theorems: {len(state['theorems'])}")
    print(f"  Relationships: {len(state['relationships'])}")

    nodes = []
    edges = []
    seen_node_ids = set()
    
    # Convert symbols to nodes (deduplicate by symbol name)
    seen_symbols = set()
    for symbol in state["symbols"]:
        symbol_key = symbol["symbol"].lower()
        if symbol_key in seen_symbols:
            continue
        seen_symbols.add(symbol_key)
        
        node_id = f"symbol_{_sanitize_id(symbol['symbol'])}"
        if node_id in seen_node_ids:
            continue
        seen_node_ids.add(node_id)
        
        nodes.append({
            "id": node_id,
            "type": "symbol",
            "label": symbol["symbol"],
            "latex": symbol["latex"],
            "context": symbol["context"],
            "dom_node_id": symbol["dom_node_id"],
            "section_id": symbol["section_id"],
        })
    
    # Convert definitions to nodes
    seen_definitions = set()
    for defn in state["definitions"]:
        term_key = defn["term"].lower()
        if term_key in seen_definitions:
            continue
        seen_definitions.add(term_key)

        node_id = f"def_{_sanitize_id(defn['term'])}"
        if node_id in seen_node_ids:
            continue
        seen_node_ids.add(node_id)

        nodes.append({
            "id": node_id,
            "type": "definition",
            "label": defn["term"],
            "definition": defn["definition_text"],
            "summary": defn["summary"],
            "is_formal": defn["is_formal"],
            "definition_number": defn.get("definition_number"),
            "dom_node_id": defn["dom_node_id"],
            "section_id": defn["section_id"],
        })
    
    # Convert theorems to nodes
    for thm in state["theorems"]:
        node_id = f"thm_{thm['number']}"
        if node_id in seen_node_ids:
            continue
        seen_node_ids.add(node_id)

        nodes.append({
            "id": node_id,
            "type": "theorem",
            "subtype": thm["type"],
            "label": f"{thm['type'].capitalize()} {thm['number']}",
            "name": thm.get("name"),
            "statement": thm["statement"],
            "summary": thm["summary"],
            "dom_node_id": thm["dom_node_id"],
            "section_id": thm["section_id"],
        })
    
    # Convert relationships to edges
    seen_edges = set()
    for rel in state["relationships"]:
        from_id = _resolve_entity_id(rel["from_entity"], state)
        to_id = _resolve_entity_id(rel["to_entity"], state)
        
        # Skip self-references and invalid edges
        if from_id == to_id:
            continue
        
        # Skip edges to non-existent nodes
        if from_id not in seen_node_ids and to_id not in seen_node_ids:
            continue
        
        edge_key = (from_id, to_id, rel["type"])
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        
        edges.append({
            "id": f"{from_id}_to_{to_id}_{rel['type']}",
            "source": from_id,
            "target": to_id,
            "type": rel["type"],
            "evidence": rel["evidence"],
        })
    
    state["graph_data"] = {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "paper_id": state["paper_id"],
            "node_count": len(nodes),
            "edge_count": len(edges),
            "symbol_count": len([n for n in nodes if n["type"] == "symbol"]),
            "definition_count": len([n for n in nodes if n["type"] == "definition"]),
            "theorem_count": len([n for n in nodes if n["type"] == "theorem"]),
        }
    }

    print(f"\n✓ Graph assembly complete!")
    print(f"  → {len(nodes)} unique nodes")
    print(f"  → {len(edges)} edges")

    return state


# =============================================================================
# LangGraph Workflow
# =============================================================================

def create_knowledge_graph_workflow() -> StateGraph:
    """Create the LangGraph workflow for knowledge graph extraction."""
    workflow = StateGraph(GraphState)

    # Add nodes
    workflow.add_node("load_data", load_paper_data)
    workflow.add_node("extract_symbols", extract_symbols)
    workflow.add_node("extract_definitions", extract_definitions)
    workflow.add_node("extract_theorems", extract_theorems)
    workflow.add_node("extract_dependencies", extract_dependencies)
    workflow.add_node("build_graph", build_graph)

    # Define edges
    workflow.set_entry_point("load_data")

    # After loading data, run extractions in parallel
    # These are independent and can run concurrently
    workflow.add_edge("load_data", "extract_symbols")
    workflow.add_edge("load_data", "extract_definitions")
    workflow.add_edge("load_data", "extract_theorems")

    # Dependencies need all three extractions to complete
    workflow.add_edge("extract_symbols", "extract_dependencies")
    workflow.add_edge("extract_definitions", "extract_dependencies")
    workflow.add_edge("extract_theorems", "extract_dependencies")

    # Build graph after dependencies extracted
    workflow.add_edge("extract_dependencies", "build_graph")
    workflow.add_edge("build_graph", END)

    return workflow


def build_kg_for_paper(
    paper_id: str,
    progress_callback=None,
    ai_config: AIConfig | dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Build knowledge graph for a paper.

    This is the main entry point called by the API.

    Args:
        paper_id: The paper ID to build graph for
        progress_callback: Optional callback function(stage, current, total)

    Returns:
        graph_data: Dict with nodes and edges
    """
    workflow = create_knowledge_graph_workflow()
    app = workflow.compile()

    initial_state: GraphState = {
        "paper_id": paper_id,
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbols": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
        "progress_callback": progress_callback,
        "ai_config": ai_config,
    }
    
    result = app.invoke(initial_state)
    
    if result["errors"]:
        print(f"Warnings during extraction: {result['errors']}")
    
    return result["graph_data"]


# =============================================================================
# CLI for Testing
# =============================================================================

if __name__ == "__main__":
    import sys
    import json
    
    if len(sys.argv) < 2:
        print("Usage: python -m backend.app.agents.knowledge_graph <paper_id>")
        sys.exit(1)
    
    paper_id = sys.argv[1]
    print(f"Building knowledge graph for paper: {paper_id}")
    
    graph_data = build_kg_for_paper(paper_id)
    
    print(f"\nExtracted:")
    print(f"  - {graph_data['metadata']['node_count']} nodes")
    print(f"  - {graph_data['metadata']['edge_count']} edges")
    print(f"  - {graph_data['metadata']['symbol_count']} symbols")
    print(f"  - {graph_data['metadata']['definition_count']} definitions")
    print(f"  - {graph_data['metadata']['theorem_count']} theorems")
    
    # Pretty print sample
    print("\nSample nodes:")
    for node in graph_data["nodes"][:5]:
        print(f"  [{node['type']}] {node['label']}")
    
    print("\nSample edges:")
    for edge in graph_data["edges"][:5]:
        print(f"  {edge['source']} --{edge['type']}--> {edge['target']}")
