"""
Knowledge Graph Agent Pipeline

Multi-agent workflow using LangGraph to extract semantic structure from papers
and build a navigable knowledge graph.

Pipeline:
1. Data Loader - Fetches pre-extracted metadata from database
2. Stray Symbol Extraction Agent - Identifies notation introduced outside formula contexts
3. Definition Extraction Agent - Finds formal and informal definitions
4. Theorem Extraction Agent - Extracts theorems, lemmas, corollaries
5. Formula Extraction Agent - Extracts explicit formulas and local symbol meanings
6. Deduplication Agent - Normalizes observations into paper-level entities
7. Dependency Extraction Agent - Maps relationships between entities
8. Graph Builder - Assembles final graph structure
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

# Import shared utilities
from backend.app.agents.utils import (
    TimeoutException,
    run_with_retry,
    strip_html_tags,
    filter_processable_sections,
    get_debug_flag,
)
from backend.app.utils.llm_factory import get_llm, get_structured_llm

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

    # Agent-extracted observations (use Annotated with operator.add for concurrent updates)
    symbol_observations: Annotated[List[Dict[str, Any]], operator.add]
    formula_observations: Annotated[List[Dict[str, Any]], operator.add]
    definition_observations: Annotated[List[Dict[str, Any]], operator.add]
    theorem_observations: Annotated[List[Dict[str, Any]], operator.add]

    # Deduplicated entities
    symbols: List[Dict[str, Any]]
    formulas: List[Dict[str, Any]]
    definitions: List[Dict[str, Any]]
    theorems: List[Dict[str, Any]]

    # Relationships
    relationships: List[Dict[str, Any]]

    # Final output
    graph_data: Dict[str, Any]

    # Error tracking (use Annotated for concurrent error collection)
    errors: Annotated[List[str], operator.add]

    # Progress reporting (optional callback)
    progress_callback: NotRequired[Any]
    llm_profile: NotRequired[Dict[str, Any]]


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


class SymbolObservation(BaseModel):
    """A local symbol observation extracted from prose or a formula"""
    symbol: str = Field(description="The symbol as it appears (e.g., α_t, x)")
    latex: str = Field(description="LaTeX representation wrapped in dollar signs for rendering (e.g., $\\alpha_t$, $x$)")
    context: str = Field(description="Brief explanation of what it represents in this local context (1 sentence)")
    is_definition: bool = Field(description="Is this where the symbol is first defined/introduced?")
    role_in_formula: Optional[str] = Field(default=None, description="Optional short role description when extracted from a formula")
    occurrences: List[Occurrence] = Field(default_factory=list, description="All occurrences of this symbol in the document")


class StraySymbolExtractionOutput(BaseModel):
    """Output from stray symbol extraction agent"""
    symbols: List[SymbolObservation]


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


class Formula(BaseModel):
    """A formula explicitly present in the paper"""
    label: Optional[str] = Field(
        default=None,
        description="Explicit formula name if the paper gives one (e.g., ELBO, Bellman equation), else null"
    )
    latex: str = Field(description="Exact LaTeX or textual form of the formula as it appears in the paper")
    summary: str = Field(description="1-2 sentence summary of the role the formula plays in the paper")
    symbols: List[SymbolObservation] = Field(
        default_factory=list,
        description="Meaningful symbols contained in this formula, with their local meanings"
    )


class FormulaExtractionOutput(BaseModel):
    """Output from formula extraction agent"""
    formulas: List[Formula]


class Relationship(BaseModel):
    """A relationship between entities"""
    from_entity: str = Field(description="Source entity (name or identifier)")
    to_entity: str = Field(description="Target entity (name or identifier)")
    relationship_type: str = Field(description="One of: uses, depends_on, defines, mentions")
    evidence_text: str = Field(description="Text snippet showing this relationship")


class RelationshipExtractionOutput(BaseModel):
    """Output from dependency extraction agent"""
    relationships: List[Relationship]


class SymbolDedupCluster(BaseModel):
    """A cluster of symbol ids that refer to the same paper-level symbol."""
    symbol_ids: List[str] = Field(description="IDs of symbol entities that should be merged")


class SymbolDedupAdjudicationOutput(BaseModel):
    """Structured output for ambiguous symbol deduplication buckets."""
    clusters: List[SymbolDedupCluster] = Field(default_factory=list, description="Duplicate clusters within the candidate bucket")


class FormulaDefinitionAdjudicationOutput(BaseModel):
    """Structured output for one ambiguous formula-definition attachment decision."""
    definition_id: Optional[str] = Field(default=None, description="ID of the matching definition, or null if no safe match exists")


# =============================================================================
# Prompt Templates
# =============================================================================

STRAY_SYMBOL_SYSTEM_PROMPT = """You are a mathematical notation extractor for academic papers.
Extract ONLY mathematically significant symbols that are introduced or discussed outside a formula context.

EXTRACT:
- Symbols defined inline in prose: "Let $\\theta$ denote the model parameters"
- Symbols explained in tables or text paragraphs
- Important notation referenced in prose without being part of a formula extraction target
- Functions or operators if they are explicitly discussed as notation in prose

DO NOT EXTRACT:
- Symbols that are already only meaningful as part of a formula expression in this section
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

IMPORTANT: Be selective. Extract only symbols that are meaningful outside a formula context in this section."""

STRAY_SYMBOL_USER_PROMPT = """Section: {section_title}

Content:
{content_text}

Extract all meaningful stray symbols and notation from this section."""


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


FORMULA_SYSTEM_PROMPT = """You are a formula extractor for academic papers.
Extract formulas that are explicitly present in the paper and matter as mathematical objects in the paper's argument.

EXTRACT:
- Named formulas such as objective functions, governing equations, update rules, constraints, or identities
- Displayed equations that are discussed conceptually in the surrounding text
- Important inline formulas when they are explicitly treated as distinct objects

DO NOT EXTRACT:
- Formulas that are not explicitly present in the paper
- Reconstructed equations for concepts described only in prose
- Every algebraic manipulation step in a derivation
- Trivial assignments like $n = 100$ or $\\epsilon = 0.01$
- Equations with no conceptual role beyond local arithmetic

For each extracted formula, provide:
1. `label`: the explicit formula name if given, otherwise null
2. `latex`: the formula exactly as written in the paper, wrapped in math delimiters for rendering (for example `$...$`)
3. `summary`: a concise explanation of the formula's role in the paper
4. `symbols`: only the meaningful symbols contained in the formula

For each symbol in `symbols`, provide:
1. The symbol in LaTeX wrapped in dollar signs
2. A concise local meaning in the context of this formula
3. Whether the formula is where the symbol is introduced or defined
4. An optional short role in the formula if helpful

IMPORTANT:
- Only include meaningful symbols, not punctuation, syntactic markers, or dummy indices
- Do not invent formulas that do not appear in the paper
- Keep local meanings concise and context-specific"""

FORMULA_USER_PROMPT = """Section: {section_title}

Content:
{content_text}

Extract the important formulas explicitly present in this section."""


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
Formulas:
{formula_list}

Symbols:
{symbol_list}

Definitions:
{definition_list}

Theorems:
{theorem_list}

Extract all dependency relationships visible in this section."""


SYMBOL_DEDUP_SYSTEM_PROMPT = """You are adjudicating ambiguous mathematical symbol deduplication candidates inside one paper.

You will receive a small bucket of symbol entities that all use the same glyph or LaTeX notation.
Your task is to group only the entities that clearly refer to the same paper-level symbol.

Rules:
- Be conservative. If unsure, keep entities separate.
- Do not merge symbols solely because the glyph matches.
- Use concept scope, role in formula, section context, sibling symbols, and meaning text.
- Return clusters only for duplicates. Singletons should be omitted.
- Each symbol id may appear in at most one cluster.
"""

