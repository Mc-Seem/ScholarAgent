# Scholar Agent Feature Roadmap

## Overview
This roadmap addresses stakeholder feedback focused on: (1) making the knowledge graph more digestible, (2) enabling multi-paper workflows, (3) adding interactive chat capabilities, and (4) quality-of-life improvements for academic reading.

---

## Phase 1: Knowledge Graph Refinement
>**Status**: Implemented (schema-v3 semantic document, progressive graph, and quiet reader details)
>
>**Goal**: Make KG actionable and less overwhelming for papers with 100+ entities

### 1.1 Visual Hierarchy & Layer Separation
>**Problem**: Dense graphs with 300+ relationships are hard to parse

**Solution**:
- Bounded semantic-object overview with a server hard cap of 30
- One-hop and current-source expansion with a client-visible cap of 50
- Sparse information-ranked relation backbone with omitted-link expansion
- Separate contribution, prominence, recurrence, confidence, familiarity, and connectivity signals

### 1.2 Expertise-Based Filtering
>**Problem**: Users see entities below their knowledge level

**Solution**:
- Novice/intermediate/expert projection ranking
- Hide familiar background while preserving core contributions
- Explicit “show familiar” override in the graph toolbar

### 1.3 Entity Type Refinement
>**Current Issue**: Standalone symbols clutter the graph

**Changes**:
- **Object kinds**: `topic`, `claim`, `procedure`, `artifact`, and `quantity`
- **Independent dimensions**: paper roles and domain specialization remain roles/facets
- **Representations**: equations and scoped notation feed Equation Lens and glossary without becoming overview nodes
- **Cards**: aliases, roles/facets, ranking context, source evidence, and omitted-link counts
- **Future**: User-defined entity types per research field

### 1.4 Backend: Importance Scoring & Filtering API
- Store decomposed signals instead of one opaque importance score
- Serve `/overview`, `/subgraph`, and `/search` projections without returning the canonical corpus
- Persist a validated schema-versioned JSON document until relational migration triggers are measured

### 1.5 Quiet Semantic Reading
- Deterministically annotate repeated text occurrences with one reusable explanation per object or notation scope
- Open details only on click, Enter, or Space; never show hover cards over the text
- Keep those details in a dedicated `Semantic Lens` side view revealed without focus, so the article keeps the centre of the screen; a side view may reveal itself, but nothing may cover the text or take the caret away
- Provide Equation Lens purpose, notation, units, constraints, related objects, and locations
- Show the reader's own note for a term or equation in that same lens, so both kinds of explanation live in one place
- Render every meaning, unit, constraint, label, and note through MathJax, wrapping bare fragments such as `y_l` before typesetting
- Name where a subject appears rather than echoing a quote that only repeats the subject itself
- Search objects and notation through a glossary without forcing results into graph layout
- Keep graph-build progress stage-based rather than summing equation and LLM work

---

## Phase 2: Multi-Paper Workflows
>**Timeline**: 3-4 weeks
>
>**Goal**: Enable comparative reading and cross-paper navigation

### 2.1 Multi-Tab Paper Management ⭐ High Priority
>**Problem**: 5-10 second load times when switching papers

**Solution**:
- Tab bar with paper titles, compilation status indicators
- Lazy loading: only compile on first open, cache compiled HTML
- Session persistence: restore open tabs on reload
- Backend: shared compilation cache across papers

### 2.2 Cross-Paper Entity Linking
>**Use Case**: Reading survey + cited papers, tracking concept evolution

**Solution**:
- Unified KG index across user's library (vector embeddings per entity)
- Entity alignment via semantic similarity (cosine distance on embeddings)
- "Same As" relationships between entities in different papers
- Requires pruned KG (core entities only) to avoid noise

### 2.3 Terminology Alignment
>**Problem**: Same concept, different names across papers

**Solution**:
- Diff-like view: "Paper A calls this X, Paper B calls it Y"
- User can manually merge entities or accept agent suggestions
- Show alignment confidence score (high/medium/low)

### 2.4 Side-by-Side Comparison View
>**Use Case**: Compare two papers on similar topics

**Solution**:
- Split-screen layout with synchronized scrolling (optional)
- Agent highlights semantically similar sections (same color borders)
- Show unique KG entities in margins (e.g., "Only in Paper A: Theorem 3.2")
- Citation cross-references (if Paper A cites Paper B, link sections)

---

## Phase 3: Interactive Chat with Agent Tools
>**Timeline**: 2 weeks
>
>**Goal**: Dynamic paper manipulation via conversational interface

### 3.1 RAG-Based Chat
**Features**:
- Query paper passages/equations by default
- Keep graph expansion experimental: the 2026-07-25 evaluation promoted no query class because recall gains did not meet latency/token gates
- Inline entity citations (hoverable footnotes)
- Context window: current section + relevant KG subgraph
- Example queries:
  - "Explain Theorem 3.2 in simpler terms"
  - "What's the difference between α and α_t?"
  - "Summarize Section 4 assuming I know measure theory"

### 3.2 Agent Tools for Paper Modification
**Available Tools**:
1. `add_entity_to_kg(text, type, relationships)` - User: "Add X to knowledge graph as a definition"
2. `create_tooltip(entity_id, content)` - User: "Create a tooltip for Theorem 2.1 explaining its intuition"
3. `reapply_tooltip_to_section(tooltip_id, section_id)` - User: "Add that tooltip to Section 5 too"
4. `summarize_section(section_id, level)` - User: "Summarize Section 3 at undergrad level" → injects collapsible summary box above section

