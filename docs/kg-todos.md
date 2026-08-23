# Knowledge Graph Backlog

> **Status**: The schema-v3 semantic-reading iteration is implemented. Older three-stage deduplication helpers remain inactive migration/reference code.

## Canonical Rework Completed ✅

- [x] Versioned schema-v3 document with objects, relations/qualifiers, equations, notation, explanations, occurrences, evidence, and diagnostics
- [x] Universal `topic`/`claim`/`procedure`/`artifact`/`quantity` extraction with roles and domain facets
- [x] Deterministic compiler equation anchoring plus one bounded purpose/notation analysis
- [x] Stable semantic/math IDs, alias and observation retention, strict endpoint/evidence validation before persistence
- [x] Shared explanations, deterministic label/alias anchoring plus unambiguous singular/plural forms, idempotent no-LLM injection, and scoped notation separation
- [x] Sparse overview backbone with omitted counts, complete focused expansion, search, and legacy rebuild detection
- [x] Bounded semantic annotation, subject, Equation Lens, and glossary APIs
- [x] Quiet web/Theia activation by click or keyboard, shared sidebar details, evidence jumps, and no hover cards
- [x] Dedicated Theia `Semantic Lens` side view revealed without focus, keeping the bottom Property View as a fallback
- [x] One text per subject in the lens: the reader's inline edit replaces the agent's description, name, or symbol meaning, with `Show original` and `Restore`
- [x] Reader wording stored as a subject-keyed note (`semantic-notes` upsert/delete) so restoring a wording keeps the injected anchors
- [x] Applied AI tooltip text distinguished from a reader override, so rebuilding a graph cannot turn stale generated wording into a false `edited` state
- [x] MathJax rendering for meanings, units, constraints, labels, and notes, with bare fragments such as `y_l` wrapped before typesetting
- [x] Evidence presented as named locations instead of a quote that only repeats the equation
- [x] Free-form `paper_role` label retired from equation analysis, schema, and lens header; stored graphs drop the key on load
- [x] Subject kind no longer printed in the lens: it repeated `artifact` above the title and once per location (an observation always carries the kind of its subject, and ~2/3 of anchored terms are artifacts); the kind stays in the graph for ranking and filtering
- [x] Lens chrome legible without relying on hue: role/unit/constraint chips outlined instead of filled with a near-background tint, edit controls hidden until the pointer or keyboard reaches the text they belong to
- [x] Hidden single Edit/Add controls removed from layout flow, and notation symbols keep horizontal scrolling without one-pixel vertical scrollbars
- [x] Formula-title badge styling excludes hidden edit containers, and `Appears in` evidence follows compiled section/DOM order instead of parallel extraction order
- [x] One shell for term and equation: both branches of `SemanticDetails` use the shared `semantic-lens-*` classes and theme tokens instead of Tailwind utilities, which removes the browser `h3` margin above a term (the Theia bundle ships no Tailwind preflight) and the divergent sizes, spacing, and slate colours between the two halves
- [x] Strict term/formula identity: at most one equation may directly define an object (never a broad list of related equations); term and equation selections render the same definition, formula, expanded notation, and locations in Semantic Lens
- [x] Applying term highlights restores visible term anchors: anchors resolved from the graph by subject id (the drafts table stores no positions), terms split by inline markup wrapped piecewise, stale anchors skipped instead of aborting, and `spans_injected` counting real anchors
- [x] Character references preserved during `data-id` injection so equations containing `<` keep their full LaTeX
- [x] Anchorable text defined once for the builder and the injector: paragraphs holding an inline formula are annotated again (an acronym such as `KTO` was previously anchored nowhere), math is never annotated, and anchors left inside a formula by earlier builds are removed on the next apply
- [x] `knowledge-graph/reanchor` recomputes occurrences from stored observations without an LLM, exposed as `Re-anchor Terms in Paper`
- [x] Tooltip suggestions from explanation subjects and complete occurrences, independent of graph rank
- [x] Suggestion response contract realigned with schema-v3 anchors on the client boundary, and `entity_types` validated against object kinds instead of the removed `nodes` key
- [x] Occurrence coverage audit reports exact, conservative word-form/orthographic, subject, and ambiguity metrics; on the available schema-v3 paper exact forms cover 284/289 candidates (98.27%) and safe singular/plural anchoring recovers all five misses
- [x] Legacy AI injection retained only as a dormant fallback/reference until cross-domain coverage exists; it is not called by the reader API
- [x] Tooltip flow cleanup: user-facing panel renamed to `Term Highlights`, write-only `tooltip_suggestions_cache` removed by migration `007`, and expertise prompt examples use schema-v3 IDs
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
- [x] **Sub-paragraph entity spans** — Exact offsets and text are injected with occurrence and subject IDs; changed source text fails validation

---

## Medium Priority

### Frontend UX
- [x] **Relationship evidence display** — Edge and Theia lens/property panels expose persisted source observations
- [x] **Reusable semantic explanations** — One explanation per object/notation scope feeds suggestions and sidebar details
- [x] **Independent semantic projections** — Graph, Equation Lens, glossary, annotations, and Theia details share one document

### User Interaction
- [ ] **User-added definitions** — Allow users to manually add entities to the knowledge graph
  - "Add to Knowledge Graph" context menu on selected text
  - Triggers incremental extraction for that selection

### Extraction Improvements
- [x] **Notation scoping** — Formula notation is a separate scoped record and never becomes an overview node automatically
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