SYMBOL_DEDUP_USER_PROMPT = """Candidate symbol bucket:
{symbol_bucket}

Return only the duplicate clusters."""

FORMULA_DEFINITION_DEDUP_SYSTEM_PROMPT = """You are adjudicating whether one formula entity matches one of several candidate definition entities inside the same paper.

Your task is to decide whether the formula is the mathematical rendering of one candidate definition.

Rules:
- Be conservative. If unsure, return no match.
- Match on combined evidence: term overlap, conceptual summary overlap, and shared math expression.
- Do not match solely because both mention optimization or objective language.
- Choose at most one definition.
- Prefer exact conceptual correspondence over broad topical similarity.
"""

FORMULA_DEFINITION_DEDUP_USER_PROMPT = """Formula candidate:
{formula_candidate}

Definition candidates:
{definition_candidates}

Return the best matching definition id, or null if none is clearly correct."""


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


def _normalize_text(value: Optional[str]) -> str:
    """Normalize free-form text for lightweight deterministic matching."""
    if not value:
        return ""
    normalized = value.lower().strip()
    for old, new in [("\n", " "), ("\t", " "), ("  ", " ")]:
        normalized = normalized.replace(old, new)
    return " ".join(normalized.split())


def _normalize_latex(value: Optional[str]) -> str:
    """Normalize simple LaTeX presentation noise for matching."""
    if not value:
        return ""
    normalized = value.strip().strip("$")
    for old in ["\\left", "\\right", "{", "}", " "]:
        normalized = normalized.replace(old, "")
    return normalized.lower()


def _ensure_math_delimiters(value: Optional[str]) -> str:
    """Wrap math-like content in dollar delimiters if none are present."""
    if not value:
        return ""
    stripped = value.strip()
    if any(token in stripped for token in ["$", "\\(", "\\)", "\\[", "\\]"]):
        return stripped
    return f"${stripped}$"


def _extract_math_signatures(text: Optional[str]) -> List[str]:
    """Extract lightly normalized inline/display math spans from free-form text."""
    import re

    if not text:
        return []

    patterns = [
        r"\$(.+?)\$",
        r"\\\((.+?)\\\)",
        r"\\\[(.+?)\\\]",
    ]
    signatures: List[str] = []
    for pattern in patterns:
        for match in re.findall(pattern, text, flags=re.DOTALL):
            normalized = _normalize_latex(match)
            if normalized and normalized not in signatures:
                signatures.append(normalized)
    return signatures


def _tokenize_text(text: Optional[str]) -> set[str]:
    """Tokenize text into a coarse lowercase word set for overlap checks."""
    import re

    if not text:
        return set()
    return set(re.findall(r"[a-z0-9_]+", text.lower()))


_GENERIC_MATCH_TOKENS = {
    "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "by", "with",
    "loss", "objective", "function", "equation", "formula", "term", "value",
    "model", "paper", "method", "training", "optimization",
}


def _significant_tokens(text: Optional[str]) -> set[str]:
    """Return informative tokens only, excluding common glue and generic KG words."""
    return {token for token in _tokenize_text(text) if token not in _GENERIC_MATCH_TOKENS}


def _has_significant_token_overlap(
    left: Optional[str],
    right: Optional[str],
    minimum_overlap: int = 1,
) -> bool:
    """Check for overlap on informative tokens, excluding generic concept words."""
    overlap = _significant_tokens(left) & _significant_tokens(right)
    return len(overlap) >= minimum_overlap


def _has_meaningful_token_overlap(left: Optional[str], right: Optional[str], minimum_overlap: int = 3) -> bool:
    """Check whether two short summaries share enough substance to support a merge."""
    overlap = _tokenize_text(left) & _tokenize_text(right)
    return len(overlap) >= minimum_overlap


def _section_title_by_id(sections: List[Dict[str, Any]]) -> Dict[str, str]:
    """Build a section_id -> title mapping."""
    return {
        section.get("id", ""): section.get("title", "")
        for section in sections
        if section.get("id")
    }


def _llm_dedup_enabled() -> bool:
    """Check whether LLM dedup adjudication is enabled."""
    return os.getenv("KG_LLM_DEDUP_ENABLED", "false").lower() == "true"


def _make_attachment_provenance(source: str, reason: str, score: Optional[int] = None) -> Dict[str, Any]:
    """Create compact provenance metadata for formula-definition attachments."""
    provenance = {
        "source": source,
        "reason": reason,
    }
    if score is not None:
        provenance["score"] = score
    return provenance


def _normalize_formula_role(role: Optional[str]) -> Optional[str]:
    """Map free-form role descriptions into a small stable vocabulary."""
    normalized = _normalize_text(role)
    if not normalized:
        return None
    if any(token in normalized for token in ["output", "result", "target"]):
        return "output"
    if any(token in normalized for token in ["input", "feature", "argument"]):
        return "input"
    if any(token in normalized for token in ["parameter", "weight", "coefficient"]):
        return "parameter"
    if any(token in normalized for token in ["normalizer", "denominator", "scale"]):
        return "normalizer"
    if any(token in normalized for token in ["state"]):
        return "state"
    return normalized


def _symbol_observation_key(obs: Dict[str, Any]) -> str:
    """Build a conservative key for symbol observation clustering."""
    canonical_key = obs.get("canonical_symbol_key")
    if canonical_key:
        return canonical_key
    return f"{_normalize_latex(obs.get('latex') or obs.get('symbol'))}|{_normalize_text(obs.get('context'))}"


def reconcile_local_subsection_observations(state: GraphState) -> GraphState:
    """Reconcile obvious cross-type overlaps within the same subsection."""
    section_titles = _section_title_by_id(state.get("sections", []))
    formula_observations = [dict(formula) for formula in state["formula_observations"]]
    symbol_observations = [dict(symbol) for symbol in state["symbol_observations"]]
    definition_observations = [dict(defn) for defn in state["definition_observations"]]

    definitions_by_section: Dict[str, List[Dict[str, Any]]] = {}
    formulas_by_section: Dict[str, List[Dict[str, Any]]] = {}
    stray_symbols_by_section: Dict[str, List[Dict[str, Any]]] = {}

    for defn in definition_observations:
        definitions_by_section.setdefault(defn.get("section_id") or "", []).append(defn)

    for formula in formula_observations:
        formulas_by_section.setdefault(formula.get("section_id") or "", []).append(formula)

    for symbol in symbol_observations:
        symbol["scope_level"] = symbol.get("scope_level") or "paper_level"
        symbol["section_title"] = symbol.get("section_title") or section_titles.get(symbol.get("section_id"), "")
        stray_symbols_by_section.setdefault(symbol.get("section_id") or "", []).append(symbol)

    for section_id, formulas in formulas_by_section.items():
        for formula in formulas:
            formula["section_title"] = formula.get("section_title") or section_titles.get(formula.get("section_id"), "")

        definitions = definitions_by_section.get(section_id, [])
        if definitions:
            for defn in definitions:
                defn.setdefault("math_signatures", _extract_math_signatures(defn.get("definition_text")))

            for formula in formulas:
                formula_label = _normalize_text(formula.get("label"))
                formula_latex = _normalize_latex(formula.get("latex"))
                attached_definition = None

                for defn in definitions:
                    term = _normalize_text(defn.get("term"))
                    if formula_label and term and formula_label == term:
                        attached_definition = defn
                        break
                    if formula_latex and formula_latex in (defn.get("math_signatures") or []):
                        attached_definition = defn
                        break

                if attached_definition:
                    formula["attached_definition_term"] = attached_definition.get("term")
                    formula["attached_definition_section_id"] = section_id
                    formula["attachment_provenance"] = _make_attachment_provenance(
                        source="local_reconciliation",
                        reason="same_section_label_or_math_match",
                    )
                    attached_definition.setdefault("attached_formula_keys", [])
                    formula_key = formula.get("formula_key") or formula.get("label") or formula.get("latex")
                    if formula_key and formula_key not in attached_definition["attached_formula_keys"]:
                        attached_definition["attached_formula_keys"].append(formula_key)

        stray_symbols = stray_symbols_by_section.get(section_id, [])
        stray_by_latex: Dict[str, List[Dict[str, Any]]] = {}
        for obs in stray_symbols:
            latex_key = _normalize_latex(obs.get("latex") or obs.get("symbol"))
            if not latex_key:
                continue
            stray_by_latex.setdefault(latex_key, []).append(obs)

        for formula in formulas:
            reconciled_symbols = []
            sibling_latex = [
                _normalize_latex(item.get("latex") or item.get("symbol"))
                for item in formula.get("symbols", [])
                if _normalize_latex(item.get("latex") or item.get("symbol"))
            ]
            for symbol in formula.get("symbols", []):
                symbol_copy = dict(symbol)
                latex_key = _normalize_latex(symbol_copy.get("latex") or symbol_copy.get("symbol"))
                symbol_copy["scope_level"] = "formula_scoped"
                symbol_copy["section_title"] = formula.get("section_title", "")
                symbol_copy["normalized_role_in_formula"] = _normalize_formula_role(symbol_copy.get("role_in_formula"))
                symbol_copy["sibling_symbols"] = [item for item in sibling_latex if item != latex_key]
                candidates = stray_by_latex.get(latex_key, [])
                if len(candidates) == 1:
                    stray = candidates[0]
                    canonical_key = f"{latex_key}|{_normalize_text(stray.get('context'))}"
                    symbol_copy["canonical_symbol_key"] = canonical_key
                    stray["canonical_symbol_key"] = canonical_key
                    symbol_copy["paper_symbol_context"] = stray.get("context")
                reconciled_symbols.append(symbol_copy)
            formula["symbols"] = reconciled_symbols

    return {
        "formula_observations": formula_observations,
        "symbol_observations": symbol_observations,
        "definition_observations": definition_observations,
    }


