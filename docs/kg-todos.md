# Knowledge Graph Backlog

> **Status**: Branch `kg-enhancements`. Formula entity type and 3-stage dedup pipeline are implemented. Items below reflect the current state of the code.

## Completed ✅

### Core Pipeline
- [x] **Multi-agent extraction pipeline** — Parallel extraction of symbols, definitions, theorems, formulas
- [x] **Formula extraction** — `Formula` entity type with label, latex, summary, and formula-scoped symbol observations
- [x] **Stray symbol extraction** — Separate from formula-scoped symbols, merged during dedup
- [x] **Graph storage** — JSONB storage on Paper model
- [x] **ReactFlow visualization** — Interactive graph with custom node components
- [x] **Hierarchical layout** — Dagre-based dependency positioning
- [x] **LaTeX rendering** — MathJax in node labels and descriptions
- [x] **Navigation** — Click node to jump to paper section
- [x] **TOC/Graph toggle** — Seamless switching with state preservation
- [x] **Real-time progress** — SSE streaming during graph build (includes formula progress bar)

### Deduplication (3-stage)
- [x] **Stage 1: Local subsection reconciliation** — `reconcile_local_subsection_observations()` catches cross-type overlaps within the same subsection (definition ↔ formula, stray ↔ formula-scoped symbol)
- [x] **Stage 2: Within-type global merging** — Formulas by label/latex/summary, symbols by latex+context, definitions by term, theorems by type+number
- [x] **Stage 3: Cross-type reconciliation** — Deterministic cross-type dedup with precedence rules (definition > formula, stray symbol > formula-scoped symbol), attach/absorb/keep_separate operations
- [x] **Formula attachment to definitions** — Formulas can be attached as mathematical representations of canonical definitions, with provenance

### Frontend Formula Support
- [x] **GraphNode** — Amber styling for formula nodes, math label rendering, secondary latex preview
- [x] **NodeInfoPanel** — Formula body display with LaTeX rendering
- [x] **KnowledgeGraphView** — Formula filter toggle, formula count in metadata
- [x] **KnowledgeGraphProgress** — Formula progress bar during extraction
- [x] **GlossaryList** — Formula grouping
- [x] **TooltipSuggestionsDialog** — Formula entity type option

### UX Features
- [x] **Search within graph** — Find nodes by name/content with autocomplete
- [x] **Graph filtering** — Toggle visibility of node types (formula/symbol/definition/theorem) and edge types
- [x] **Subgraph views (Focus mode)** — Show only ancestors/descendants of selected node
- [x] **Node connections display** — Collapsible incoming/outgoing connections in info panel
- [x] **Focus indicator** — Visual highlight on focused node, clickable label to navigate
- [x] **Better context for dependency extraction** — Include entity summaries (not just names) when extracting relationships

---

## In Progress / High Priority

### Deduplication Refinement
- [ ] **LLM adjudication for ambiguous dedup buckets** — Stage 3 is currently deterministic only. The design plan calls for sending small ambiguous candidate clusters to the LLM for resolution (`attach` vs `absorb` vs `keep_separate` decisions)
- [ ] **Shared deduplication profiles** — The plan describes a shared intermediate profile (`surface_name`, `aliases`, `semantic_summary`, `math_signatures`, `text_signature`, `scope_signature`, `evidence_spans`) for cross-type matching. Not yet fully implemented as a standalone structure.
- [ ] **Dedup provenance in graph output** — `canonical_entity_id`, `absorbed_entity_ids`, `dedup_notes` / `resolution_reason` fields in the final graph. Currently partial (formula attachment provenance exists, but general provenance tracking is incomplete).

### Extraction Quality
- [ ] **Source text quotes** — Store direct quotes from LaTeX source to locate entities in original text
  - Add `source_quote` field to entity models
- [ ] **Sub-paragraph entity spans** — Inject `<span>` tags around entity mentions within paragraphs
  - Currently the finest granularity is paragraph-level (`data-id` on `<p>`)
  - Goal: wrap individual mentions (e.g., "Theorem 3.2", "α_t") in hoverable spans linked to KG nodes
  - Complex due to fuzzy matching, LaTeX variations, HTML preservation

---

## Medium Priority

### Frontend UX
- [ ] **Relationship evidence display** — Show `evidence_text` from relationship metadata
  - Options: hover tooltip on edges, edge click panel, or info panel when edge selected
- [ ] **Auto-generate tooltip drafts** — For important terms, pre-populate tooltip content from KG data
- [ ] **Presentation-layer concept aggregation** — The dedup plan describes a UI concept node that aggregates definitions + attached formulas + attached symbols as collapsible facets, instead of showing them as equal peers

### User Interaction
- [ ] **User-added definitions** — Allow users to manually add entities to the knowledge graph
  - "Add to Knowledge Graph" context menu on selected text
  - Triggers incremental extraction for that selection

### Extraction Improvements
- [ ] **Symbol scoping** — Track symbol scope to handle reused notation
  - Same symbol may mean different things in different sections
- [ ] **Deduplication improvements** — Current within-type dedup uses normalized keys
  - Consider semantic similarity for near-duplicates
  - Handle LaTeX variations (e.g., `\alpha` vs `α`)

---

## Low Priority / Future

### Layout & Visualization
- [ ] **Edge bundling** — Reduce visual clutter for dense graphs

### Integration
- [ ] **Cross-paper linking** — Connect entities across different papers
- [ ] **Citation integration** — Link KG nodes to cited papers via Semantic Scholar

---

## Technical Debt
- [ ] Edge validation in `build_graph` only skips when *both* nodes missing — should skip if *either* is missing
- [ ] Consider migrating from JSONB to dedicated `kg_nodes`/`kg_edges` tables for better querying
- [ ] Add caching for LLM calls to avoid re-extraction on rebuild
- [ ] `has_symbol` edge generation — verify formula-scoped symbols are properly linked to their parent formulas in the final graph