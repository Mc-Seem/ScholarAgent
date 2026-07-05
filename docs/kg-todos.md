# Knowledge Graph Polish Tasks

## Completed (MVP) ✅

### Core Features
- [x] **Multi-agent extraction pipeline** - Parallel extraction of symbols, definitions, theorems, relationships
- [x] **Graph storage** - JSONB storage on Paper model
- [x] **ReactFlow visualization** - Interactive graph with custom node components
- [x] **Hierarchical layout** - Dagre-based dependency positioning
- [x] **LaTeX rendering** - MathJax in node labels and descriptions
- [x] **Navigation** - Click node to jump to paper section
- [x] **TOC/Graph toggle** - Seamless switching with state preservation
- [x] **Real-time progress** - SSE streaming during graph build

### UX Features (added this session)
- [x] **Search within graph** - Find nodes by name/content with autocomplete
- [x] **Graph filtering** - Toggle visibility of node types (symbol/definition/theorem) and edge types
- [x] **Subgraph views (Focus mode)** - Show only ancestors/descendants of selected node
- [x] **Node connections display** - Collapsible incoming/outgoing connections in info panel
- [x] **Focus indicator** - Visual highlight on focused node, clickable label to navigate

---

## High Priority (Post-MVP)

### Extraction Quality
- [x] **Better context for dependency extraction** - Include symbol/theorem/definition summaries (not just names) when extracting relationships ✅
- [ ] **Source text quotes** - Store direct quotes from LaTeX source to locate entities in original text
  - [ ] Add `source_quote` field to Symbol/Definition/Theorem models
- [ ] **Sub-paragraph entity spans** - Inject `<span>` tags around entity mentions within paragraphs
  - Currently the finest granularity is paragraph-level (`data-id` on `<p>`)
  - Goal: wrap individual mentions (e.g., "Theorem 3.2", "α_t") in hoverable spans linked to KG nodes
  - Complex due to fuzzy matching, LaTeX variations, HTML preservation
- [ ] **Formula/equation entity type** - Add support for named formulas (e.g., "KTO loss", "ELBO") as a distinct node type

### Frontend UX
- [ ] **Relationship evidence display** - Show `evidence_text` from relationship metadata
  - Options: hover tooltip on edges, edge click panel, or info panel when edge selected
- [ ] **Auto-generate tooltip drafts** - For important terms, pre-populate tooltip content from KG data

## Medium Priority

### User Interaction
- [ ] **User-added definitions** - Allow users to manually add entities to the knowledge graph
  - "Add to Knowledge Graph" context menu on selected text
  - Triggers incremental extraction for that selection

### Extraction Improvements
- [ ] **Symbol scoping** - Track symbol scope to handle reused notation
  - Same symbol may mean different things in different sections
  - May be complex - could defer further
- [ ] **Deduplication improvements** - Current dedup is by lowercase name only
  - Consider semantic similarity for near-duplicates
  - Handle LaTeX variations (e.g., `\alpha` vs `α`)

## Low Priority / Future

### Layout & Visualization
- [ ] **Edge bundling** - Reduce visual clutter for dense graphs

### Integration
- [ ] **Cross-paper linking** - Connect entities across different papers
- [ ] **Citation integration** - Link KG nodes to cited papers via Semantic Scholar

---

## Technical Debt
- [ ] Edge validation in `build_graph` only skips when *both* nodes missing - should skip if *either* is missing
- [ ] Consider migrating from JSONB to dedicated `kg_nodes`/`kg_edges` tables for better querying
- [ ] Add caching for LLM calls to avoid re-extraction on rebuild