def _definitions_match(existing: Dict[str, Any], candidate: Dict[str, Any]) -> bool:
    """Determine whether two definition observations should merge deterministically."""
    existing_term = _normalize_text(existing.get("term"))
    candidate_term = _normalize_text(candidate.get("term"))
    if not existing_term or existing_term != candidate_term:
        return False

    existing_math = set(existing.get("math_signatures") or _extract_math_signatures(existing.get("definition_text")))
    candidate_math = set(candidate.get("math_signatures") or _extract_math_signatures(candidate.get("definition_text")))

    if existing_math and candidate_math and existing_math & candidate_math:
        return True

    existing_summary = existing.get("summary") or existing.get("definition_text")
    candidate_summary = candidate.get("summary") or candidate.get("definition_text")
    return _has_meaningful_token_overlap(existing_summary, candidate_summary)


def _definition_formula_match_score(definition: Dict[str, Any], formula: Dict[str, Any]) -> int:
    """Score a definition/formula match using multiple conservative signals."""
    score = 0

    definition_term = definition.get("term")
    formula_label = formula.get("label")
    definition_summary = definition.get("summary") or definition.get("definition_text")
    formula_summary = formula.get("summary")

    if formula_label:
        if _normalize_text(definition_term) == _normalize_text(formula_label):
            score += 4
        elif _has_significant_token_overlap(definition_term, formula_label):
            score += 2

    definition_math = set(definition.get("math_signatures") or _extract_math_signatures(definition.get("definition_text")))
    formula_latex = _normalize_latex(formula.get("latex"))
    if formula_latex and formula_latex in definition_math:
        score += 3

    if _has_meaningful_token_overlap(definition_summary, formula_summary, minimum_overlap=2):
        score += 2
    elif _has_significant_token_overlap(definition_summary, formula_summary):
        score += 1

    return score


def _symbols_approximately_match(existing: Dict[str, Any], candidate: Dict[str, Any]) -> bool:
    """Determine whether two symbol observations with the same glyph are the same paper-level symbol."""
    existing_latex = _normalize_latex(existing.get("latex") or existing.get("symbol"))
    candidate_latex = _normalize_latex(candidate.get("latex") or candidate.get("symbol"))
    if not existing_latex or existing_latex != candidate_latex:
        return False

    existing_context = existing.get("context") or existing.get("paper_symbol_context")
    candidate_context = candidate.get("context") or candidate.get("paper_symbol_context")
    existing_scope = existing.get("scope_level")
    candidate_scope = candidate.get("scope_level")
    existing_section_title = existing.get("section_title")
    candidate_section_title = candidate.get("section_title")
    existing_role = existing.get("normalized_role_in_formula")
    candidate_role = candidate.get("normalized_role_in_formula")
    existing_neighbors = set(existing.get("sibling_symbols", []))
    candidate_neighbors = set(candidate.get("sibling_symbols", []))
    existing_concept = existing.get("concept_scope")
    candidate_concept = candidate.get("concept_scope")

    if _normalize_text(existing_context) == _normalize_text(candidate_context):
        return True

    if _has_meaningful_token_overlap(existing_context, candidate_context, minimum_overlap=2):
        return True

    if existing_concept and candidate_concept and existing_concept == candidate_concept:
        if existing_role and candidate_role and existing_role == candidate_role:
            return True
        if existing_neighbors & candidate_neighbors:
            return True
        if _has_significant_token_overlap(existing_context, candidate_context):
            return True

    existing_formulas = set(existing.get("parent_formula_ids", []))
    candidate_formula = candidate.get("parent_formula_id")
    if candidate_formula and candidate_formula in existing_formulas:
        return True

    if existing_scope == "formula_scoped" and candidate_scope == "formula_scoped":
        if existing_role and candidate_role and existing_role == candidate_role:
            if existing_neighbors & candidate_neighbors:
                return True
            if existing_section_title and candidate_section_title and _has_significant_token_overlap(existing_section_title, candidate_section_title):
                return True

    if existing_scope == candidate_scope and existing_role and candidate_role and existing_role == candidate_role:
        if existing_section_title and candidate_section_title and _has_significant_token_overlap(existing_section_title, candidate_section_title):
            return True

    if existing_section_title and candidate_section_title and _has_significant_token_overlap(existing_section_title, candidate_section_title):
        if _has_significant_token_overlap(existing_context, candidate_context):
            return True

    if existing.get("section_id") == candidate.get("section_id") and _has_significant_token_overlap(existing_context, candidate_context):
        return True

    return False


