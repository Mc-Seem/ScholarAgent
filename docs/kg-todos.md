# Knowledge Graph Backlog

> **Status**: The canonical evidence rework is implemented. Older three-stage deduplication helpers remain inactive migration/reference code.

## Canonical Rework Completed ✅

- [x] Versioned `KnowledgeGraphDocument` with observations, source evidence, canonical entities, facets, signals, relations, and diagnostics
- [x] One coordinated concept/claim/method section extraction plus deterministic compiler equation anchoring
- [x] Stable semantic/math IDs, alias and observation retention, strict endpoint/evidence validation before persistence
- [x] Formula-local symbols as facets with explicit/recurrent/independently-discussed promotion rules
- [x] Ranked overview, one-hop/source-focused subgraph, canonical search, and legacy rebuild detection APIs
- [x] Progressive web and Theia views with server search, stable-ID merge, evidence inspection, expertise controls, and visible-node budgets
- [x] Tooltip suggestions through the bounded canonical projection
- [x] Passage-only versus hybrid retrieval evaluation; no query class currently passes promotion gates

## Legacy Milestones (Inactive Reference)

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

## Remaining High Priority

### Canonicalization Refinement
- [ ] **Ambiguous-cluster adjudication** — Add optional LLM adjudication only for small canonical candidate blocks that deterministic aliases/signatures cannot resolve.
- [ ] **Over-merge evaluation** — Expand annotated fixtures before introducing semantic near-duplicate merging.
- [ ] **Incremental rebuild research** — Define observation/entity replacement semantics before relational normalization.

### Extraction Quality
- [x] **Source text quotes** — Exact evidence quotes, source DOM/equation IDs, and available offsets live in immutable observations
- [ ] **Sub-paragraph entity spans** — Inject `<span>` tags around entity mentions within paragraphs
  - Currently the finest granularity is paragraph-level (`data-id` on `<p>`)
  - Goal: wrap individual mentions (e.g., "Theorem 3.2", "α_t") in hoverable spans linked to KG nodes
  - Complex due to fuzzy matching, LaTeX variations, HTML preservation

---

## Medium Priority

### Frontend UX
- [x] **Relationship evidence display** — Edge and Theia property panels expose persisted source observations
- [ ] **Auto-generate tooltip drafts** — For important terms, pre-populate tooltip content from KG data
- [x] **Presentation-layer concept aggregation** — Concept cards render aliases, formulas, scoped symbols, signals, and evidence as facets

### User Interaction
- [ ] **User-added definitions** — Allow users to manually add entities to the knowledge graph
  - "Add to Knowledge Graph" context menu on selected text
  - Triggers incremental extraction for that selection

### Extraction Improvements
- [x] **Symbol scoping** — Formula-local notation remains scoped facet data unless promotion criteria pass
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
- [x] Canonical relations reject either missing endpoint and missing evidence during document validation
- [ ] Migrate from JSONB only when triggers in `docs/kg-relational-migration.md` are measured
- [ ] Add caching for LLM calls to avoid re-extraction on rebuild
- [ ] Improve hybrid evidence reranking, then rerun the gates in `docs/kg-retrieval-evaluation.md`