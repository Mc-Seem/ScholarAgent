# Knowledge Graph Pipeline

Reference for the LangGraph-based knowledge graph extraction pipeline.

> **Status**: Schema v3 is active. The older four-extractor and three-stage reconciliation implementation remains only as inactive migration/reference code.

## Current Canonical Pipeline

```text
load_paper_data
  ├─ extract_section_observations  (topic/claim/procedure/artifact/quantity)
  └─ anchor_equations              (compiler IDs + one bounded equation analysis)
             ↓
build_canonical_document           (objects, relations, notation, explanations)
             ↓
deterministic occurrence anchoring (exact DOM/equation offsets)
             ↓
Paper.knowledge_graph              (validated schema-v3 JSON document)
```

`KnowledgeGraphDocument` is defined in `backend/app/agents/knowledge_graph_models.py`. It contains build metadata, immutable observations, semantic objects, evidence-backed relations, equations, scoped notation, reusable explanations, exact occurrences, and diagnostics. Persistence reparses the document before committing it; schema v1/v2 documents require a rebuild.

Graph object kinds are `topic`, `claim`, `procedure`, `artifact`, and `quantity`. Paper roles and domain-specific kinds are independent roles/facets. Equations and notation are representations used by Equation Lens and glossary lookup, not automatic graph peers. Allowed relations are `is_a`, `part_of`, `uses`, `depends_on`, `applies_to`, `produces`, `supports`, `challenges`, and `compares_with`; qualifiers carry context such as `evaluation`, `measurement`, or `limitation`.

Stable IDs derive from normalized semantic/math signatures and paper scope rather than extraction order. Every relation requires canonical endpoints and source-observation evidence. Documents without `schema_version` are legacy and return a rebuild-required state from projection endpoints.

### Projection Consumers

- `knowledge_graph_projection.py` provides ranked overviews (default 20, hard cap 30), one-hop/source-focused subgraphs (hard cap 50 nodes/100 edges), and server search.
- Overview selection protects core contributions and connected neighbors, then emits an information/confidence-ranked spanning backbone. Ordinary nodes are preferentially capped at two overview links; focused expansion retains all canonical relations within its explicit edge budget. Responses expose global and per-node omitted-relation counts.
- The web and Theia clients use `frontend/lib/knowledge-graph-api.ts`; neither downloads the canonical export for rendering.
- `tooltip_suggestion.py` consumes reusable explanation subjects and their complete occurrence lists, independently of graph rank.
- Occurrences live only in the semantic document: stored drafts keep label, type and text, so `/tooltips/apply` looks the anchors up by subject id instead of trusting the request. Applying a draft therefore highlights terms even though the drafts panel knows nothing about positions.
- Anchoring tolerates real LaTeXML output: a term split across inline tags is wrapped piecewise into adjacent spans sharing one occurrence id, and an occurrence whose text moved or whose node vanished is reported as skipped rather than failing the whole apply.
- What may be anchored is defined once, in `backend/app/compiler/occurrence_text.py`, and shared by the builder and the injector. Every `data-id` element is scanned except math, a nested `data-id` node's text belongs to that node alone, and already anchored text still counts toward offsets. The earlier "childless nodes only" rule silently skipped every paragraph containing an inline formula, because LaTeXML gives each `<math>` its own `data-id` -- and, conversely, matched terms inside the TeX source kept in `<annotation>`, which corrupted the formula.
- Anchoring is deterministic and observations are persisted, so `POST /knowledge-graph/reanchor` recomputes occurrences from the stored document plus section HTML. An improved anchoring rule therefore costs no extraction rerun; only the anchors change, subject ids and reader notes survive.
- `semantic_routes.py` serves bounded section annotations, subject/evidence details, Equation Lens data, and glossary results.
- Equation observations are anchored deterministically from compiler records, so their `quote` is the equation LaTeX itself rather than a supporting sentence. Only text-derived observations carry a real quote; clients present equation evidence as a location (section plus anchored node) instead of echoing the formula.
- Notation meanings are requested as inline LaTeX between single dollar signs. Documents built before that rule stored bare fragments, so the reader wraps them client-side rather than rewriting stored graphs.
- Equation analysis returns an identifying noun phrase and notation only. The former free-form `paper_role` label had no vocabulary and no length bound, so it collected whole sentences and duplicated the summary above it; no closed vocabulary covers every field honestly, so the field was retired instead of narrowed. `EquationRecord` drops the key from already stored documents so they keep loading.
- `knowledge_graph_retrieval.py` is an offline experiment only. The measured decision in `docs/kg-retrieval-evaluation.md` keeps passage-only retrieval as the runtime default.