def _attach_formulas_to_definitions(
    deduped_formulas: List[Dict[str, Any]],
    deduped_definitions: List[Dict[str, Any]],
) -> None:
    """Attach formulas to matching definitions across the paper using deterministic signals."""
    definition_index_by_term: Dict[str, List[int]] = {}
    definition_index_by_math: Dict[str, List[int]] = {}

    for idx, defn in enumerate(deduped_definitions):
        term = _normalize_text(defn.get("term"))
        if term:
            definition_index_by_term.setdefault(term, []).append(idx)

        math_signatures = defn.get("math_signatures") or _extract_math_signatures(defn.get("definition_text"))
        defn["math_signatures"] = math_signatures
        for signature in math_signatures:
            definition_index_by_math.setdefault(signature, []).append(idx)

    for formula in deduped_formulas:
        if formula.get("attached_definition_term"):
            attached_term = _normalize_text(formula.get("attached_definition_term"))
            for idx in definition_index_by_term.get(attached_term, []):
                definition = deduped_definitions[idx]
                if formula["id"] not in definition["attached_formula_ids"]:
                    definition["attached_formula_ids"].append(formula["id"])
                formula.setdefault(
                    "attachment_provenance",
                    _make_attachment_provenance(
                        source="prelinked_attachment",
                        reason="carried_from_prior_reconciliation",
                    ),
                )
                break
            continue

        candidate_indexes: List[int] = []
        label_key = _normalize_text(formula.get("label"))
        latex_key = _normalize_latex(formula.get("latex"))

        if label_key:
            candidate_indexes.extend(definition_index_by_term.get(label_key, []))
        if latex_key:
            candidate_indexes.extend(definition_index_by_math.get(latex_key, []))
        if not candidate_indexes:
            for idx, definition in enumerate(deduped_definitions):
                if _definition_formula_match_score(definition, formula) >= 4:
                    candidate_indexes.append(idx)

        seen_indexes = set()
        for idx in candidate_indexes:
            if idx in seen_indexes:
                continue
            seen_indexes.add(idx)

            definition = deduped_definitions[idx]
            match_score = _definition_formula_match_score(definition, formula)
            if label_key and label_key == _normalize_text(definition.get("term")):
                formula["attached_definition_term"] = definition.get("term")
                formula["attachment_provenance"] = _make_attachment_provenance(
                    source="deterministic_match",
                    reason="exact_term_match",
                    score=match_score,
                )
            elif latex_key and latex_key in (definition.get("math_signatures") or []):
                formula["attached_definition_term"] = definition.get("term")
                formula["attachment_provenance"] = _make_attachment_provenance(
                    source="deterministic_match",
                    reason="shared_math_signature",
                    score=match_score,
                )
            elif match_score >= 4:
                formula["attached_definition_term"] = definition.get("term")
                formula["attachment_provenance"] = _make_attachment_provenance(
                    source="deterministic_match",
                    reason="multi_signal_match",
                    score=match_score,
                )
            else:
                continue

            formula["attached_definition_section_id"] = definition.get("section_id")
            if formula["id"] not in definition["attached_formula_ids"]:
                definition["attached_formula_ids"].append(formula["id"])
            break


def _build_definition_formula_adjudication_buckets(
    deduped_formulas: List[Dict[str, Any]],
    deduped_definitions: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Build small unresolved formula-definition candidate sets for optional adjudication."""
    buckets: List[Dict[str, Any]] = []
    for formula in deduped_formulas:
        if formula.get("attached_definition_term"):
            continue

        candidate_definitions: List[Dict[str, Any]] = []
        for definition in deduped_definitions:
            match_score = _definition_formula_match_score(definition, formula)
            if match_score < 2:
                continue
            candidate_definitions.append({
                "definition": definition,
                "score": match_score,
            })

        if not candidate_definitions:
            continue

        candidate_definitions.sort(key=lambda item: item["score"], reverse=True)
        top_score = candidate_definitions[0]["score"]
        filtered_candidates = [
            item["definition"]
            for item in candidate_definitions
            if item["score"] >= max(2, top_score - 1)
        ][:4]

        if 1 <= len(filtered_candidates) <= 4:
            buckets.append({
                "formula": formula,
                "definitions": filtered_candidates,
            })
    return buckets


def _format_formula_candidate_for_prompt(formula: Dict[str, Any]) -> str:
    """Serialize a formula candidate for adjudication."""
    return "\n".join([
        f"id: {formula['id']}",
        f"label: {formula.get('label')}",
        f"latex: {formula.get('latex')}",
        f"summary: {formula.get('summary')}",
        f"section_title: {formula.get('section_title')}",
        f"aliases: {', '.join(formula.get('aliases', [])) or 'none'}",
    ])


def _format_definition_candidates_for_prompt(definitions: List[Dict[str, Any]]) -> str:
    """Serialize definition candidates for adjudication."""
    chunks = []
    for definition in definitions:
        chunks.append("\n".join([
            f"id: {definition['id']}",
            f"term: {definition.get('term')}",
            f"summary: {definition.get('summary')}",
            f"definition_text: {definition.get('definition_text')}",
            f"math_signatures: {', '.join(definition.get('math_signatures', [])) or 'none'}",
            f"section_id: {definition.get('section_id')}",
        ]))
    return "\n\n".join(chunks)


def _resolve_formula_definition_bucket_with_llm(bucket: Dict[str, Any]) -> Optional[str]:
    """Use the LLM to decide whether a formula matches one candidate definition."""
    llm = get_llm("kg_extraction")
    structured_llm = get_structured_llm(llm, FormulaDefinitionAdjudicationOutput)
    prompt = ChatPromptTemplate.from_messages([
        ("system", FORMULA_DEFINITION_DEDUP_SYSTEM_PROMPT),
        ("user", FORMULA_DEFINITION_DEDUP_USER_PROMPT),
    ])
    chain = prompt | structured_llm

    response = run_with_retry(
        func=chain.invoke,
        max_retries=3,
        base_delay=2.0,
        timeout_seconds=60,
        func_args=({
            "formula_candidate": _format_formula_candidate_for_prompt(bucket["formula"]),
            "definition_candidates": _format_definition_candidates_for_prompt(bucket["definitions"]),
        },),
        profile=bucket.get("llm_profile"),
        profile_stage="kg.dedup.definition_formula_adjudication",
    )
    if response is None:
        return None
    return response.definition_id


def _apply_formula_definition_adjudications(
    deduped_formulas: List[Dict[str, Any]],
    deduped_definitions: List[Dict[str, Any]],
    resolver: Optional[Any] = None,
    llm_profile: Optional[Dict[str, Any]] = None,
) -> None:
    """Optionally attach unresolved formulas to definitions using a resolver or live LLM."""
    active_resolver = resolver
    if active_resolver is None and _llm_dedup_enabled():
        active_resolver = _resolve_formula_definition_bucket_with_llm
    if active_resolver is None:
        return

    buckets = _build_definition_formula_adjudication_buckets(deduped_formulas, deduped_definitions)
    if not buckets:
        return

    definition_by_id = {
        definition["id"]: definition
        for definition in deduped_definitions
        if definition.get("id")
    }
    for bucket in buckets:
        bucket["llm_profile"] = llm_profile
        formula = bucket["formula"]
        if formula.get("attached_definition_term"):
            continue

        selected_definition_id = active_resolver(bucket)
        if not selected_definition_id:
            continue

        definition = definition_by_id.get(selected_definition_id)
        if not definition:
            continue

        formula["attached_definition_term"] = definition.get("term")
        formula["attached_definition_section_id"] = definition.get("section_id")
        formula["attachment_provenance"] = _make_attachment_provenance(
            source="llm_adjudication",
            reason="ambiguous_definition_formula_bucket",
        )
        if formula["id"] not in definition["attached_formula_ids"]:
            definition["attached_formula_ids"].append(formula["id"])


def _propagate_symbol_scope(
    deduped_symbols: List[Dict[str, Any]],
    deduped_formulas: List[Dict[str, Any]],
) -> None:
    """Enrich symbols with concept scope inherited from their parent formulas."""
    formula_scope = {
        formula["id"]: _normalize_text(formula.get("attached_definition_term") or formula.get("label") or formula.get("latex"))
        for formula in deduped_formulas
    }
    formula_section_titles = {
        formula["id"]: formula.get("section_title")
        for formula in deduped_formulas
    }

    for symbol in deduped_symbols:
        symbol.setdefault("scope_level", "paper_level")
        symbol.setdefault("sibling_symbols", [])
        if not symbol.get("normalized_role_in_formula"):
            symbol["normalized_role_in_formula"] = _normalize_formula_role(symbol.get("role_in_formula"))

        concept_scopes = [
            formula_scope.get(formula_id)
            for formula_id in symbol.get("parent_formula_ids", [])
            if formula_scope.get(formula_id)
        ]
        if concept_scopes:
            symbol["concept_scope"] = concept_scopes[0]
            symbol["scope_level"] = "formula_scoped"

        if not symbol.get("section_title"):
            for formula_id in symbol.get("parent_formula_ids", []):
                section_title = formula_section_titles.get(formula_id)
                if section_title:
                    symbol["section_title"] = section_title
                    break


def _build_symbol_adjudication_buckets(deduped_symbols: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Build small ambiguous symbol buckets for optional LLM adjudication."""
    symbols_by_latex: Dict[str, List[Dict[str, Any]]] = {}
    for symbol in deduped_symbols:
        latex_key = _normalize_latex(symbol.get("latex") or symbol.get("symbol"))
        if not latex_key:
            continue
        symbols_by_latex.setdefault(latex_key, []).append(symbol)

    buckets: List[List[Dict[str, Any]]] = []
    for symbols in symbols_by_latex.values():
        if len(symbols) < 2:
            continue
        if len(symbols) <= 4:
            buckets.append(symbols)
    return buckets


def _format_symbol_bucket_for_prompt(symbol_bucket: List[Dict[str, Any]]) -> str:
    """Serialize a symbol bucket into compact text for the adjudication prompt."""
    lines = []
    for symbol in symbol_bucket:
        lines.append(
            "\n".join([
                f"id: {symbol['id']}",
                f"latex: {symbol.get('latex')}",
                f"context: {symbol.get('context')}",
                f"concept_scope: {symbol.get('concept_scope')}",
                f"role: {symbol.get('normalized_role_in_formula')}",
                f"section_title: {symbol.get('section_title')}",
                f"sibling_symbols: {', '.join(symbol.get('sibling_symbols', [])) or 'none'}",
            ])
        )
    return "\n\n".join(lines)


def _resolve_symbol_bucket_with_llm(symbol_bucket: List[Dict[str, Any]], llm_profile: Optional[Dict[str, Any]] = None) -> List[List[str]]:
    """Use the LLM to resolve an ambiguous symbol bucket into duplicate clusters."""
    llm = get_llm("kg_extraction")
    structured_llm = get_structured_llm(llm, SymbolDedupAdjudicationOutput)
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYMBOL_DEDUP_SYSTEM_PROMPT),
        ("user", SYMBOL_DEDUP_USER_PROMPT),
    ])
    chain = prompt | structured_llm

    response = run_with_retry(
        func=chain.invoke,
        max_retries=3,
        base_delay=2.0,
        timeout_seconds=60,
        func_args=({
            "symbol_bucket": _format_symbol_bucket_for_prompt(symbol_bucket),
        },),
        profile=llm_profile,
        profile_stage="kg.dedup.symbol_adjudication",
    )
    if response is None:
        return []
    return [cluster.symbol_ids for cluster in response.clusters if len(cluster.symbol_ids) >= 2]