**UI**:
- Chat panel slides in from right (collapses graph/TOC when open)
- Tool executions show progress ("Adding entity to graph...")
- Changes reflected immediately in paper view

---

## Phase 4: Quality of Life Enhancements
>**Timeline**: 1-2 weeks per feature (can be done in parallel)
>
>**Goal**: Incremental improvements to reading experience

### 4.1 Reference Peeking
**Feature**:
- Hover over citation → show abstract + metadata
- Fetch from arXiv API (or Semantic Scholar for non-arXiv papers)
- "Open in Scholar Agent" button $\to$ add to library
- Cache fetched abstracts in database

### 4.2 Logical Flow Map ⭐ High Priority
>**Problem**: Many papers have non-linear structure (TOC doesn't capture flow)

**Solution**:
- Agent extracts section dependencies:
  - "Section 5 requires Theorem 3.2"
  - "Appendix A provides proof for Lemma 4.1"
- Generate directed graph: `Introduction → Preliminaries → {Main Result A, Main Result B} → Conclusion`
- Show in TOC panel as alternative navigation mode (toggle between TOC / Flow Map)
- Click node → jump to section

### 4.3 Author Profiles
**Feature**:
- Fetch from Semantic Scholar API: h-index, total citations, affiliations, top papers
- Show in expandable section in paper header
- Link to author's other papers in user's library
- Cache profiles (update weekly)

---

## Phase 5: Research Management Features
>**Timeline**: 3-4 weeks
>
>**Goal**: Match Mendeley/Zotero feature parity (defer until core features are polished)

### 5.1 Library Management
- **Collections**: Tags + hierarchical folders
- **Search**: Full-text + KG entity search across library
- **Export**: BibTeX, JSON (with annotations)
- **Bulk operations**: Delete, move, tag multiple papers

### 5.2 Annotations & Notes
- **Highlights**: Multi-color text highlighting (store character spans)
- **Notes**: Markdown notes anchored to sections/paragraphs
- **Export**: Annotated PDF with highlights + notes in margins

### 5.3 Collaboration (Future)
- **Shared workspaces**: Team access to papers + annotations
- **Comment threads**: Discussion on specific sections
- **Reading paths**: Suggested paper order for onboarding new researchers

---

## Implementation Priorities

### Start Immediately
1. **Phase 2.1** (Multi-tab) → critical UX blocker
2. **Phase 4.2** (Logical flow map) → low complexity, high impact
3. **Hybrid reranking experiment** → reduce graph-added context before reconsidering any query-class promotion

### Medium Term (After Phase 1 Complete)
4. **Phase 3.1** (RAG chat) → passage/equation retrieval first; graph expansion remains gated
5. **Phase 4.1** (Reference peeking) → straightforward API integration
6. **Relational KG review** → only after triggers in `docs/kg-relational-migration.md`

### Long Term (3+ months out)
7. **Phase 2.2-2.4** (Cross-paper features) → needs user validation with multi-paper usage
8. **Phase 5** (Research management) → defer until core reading experience is mature

---

## Technical Prerequisites

### From Existing Backlog (KNOWLEDGE_GRAPH_TODOS.md)
These items block roadmap features and should be completed first:

1. ~~Formula entity type~~ — complete as significant formula entities/facets
2. ~~Source text quotes~~ — complete in canonical observations and relation evidence
3. **Sub-paragraph entity spans** — still needed for precise in-paper highlighting
4. ~~Importance scoring~~ — complete as decomposed projection signals

### New Technical Requirements

#### Phase 2 (Multi-Paper)
- Vector embeddings for entities (use Voyage AI or Anthropic embeddings)
- Cross-paper entity index (new table: `entity_alignments`)
- Compiled HTML caching layer (Redis or in-memory LRU cache)

#### Phase 3 (Chat)
- Passage/equation retrieval baseline; do not enable graph expansion until a query class passes recorded gates
- Agent tool framework (LangGraph with human-in-loop for destructive actions)
- Streaming response UI (SSE or WebSocket)

#### Phase 4 (QoL)
- External API integrations (arXiv, Semantic Scholar)
- Rate limiting + caching for API calls
- Section dependency extraction (extend KG agents)

---

## Success Metrics

### Phase 1 Success Criteria
- Average visible nodes in graph < 30 (filtered from 100+)
- User can identify "core concepts" within 10 seconds of opening graph
- 80% of users enable expertise-based filtering

### Phase 2 Success Criteria
- Users open 3+ papers per session (vs. current 1-2)
- Cross-paper entity alignment accuracy > 85% (validated by user confirmations)
- Tab switching < 500ms (cached HTML)

### Phase 3 Success Criteria
- 50% of sessions include chat interaction
- Agent tools used in 20% of chat sessions
- Tooltip creation via chat is faster than manual UI (< 30 seconds end-to-end)

### Phase 4 Success Criteria
- 70% of users interact with logical flow map (vs. TOC)
- Reference peeking used in 80% of papers with 10+ citations
- Author profile views > 5 per week (per user)

---

## Open Questions

1. **Entity Types**: Should we allow fully custom entity types, or provide a fixed set (Formula, Algorithm, Proof, Assumption)?
2. **Cross-Paper Linking**: Manual alignment vs. automatic with confirmation step?
3. **Chat Memory**: Should chat context persist across sessions, or reset per paper?
4. **Collaboration**: Self-hosted only, or cloud sync for teams?

---

**Last Updated**: 2026-07-25
**Status**: Canonical KG refinement complete; passage-first retrieval decision recorded