Canonicalization records same-name cross-kind collisions such as a `topic` and `procedure` both named `SLIME` as diagnostics. It deliberately does not merge them automatically: a shared label is review evidence, not proof of identity.

## Legacy Pipeline Reference (Inactive)

```
┌─────────────────────┐
│    load_paper_data   │  ← Load pre-extracted sections from DB
└──────────┬──────────┘
           │
   ┌───────┼───────────────┬──────────────────┬──────────────────┐
   ▼       ▼               ▼                  ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│extract_stray │ │extract_      │ │extract_      │ │extract_      │
│_symbols      │ │definitions   │ │theorems      │ │formulas      │
│    (LLM)     │ │    (LLM)     │ │    (LLM)     │ │    (LLM)     │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │                │
       └────────────────┼────────────────┼────────────────┘
                        ▼
          ┌─────────────────────────────┐
          │  deduplicate_entities        │  ← 3-stage dedup (see below)
          │  (no LLM, deterministic)     │
          └──────────────┬──────────────┘
                         ▼
          ┌─────────────────────────────┐
          │  extract_dependencies        │  ← LLM, operates on deduplicated set
          └──────────────┬──────────────┘
                         ▼
          ┌─────────────────────────────┐
          │      build_graph             │  ← Pure logic, assembles nodes + edges
          └──────────────┬──────────────┘
                         ▼
                    graph_data
```

**Key Features:**
- Stages 1-4 run **in parallel** (stray symbols, definitions, theorems, formulas)
- Formula extraction also emits formula-scoped symbol observations
- Deduplication runs after all extractions complete (fan-in)
- Dependency extraction operates on the deduplicated entity set
- Real-time progress via SSE

---

## State Schema

```python
class GraphState(TypedDict):
    paper_id: str

    # Pre-extracted (from Phase 0 compile-time)
    sections: List[Dict]
    equations: List[Dict]
    citations: List[Dict]
    latex_source: Optional[str]

    # Agent-extracted observations (Annotated for parallel updates)
    symbol_observations: Annotated[List[Dict], operator.add]
    formula_observations: Annotated[List[Dict], operator.add]
    definition_observations: Annotated[List[Dict], operator.add]
    theorem_observations: Annotated[List[Dict], operator.add]

    # Deduplicated entities
    symbols: List[Dict]
    formulas: List[Dict]
    definitions: List[Dict]
    theorems: List[Dict]

    # Relationships
    relationships: List[Dict]

    # Final output
    graph_data: Dict

    # Error tracking
    errors: Annotated[List[str], operator.add]

    # Optional
    progress_callback: NotRequired[Any]
    llm_profile: NotRequired[Dict]
```

---

## Entity Types

Four first-class entity types in the pipeline:

| Type | Pydantic Model | ID Pattern | Description |
|------|---------------|------------|-------------|
| **Symbol** | `SymbolObservation` | `symbol_{name}_{hash}` | Mathematical notation, either paper-level (stray) or formula-scoped |
| **Definition** | `Definition` | `definition_{term}_{hash}` | Concept-level prose definitions |
| **Theorem** | `Theorem` | `theorem_{type}_{number}` | Theorems, lemmas, corollaries, propositions |
| **Formula** | `Formula` | `formula_{label_or_latex}` | Named or important formulas explicitly present in the paper |

### Formula Model