def _merge_symbol_clusters(
    deduped_symbols: List[Dict[str, Any]],
    clusters: List[List[str]],
) -> List[Dict[str, Any]]:
    """Merge resolved duplicate symbol clusters into canonical symbol entries."""
    symbols_by_id = {symbol["id"]: symbol for symbol in deduped_symbols}
    absorbed_ids = set()

    for cluster in clusters:
        cluster_symbols = [symbols_by_id[symbol_id] for symbol_id in cluster if symbol_id in symbols_by_id and symbol_id not in absorbed_ids]
        if len(cluster_symbols) < 2:
            continue

        canonical = max(cluster_symbols, key=lambda item: (
            len(item.get("context", "")),
            len(item.get("parent_formula_ids", [])),
        ))
        for symbol in cluster_symbols:
            if symbol["id"] == canonical["id"]:
                continue
            if len(symbol.get("context", "")) > len(canonical.get("context", "")):
                canonical["context"] = symbol.get("context")
            if symbol.get("is_definition"):
                canonical["is_definition"] = True
            if not canonical.get("concept_scope") and symbol.get("concept_scope"):
                canonical["concept_scope"] = symbol.get("concept_scope")
            if not canonical.get("section_title") and symbol.get("section_title"):
                canonical["section_title"] = symbol.get("section_title")
            for formula_id in symbol.get("parent_formula_ids", []):
                if formula_id not in canonical["parent_formula_ids"]:
                    canonical["parent_formula_ids"].append(formula_id)
            for sibling in symbol.get("sibling_symbols", []):
                if sibling not in canonical["sibling_symbols"]:
                    canonical["sibling_symbols"].append(sibling)
            absorbed_ids.add(symbol["id"])

    return [symbol for symbol in deduped_symbols if symbol["id"] not in absorbed_ids]


def _adjudicate_ambiguous_symbols(
    deduped_symbols: List[Dict[str, Any]],
    resolver: Optional[Any] = None,
    llm_profile: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Optionally adjudicate ambiguous symbol buckets with a resolver or live LLM."""
    active_resolver = resolver
    if active_resolver is None and _llm_dedup_enabled():
        active_resolver = lambda bucket: _resolve_symbol_bucket_with_llm(bucket, llm_profile=llm_profile)
    if active_resolver is None:
        return deduped_symbols

    buckets = _build_symbol_adjudication_buckets(deduped_symbols)
    if not buckets:
        return deduped_symbols

    merged_symbols = deduped_symbols
    for bucket in buckets:
        clusters = active_resolver(bucket)
        merged_symbols = _merge_symbol_clusters(merged_symbols, clusters)
    return merged_symbols


def extract_stray_symbols(state: GraphState) -> GraphState:
    """Extract mathematically meaningful symbols introduced outside formula contexts."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[1/5] Extracting stray symbols from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = get_llm("kg_extraction")
    structured_llm = get_structured_llm(llm, StraySymbolExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", STRAY_SYMBOL_SYSTEM_PROMPT),
        ("user", STRAY_SYMBOL_USER_PROMPT)
    ])

    chain = prompt | structured_llm
    llm_profile = state.setdefault("llm_profile", {})

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
                    func_args=(invoke_args,),
                    profile=llm_profile,
                    profile_stage="kg.extract_stray_symbols",
                )
            except TimeoutException as te:
                print(f"⏱ Timeout after all retries!")
                section_errors.append(f"Stray symbol extraction timed out for section {section_id} ({section_title})")
                return section_symbols, section_errors
            except Exception as e:
                # This catches non-retryable errors or exhausted retries
                print(f"✗ Failed after retries!")
                error_details = f"Stray symbol extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
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
                    "role_in_formula": symbol.role_in_formula,
                    "source_type": "stray_symbol",
                    "parent_formula_key": None,
                    "section_id": section_id,
                    "dom_node_id": section_id,
                    # Note: occurrences are found lazily at tooltip application time
                })

        except Exception as e:
            print(f"✗ Error: {str(e)}")
            error_details = f"Stray symbol extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
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
    return {"symbol_observations": symbols, "errors": errors}


def extract_formulas(state: GraphState) -> GraphState:
    """Extract formulas explicitly present in the paper, plus local symbol meanings."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[4/5] Extracting formulas from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = get_llm("kg_extraction")
    structured_llm = get_structured_llm(llm, FormulaExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", FORMULA_SYSTEM_PROMPT),
        ("user", FORMULA_USER_PROMPT)
    ])

    chain = prompt | structured_llm
    llm_profile = state.setdefault("llm_profile", {})

    formulas = []
    errors = []

    _report_progress(state, "formulas", 0, len(sections_to_process))

    def process_section(idx_section):
        idx, section = idx_section
        section_formulas = []
        section_errors = []

        try:
            content_text = strip_html_tags(section.get("content_html", ""))
            section_title = section.get("title", "Untitled")
            section_id = section.get("id", "unknown")

            print(f"  [{idx}/{len(sections_to_process)}] {section_title[:50]}...", end=" ", flush=True)

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
                    func_args=(invoke_args,),
                    profile=llm_profile,
                    profile_stage="kg.extract_formulas",
                )
            except TimeoutException:
                print("⏱ Timeout after all retries!")
                section_errors.append(f"Formula extraction timed out for section {section_id} ({section_title})")
                return section_formulas, section_errors
            except Exception as e:
                print("✗ Failed after retries!")
                section_errors.append(
                    f"Formula extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
                )
                return section_formulas, section_errors

            print(f"✓ ({len(response.formulas)} formulas)")

            for formula in response.formulas:
                formula_key = formula.label or formula.latex
                section_formulas.append({
                    "label": formula.label,
                    "latex": _ensure_math_delimiters(formula.latex),
                    "summary": formula.summary,
                    "section_id": section_id,
                    "dom_node_id": section_id,
                    "source_type": "formula",
                    "formula_key": formula_key,
                    "symbols": [
                        {
                            "symbol": symbol.symbol,
                            "latex": symbol.latex,
                            "context": symbol.context,
                            "is_definition": symbol.is_definition,
                            "role_in_formula": symbol.role_in_formula,
                            "source_type": "formula_symbol",
                            "parent_formula_key": formula_key,
                            "section_id": section_id,
                            "dom_node_id": section_id,
                        }
                        for symbol in formula.symbols
                    ],
                })
        except Exception as e:
            print(f"✗ Error: {str(e)}")
            section_errors.append(
                f"Formula extraction failed for section {section_id} ({section_title}): {type(e).__name__}: {str(e)}"
            )

        return section_formulas, section_errors

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(process_section, (idx, section)): idx
            for idx, section in enumerate(sections_to_process, 1)
        }

        completed = 0
        for future in as_completed(futures):
            completed += 1
            section_formulas, section_errors = future.result()
            formulas.extend(section_formulas)
            errors.extend(section_errors)
            _report_progress(state, "formulas", completed, len(sections_to_process))

    print(f"  → Total: {len(formulas)} formulas extracted")
    return {"formula_observations": formulas, "errors": errors}


def extract_definitions(state: GraphState) -> GraphState:
    """Extract definitions using LLM."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[2/5] Extracting definitions from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = get_llm("kg_extraction")
    structured_llm = get_structured_llm(llm, DefinitionExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", DEFINITION_SYSTEM_PROMPT),
        ("user", DEFINITION_USER_PROMPT)
    ])

    chain = prompt | structured_llm
    llm_profile = state.setdefault("llm_profile", {})

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
                    func_args=(invoke_args,),
                    profile=llm_profile,
                    profile_stage="kg.extract_definitions",
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
    return {"definition_observations": definitions, "errors": errors}