```python
class Formula(BaseModel):
    label: Optional[str]        # Explicit name (e.g., "ELBO"), else null
    latex: str                  # Exact formula as written
    summary: str                # 1-2 sentence role description
    symbols: List[SymbolObservation]  # Formula-scoped symbol observations
```

### Stray vs Formula-Scoped Symbols

- **Stray symbols**: Introduced in prose, tables, or text without a formula parent
- **Formula-scoped symbols**: Emitted during formula extraction, attached to their parent formula

Both are extracted separately but merged into unified `symbol` nodes during deduplication.

---

## Deduplication Pipeline (3-stage)

Implemented in `deduplicate_entities()`, following the design in `docs/kg-deduplication-plan.md`:

### Stage 1: Local Subsection Reconciliation (`reconcile_local_subsection_observations`)
- Runs before global dedup
- Catches obvious cross-type overlaps within the same subsection (e.g., a definition and formula for the same concept in the same passage)
- Uses shared `section_id`, nearby `dom_node_id`, overlapping names/aliases, and math signatures
- Can attach formulas to definitions and mark stray symbols as formula-scoped when evidence is strong

### Stage 2: Within-Type Global Merging
- **Formulas**: Merged by normalized `label → latex → summary` key
- **Symbols**: Merged by normalized `latex + context` key
- **Definitions**: Merged by normalized `term`
- **Theorems**: Merged by normalized `type + number`

### Stage 3: Cross-Type Reconciliation
- Reconciles merged entities across types using precedence rules
- Default precedence: `definition > formula`, `stray symbol > formula-scoped symbol`
- Operations: `promote` (keep canonical), `attach` (keep as representation), `absorb` (collapse with provenance), `keep_separate`
- Currently deterministic; LLM adjudication for ambiguous buckets is planned but not yet implemented

---

## Edge Types

| Edge Type | Direction | Description |
|-----------|-----------|-------------|
| `has_symbol` | formula → symbol | Structural edge for formula-contained notation |
| `defines` | definition → symbol/formula | Definition introduces a concept |
| `uses` | theorem → formula/symbol, formula → definition/symbol | Usage relationship |
| `depends_on` | entity → entity | Dependency (retained where useful) |
| `mentions` | entity → entity | Weakest relationship class |

---

## Workflow Definition

```python
workflow = StateGraph(GraphState)

# Nodes
workflow.add_node("load_data", load_paper_data)
workflow.add_node("extract_stray_symbols", extract_stray_symbols)
workflow.add_node("extract_definitions", extract_definitions)
workflow.add_node("extract_theorems", extract_theorems)
workflow.add_node("extract_formulas", extract_formulas)
workflow.add_node("deduplicate_entities", deduplicate_entities)
workflow.add_node("extract_dependencies", extract_dependencies)
workflow.add_node("build_graph", build_graph)

# Parallel extraction (fan-out from load_data)
workflow.add_edge("load_data", "extract_stray_symbols")
workflow.add_edge("load_data", "extract_definitions")
workflow.add_edge("load_data", "extract_theorems")
workflow.add_edge("load_data", "extract_formulas")

# Fan-in to deduplication
workflow.add_edge("extract_stray_symbols", "deduplicate_entities")
workflow.add_edge("extract_definitions", "deduplicate_entities")
workflow.add_edge("extract_theorems", "deduplicate_entities")
workflow.add_edge("extract_formulas", "deduplicate_entities")

# Sequential: dedup → dependencies → graph
workflow.add_edge("deduplicate_entities", "extract_dependencies")
workflow.add_edge("extract_dependencies", "build_graph")
workflow.add_edge("build_graph", END)
```

---

## Graph Output Structure