def extract_theorems(state: GraphState) -> GraphState:
    """Extract theorems, lemmas, corollaries using LLM."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[3/5] Extracting theorems from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = get_llm("kg_extraction")
    structured_llm = get_structured_llm(llm, TheoremExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", THEOREM_SYSTEM_PROMPT),
        ("user", THEOREM_USER_PROMPT)
    ])

    chain = prompt | structured_llm
    llm_profile = state.setdefault("llm_profile", {})

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
                    func_args=(invoke_args,),
                    profile=llm_profile,
                    profile_stage="kg.extract_theorems",
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
    return {"theorem_observations": theorems, "errors": errors}


def deduplicate_entities(
    state: GraphState,
    symbol_bucket_resolver: Optional[Any] = None,
    definition_formula_resolver: Optional[Any] = None,
) -> GraphState:
    """Normalize local observations into paper-level entities."""
    print("\n[5/7] Deduplicating extracted entities...")

    reconciled = reconcile_local_subsection_observations(state)
    llm_profile = state.setdefault("llm_profile", {})

    deduped_formulas: List[Dict[str, Any]] = []
    formula_index_by_key: Dict[str, int] = {}
    formula_symbol_links: Dict[str, List[Dict[str, Any]]] = {}

    for formula in reconciled["formula_observations"]:
        normalized_label = _normalize_text(formula.get("label"))
        normalized_latex = _normalize_latex(formula.get("latex"))
        formula_key = normalized_label or normalized_latex or _normalize_text(formula.get("summary"))
        if not formula_key:
            continue

        existing_idx = formula_index_by_key.get(formula_key)
        if existing_idx is None:
            formula_id = f"formula_{_sanitize_id(formula.get('label') or formula.get('latex') or formula_key)}"
            formula_entry = {
                "id": formula_id,
                "label": formula.get("label") or formula.get("latex"),
                "latex": formula.get("latex"),
                "summary": formula.get("summary"),
                "aliases": [formula.get("label")] if formula.get("label") else [],
                "section_id": formula.get("section_id"),
                "section_title": formula.get("section_title"),
                "dom_node_id": formula.get("dom_node_id"),
                "attached_definition_term": formula.get("attached_definition_term"),
                "attached_definition_section_id": formula.get("attached_definition_section_id"),
                "attachment_provenance": formula.get("attachment_provenance"),
            }
            deduped_formulas.append(formula_entry)
            formula_index_by_key[formula_key] = len(deduped_formulas) - 1
            formula_symbol_links[formula_id] = list(formula.get("symbols", []))
        else:
            existing = deduped_formulas[existing_idx]
            alias = formula.get("label")
            if alias and alias not in existing["aliases"]:
                existing["aliases"].append(alias)
            if len(formula.get("summary", "")) > len(existing.get("summary", "")):
                existing["summary"] = formula.get("summary")
            if len(formula.get("latex", "")) > len(existing.get("latex", "")):
                existing["latex"] = formula.get("latex")
            if not existing.get("attached_definition_term") and formula.get("attached_definition_term"):
                existing["attached_definition_term"] = formula.get("attached_definition_term")
                existing["attached_definition_section_id"] = formula.get("attached_definition_section_id")
            if not existing.get("attachment_provenance") and formula.get("attachment_provenance"):
                existing["attachment_provenance"] = formula.get("attachment_provenance")
            formula_symbol_links[existing["id"]].extend(formula.get("symbols", []))

    symbol_observations = list(reconciled["symbol_observations"])
    for formula_id, observations in formula_symbol_links.items():
        for obs in observations:
            obs = dict(obs)
            obs["parent_formula_id"] = formula_id
            symbol_observations.append(obs)

    deduped_symbols: List[Dict[str, Any]] = []
    symbol_index_by_key: Dict[str, int] = {}
    symbol_indexes_by_latex: Dict[str, List[int]] = {}

    for obs in symbol_observations:
        symbol_key = _symbol_observation_key(obs)
        if not symbol_key.strip("|"):
            continue

        latex_key = _normalize_latex(obs.get("latex") or obs.get("symbol"))

        existing_idx = symbol_index_by_key.get(symbol_key)
        if existing_idx is None:
            candidate_indexes = symbol_indexes_by_latex.get(latex_key, [])
            for idx in candidate_indexes:
                existing = deduped_symbols[idx]
                if _symbols_approximately_match(existing, obs):
                    existing_idx = idx
                    break
        if existing_idx is None:
            for idx, existing in enumerate(deduped_symbols):
                if _symbols_approximately_match(existing, obs):
                    existing_idx = idx
                    break
        if existing_idx is None:
            symbol_id_parts = [
                obs.get("symbol") or obs.get("latex") or symbol_key,
                obs.get("section_id"),
                obs.get("dom_node_id"),
                str(len(deduped_symbols)),
            ]
            symbol_id = f"symbol_{_sanitize_id('|'.join(part for part in symbol_id_parts if part))}"
            deduped_symbols.append({
                "id": symbol_id,
                "symbol": obs.get("symbol"),
                "label": obs.get("symbol"),
                "latex": obs.get("latex"),
                "context": obs.get("context"),
                "scope": obs.get("section_id"),
                "scope_level": obs.get("scope_level"),
                "section_id": obs.get("section_id"),
                "section_title": obs.get("section_title"),
                "dom_node_id": obs.get("dom_node_id"),
                "is_definition": obs.get("is_definition", False),
                "role_in_formula": obs.get("role_in_formula"),
                "normalized_role_in_formula": obs.get("normalized_role_in_formula"),
                "sibling_symbols": list(obs.get("sibling_symbols", [])),
                "concept_scope": obs.get("concept_scope"),
                "parent_formula_ids": [obs["parent_formula_id"]] if obs.get("parent_formula_id") else [],
            })
            symbol_index_by_key[symbol_key] = len(deduped_symbols) - 1
            if latex_key:
                symbol_indexes_by_latex.setdefault(latex_key, []).append(len(deduped_symbols) - 1)
        else:
            existing = deduped_symbols[existing_idx]
            if len(obs.get("context", "")) > len(existing.get("context", "")):
                existing["context"] = obs.get("context")
            if obs.get("is_definition"):
                existing["is_definition"] = True
            if not existing.get("section_title") and obs.get("section_title"):
                existing["section_title"] = obs.get("section_title")
            if not existing.get("normalized_role_in_formula") and obs.get("normalized_role_in_formula"):
                existing["normalized_role_in_formula"] = obs.get("normalized_role_in_formula")
            if not existing.get("role_in_formula") and obs.get("role_in_formula"):
                existing["role_in_formula"] = obs.get("role_in_formula")
            if not existing.get("concept_scope") and obs.get("concept_scope"):
                existing["concept_scope"] = obs.get("concept_scope")
            for sibling in obs.get("sibling_symbols", []):
                if sibling not in existing["sibling_symbols"]:
                    existing["sibling_symbols"].append(sibling)
            parent_formula_id = obs.get("parent_formula_id")
            if parent_formula_id and parent_formula_id not in existing["parent_formula_ids"]:
                existing["parent_formula_ids"].append(parent_formula_id)
            symbol_index_by_key[symbol_key] = existing_idx
            if latex_key and existing_idx not in symbol_indexes_by_latex.get(latex_key, []):
                symbol_indexes_by_latex.setdefault(latex_key, []).append(existing_idx)

    deduped_definitions: List[Dict[str, Any]] = []
    for defn in reconciled["definition_observations"]:
        defn = dict(defn)
        defn["math_signatures"] = defn.get("math_signatures") or _extract_math_signatures(defn.get("definition_text"))
        defn.setdefault("attached_formula_ids", [])

        existing_idx = None
        for idx, existing in enumerate(deduped_definitions):
            if _definitions_match(existing, defn):
                existing_idx = idx
                break

        if existing_idx is None:
            definition_id_parts = [
                defn.get("term"),
                defn.get("section_id"),
                defn.get("dom_node_id"),
                str(len(deduped_definitions)),
            ]
            defn["id"] = f"definition_{_sanitize_id('|'.join(part for part in definition_id_parts if part))}"
            deduped_definitions.append(defn)
            continue

        existing = deduped_definitions[existing_idx]
        if len(defn.get("summary", "")) > len(existing.get("summary", "")):
            existing["summary"] = defn.get("summary")
        if len(defn.get("definition_text", "")) > len(existing.get("definition_text", "")):
            existing["definition_text"] = defn.get("definition_text")
        if defn.get("is_formal"):
            existing["is_formal"] = True
        if defn.get("definition_number") and not existing.get("definition_number"):
            existing["definition_number"] = defn.get("definition_number")
        for formula_key in defn.get("attached_formula_keys", []):
            existing.setdefault("attached_formula_keys", [])
            if formula_key not in existing["attached_formula_keys"]:
                existing["attached_formula_keys"].append(formula_key)
        for signature in defn.get("math_signatures", []):
            if signature not in existing["math_signatures"]:
                existing["math_signatures"].append(signature)

    deduped_theorems: List[Dict[str, Any]] = []
    seen_theorems = set()
    for thm in state["theorem_observations"]:
        key = f"{_normalize_text(thm.get('type'))}:{_normalize_text(thm.get('number'))}"
        if not key or key in seen_theorems:
            continue
        seen_theorems.add(key)
        deduped_theorems.append(thm)

    _attach_formulas_to_definitions(deduped_formulas, deduped_definitions)
    _apply_formula_definition_adjudications(
        deduped_formulas,
        deduped_definitions,
        resolver=definition_formula_resolver,
        llm_profile=llm_profile,
    )
    _propagate_symbol_scope(deduped_symbols, deduped_formulas)
    deduped_symbols = _adjudicate_ambiguous_symbols(
        deduped_symbols,
        resolver=symbol_bucket_resolver,
        llm_profile=llm_profile,
    )

    formula_ids = {formula["id"] for formula in deduped_formulas}
    formula_to_symbol_ids: Dict[str, List[str]] = {formula_id: [] for formula_id in formula_ids}
    for symbol in deduped_symbols:
        for formula_id in symbol.get("parent_formula_ids", []):
            if formula_id in formula_to_symbol_ids and symbol["id"] not in formula_to_symbol_ids[formula_id]:
                formula_to_symbol_ids[formula_id].append(symbol["id"])

    for formula in deduped_formulas:
        formula["symbol_ids"] = formula_to_symbol_ids.get(formula["id"], [])

    print(f"  → {len(deduped_formulas)} formulas")
    print(f"  → {len(deduped_symbols)} symbols")
    print(f"  → {len(deduped_definitions)} definitions")
    print(f"  → {len(deduped_theorems)} theorems")

    return {
        "formulas": deduped_formulas,
        "symbols": deduped_symbols,
        "definitions": deduped_definitions,
        "theorems": deduped_theorems,
    }


def extract_dependencies(state: GraphState) -> GraphState:
    """Extract relationships between entities."""
    sections_to_process = [s for s in state["sections"] if len(strip_html_tags(s.get("content_html", ""))) >= 50]
    worker_count = _get_worker_count()

    print(f"\n[6/7] Extracting relationships from {len(sections_to_process)} sections (using {worker_count} workers)...")

    llm = get_llm("kg_extraction")
    structured_llm = get_structured_llm(llm, RelationshipExtractionOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", DEPENDENCY_SYSTEM_PROMPT),
        ("user", DEPENDENCY_USER_PROMPT)
    ])

    chain = prompt | structured_llm
    llm_profile = state.setdefault("llm_profile", {})

    # Prepare entity lists for context with summaries (pass ALL entities to each section)
    formula_list = [
        f"{f['label'] or f['latex']}: {f['summary']}"
        for f in state["formulas"]
    ]
    symbol_list = [f"{s['symbol']}: {s['context']}" for s in state["symbols"]]
    definition_list = [f"{d['term']}: {d['summary']}" for d in state["definitions"]]
    theorem_list = [
        f"{t['type'].capitalize()} {t['number']}" +
        (f" ({t['name']})" if t.get('name') else "") +
        f": {t['summary']}"
        for t in state["theorems"]
    ]

    print(
        f"  Context: {len(formula_list)} formulas, {len(symbol_list)} symbols, "
        f"{len(definition_list)} definitions, {len(theorem_list)} theorems"
    )

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
                    "formula_list": "\n".join(f"- {f}" for f in formula_list[:30]) if formula_list else "None found",
                    "symbol_list": "\n".join(f"- {s}" for s in symbol_list[:50]) if symbol_list else "None found",
                    "definition_list": "\n".join(f"- {d}" for d in definition_list[:30]) if definition_list else "None found",
                    "theorem_list": "\n".join(f"- {t}" for t in theorem_list[:20]) if theorem_list else "None found",
                }
                response = run_with_retry(
                    func=chain.invoke,
                    max_retries=3,
                    base_delay=2.0,
                    timeout_seconds=120,
                    func_args=(invoke_args,),
                    profile=llm_profile,
                    profile_stage="kg.extract_dependencies",
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

    # Check formulas
    for formula in state["formulas"]:
        label = (formula.get("label") or "").lower()
        latex = (formula.get("latex") or "").lower()
        aliases = [alias.lower() for alias in formula.get("aliases", []) if alias]
        if entity_lower in {label, latex, *aliases}:
            return formula["id"]

    # Check symbols
    for symbol in state["symbols"]:
        if symbol["symbol"].lower() == entity_lower or symbol["latex"].lower() == entity_lower:
            return symbol["id"]
    
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
    print(f"\n[7/7] Building graph from extracted entities...")
    print(f"  Formulas: {len(state['formulas'])}")
    print(f"  Symbols: {len(state['symbols'])}")
    print(f"  Definitions: {len(state['definitions'])}")
    print(f"  Theorems: {len(state['theorems'])}")
    print(f"  Relationships: {len(state['relationships'])}")

    nodes = []
    edges = []
    seen_node_ids = set()
    
    # Convert formulas to nodes
    for formula in state["formulas"]:
        node_id = formula["id"]
        if node_id in seen_node_ids:
            continue
        seen_node_ids.add(node_id)

        nodes.append({
            "id": node_id,
            "type": "formula",
            "label": formula["label"] or formula["latex"],
            "latex": formula["latex"],
            "summary": formula["summary"],
            "aliases": formula.get("aliases", []),
            "attached_definition_term": formula.get("attached_definition_term"),
            "attachment_provenance": formula.get("attachment_provenance"),
            "dom_node_id": formula["dom_node_id"],
            "section_id": formula["section_id"],
        })

    # Convert symbols to nodes
    for symbol in state["symbols"]:
        node_id = symbol["id"]
        if node_id in seen_node_ids:
            continue
        seen_node_ids.add(node_id)

        nodes.append({
            "id": node_id,
            "type": "symbol",
            "label": symbol["label"],
            "latex": symbol["latex"],
            "context": symbol["context"],
            "scope": symbol.get("scope"),
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
            "attached_formula_ids": defn.get("attached_formula_ids", []),
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
    
    # Structural edges from formulas to their symbols
    seen_edges = set()
    definition_id_by_term = {
        _normalize_text(defn["term"]): f"def_{_sanitize_id(defn['term'])}"
        for defn in state["definitions"]
    }

    # Structural edges from definitions to formulas when local reconciliation linked them
    for formula in state["formulas"]:
        attached_term = _normalize_text(formula.get("attached_definition_term"))
        definition_id = definition_id_by_term.get(attached_term)
        if not definition_id:
            continue
        edge_key = (definition_id, formula["id"], "defines")
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        edges.append({
            "id": f"{definition_id}_to_{formula['id']}_defines",
            "source": definition_id,
            "target": formula["id"],
            "type": "defines",
            "evidence": (
                formula.get("attachment_provenance", {}).get("reason")
                or "Definition linked to its formula representation"
            ),
            "provenance": formula.get("attachment_provenance"),
        })

    for formula in state["formulas"]:
        for symbol_id in formula.get("symbol_ids", []):
            edge_key = (formula["id"], symbol_id, "has_symbol")
            if edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)
            edges.append({
                "id": f"{formula['id']}_to_{symbol_id}_has_symbol",
                "source": formula["id"],
                "target": symbol_id,
                "type": "has_symbol",
                "evidence": "Symbol extracted as part of formula context",
            })

    # Convert relationships to edges
    for rel in state["relationships"]:
        from_id = _resolve_entity_id(rel["from_entity"], state)
        to_id = _resolve_entity_id(rel["to_entity"], state)
        
        # Skip self-references and invalid edges
        if from_id == to_id:
            continue
        
        # Skip edges to non-existent nodes
        if from_id not in seen_node_ids or to_id not in seen_node_ids:
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
            "entity_counts": {
                "formula": len([n for n in nodes if n["type"] == "formula"]),
                "symbol": len([n for n in nodes if n["type"] == "symbol"]),
                "definition": len([n for n in nodes if n["type"] == "definition"]),
                "theorem": len([n for n in nodes if n["type"] == "theorem"]),
            },
            "formula_count": len([n for n in nodes if n["type"] == "formula"]),
            "symbol_count": len([n for n in nodes if n["type"] == "symbol"]),
            "definition_count": len([n for n in nodes if n["type"] == "definition"]),
            "theorem_count": len([n for n in nodes if n["type"] == "theorem"]),
            "llm_profile": state.get("llm_profile", {}),
        }
    }

    print(f"\n✓ Graph assembly complete!")
    print(f"  → {len(nodes)} unique nodes")
    print(f"  → {len(edges)} edges")

    return state


def _print_llm_profile_summary(llm_profile: Dict[str, Any]) -> None:
    """Print a compact LLM stage profile for KG debug runs."""
    if not llm_profile:
        print("\nLLM profile: no recorded calls")
        return

    print("\nLLM profile by stage:")
    ranked_stages = sorted(
        llm_profile.items(),
        key=lambda item: item[1].get("wall_time_seconds", 0.0),
        reverse=True,
    )
    for stage_name, metrics in ranked_stages:
        calls = metrics.get("calls", 0)
        retries = metrics.get("retries", 0)
        elapsed = metrics.get("wall_time_seconds", 0.0)
        total_tokens = metrics.get("total_tokens", 0)
        usage_calls = metrics.get("usage_available_calls", 0)
        usage_suffix = f", tokens={total_tokens}" if usage_calls else ", tokens=n/a"
        print(
            f"  - {stage_name}: calls={calls}, retries={retries}, "
            f"time={elapsed:.2f}s{usage_suffix}"
        )


# =============================================================================
# LangGraph Workflow
# =============================================================================

def create_knowledge_graph_workflow() -> StateGraph:
    """Create the LangGraph workflow for knowledge graph extraction."""
    workflow = StateGraph(GraphState)

    # Add nodes
    workflow.add_node("load_data", load_paper_data)
    workflow.add_node("extract_stray_symbols", extract_stray_symbols)
    workflow.add_node("extract_definitions", extract_definitions)
    workflow.add_node("extract_theorems", extract_theorems)
    workflow.add_node("extract_formulas", extract_formulas)
    workflow.add_node("deduplicate_entities", deduplicate_entities)
    workflow.add_node("extract_dependencies", extract_dependencies)
    workflow.add_node("build_graph", build_graph)

    # Define edges
    workflow.set_entry_point("load_data")

    # After loading data, run extractions in parallel
    # These are independent and can run concurrently
    workflow.add_edge("load_data", "extract_stray_symbols")
    workflow.add_edge("load_data", "extract_definitions")
    workflow.add_edge("load_data", "extract_theorems")
    workflow.add_edge("load_data", "extract_formulas")

    # Deduplication needs all extraction stages to complete
    workflow.add_edge("extract_stray_symbols", "deduplicate_entities")
    workflow.add_edge("extract_definitions", "deduplicate_entities")
    workflow.add_edge("extract_theorems", "deduplicate_entities")
    workflow.add_edge("extract_formulas", "deduplicate_entities")

    # Dependencies operate on the deduplicated entity set
    workflow.add_edge("deduplicate_entities", "extract_dependencies")

    # Build graph after dependencies extracted
    workflow.add_edge("extract_dependencies", "build_graph")
    workflow.add_edge("build_graph", END)

    return workflow


def build_kg_for_paper(paper_id: str, progress_callback=None) -> Dict[str, Any]:
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
        "symbol_observations": [],
        "formula_observations": [],
        "definition_observations": [],
        "theorem_observations": [],
        "formulas": [],
        "symbols": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
        "progress_callback": progress_callback,
        "llm_profile": {},
    }
    
    result = app.invoke(initial_state)
    
    if result["errors"]:
        print(f"Warnings during extraction: {result['errors']}")
    if get_debug_flag("KG_DEBUG"):
        _print_llm_profile_summary(result.get("llm_profile", {}))
    
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
    print(f"  - {graph_data['metadata']['formula_count']} formulas")
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