```json
{
  "nodes": [
    {
      "id": "formula_elbo",
      "type": "formula",
      "label": "ELBO",
      "latex": "\\mathcal{L} = ...",
      "summary": "Evidence lower bound used for variational inference",
      "aliases": ["ELBO"],
      "attached_definition_term": "Evidence Lower Bound",
      "dom_node_id": "eq_123",
      "section_id": "sec_3_2"
    },
    {
      "id": "symbol_alpha_t",
      "type": "symbol",
      "label": "α_t",
      "latex": "$\\alpha_t$",
      "context": "Noise scaling parameter",
      "scope": "paper_level",
      "dom_node_id": "p_456",
      "section_id": "sec_3_2"
    },
    {
      "id": "definition_diffusion_process",
      "type": "definition",
      "label": "Diffusion Process",
      "definition": "A stochastic process...",
      "dom_node_id": "def_789"
    },
    {
      "id": "theorem_3_2",
      "type": "theorem",
      "label": "Theorem 3.2",
      "statement": "The reverse process converges...",
      "dom_node_id": "thm_012"
    }
  ],
  "edges": [
    {
      "id": "formula_elbo_has_symbol_alpha_t",
      "source": "formula_elbo",
      "target": "symbol_alpha_t",
      "type": "has_symbol"
    }
  ],
  "metadata": {
    "paper_id": "...",
    "formula_count": 5,
    "symbol_count": 20,
    "definition_count": 12,
    "theorem_count": 10,
    "edge_count": 15
  }
}
```

---

## Frontend Entity Support

All four entity types are supported in the frontend:

| Component | Support |
|-----------|---------|
| `GraphNode.tsx` | Formula nodes with amber styling, math label rendering, secondary latex preview |
| `NodeInfoPanel.tsx` | Formula body display with LaTeX rendering |
| `KnowledgeGraphView.tsx` | Formula filter toggle, formula count in metadata |
| `KnowledgeGraphProgress.tsx` | Formula progress bar during extraction |
| `GlossaryList.tsx` | Formula grouping in glossary |
| `TooltipSuggestionsDialog.tsx` | Formula entity type option |

### Entity Colors

| Type | Color |
|------|-------|
| Formula | Amber (`bg-amber-50`, `border-amber-300`) |
| Symbol | Blue (`#3b82f6`) |
| Definition | Emerald (`#10b981`) |
| Theorem | Violet (`#8b5cf6`) |

---

## Progress Tracking (SSE)

### SSE Event Format

```json
{
  "stage": "extracting",
  "progress": {
    "symbols": {"current": 2, "total": 5},
    "definitions": {"current": 1, "total": 5},
    "theorems": {"current": 3, "total": 5},
    "formulas": {"current": 0, "total": 5}
  }
}
```

### Completion

```json
{
  "stage": "complete",
  "formula_count": 5,
  "symbol_count": 20,
  "definition_count": 12,
  "theorem_count": 10,
  "edge_count": 15
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KG_MAX_SECTIONS` | `0` | Limit sections processed (0 = all) |
| `KG_DEBUG` | unset | Show verbose content previews |
| `ANTHROPIC_API_KEY` | required | Claude API key |

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/app/agents/knowledge_graph.py` | Full pipeline: extraction agents, dedup, graph assembly, LangGraph workflow |
| `backend/app/api/main.py` | SSE endpoint, build endpoint |
| `backend/app/compiler/latexml_compiler.py` | Section extraction (Phase 0) |
| `frontend/components/reader/KnowledgeGraphView.tsx` | Graph visualization |
| `frontend/components/reader/KnowledgeGraphProgress.tsx` | Progress UI |
| `frontend/components/reader/GraphNode.tsx` | Custom node renderer (supports formula, symbol, definition, theorem) |
| `frontend/components/reader/NodeInfoPanel.tsx` | Node detail panel with formula body display |

---

## Extending the Pipeline

### Adding a New Entity Type

1. Create Pydantic model in `knowledge_graph.py`
2. Add extraction function with progress reporting
3. Update `GraphState` with new field (use `Annotated` if parallel)
4. Add node to workflow, connect edges to `deduplicate_entities`
5. Update `deduplicate_entities` to handle the new type
6. Update `build_graph` to convert entities to nodes
7. Update frontend `GraphNode.tsx` with styling for new type
8. Update `NodeInfoPanel.tsx` if special display is needed

### Modifying Prompts

Prompts are defined as module-level constants. Escape curly braces in examples: `$\\mathbb{{R}}$` not `$\\mathbb{R}$`