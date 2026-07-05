# Scholar Agent Feature Roadmap

## Overview
This roadmap addresses stakeholder feedback focused on: (1) making the knowledge graph more digestible, (2) enabling multi-paper workflows, (3) adding interactive chat capabilities, and (4) quality-of-life improvements for academic reading.

---

## Phase 1: Knowledge Graph Refinement
>**Timeline**: 2-3 weeks
>
>**Goal**: Make KG actionable and less overwhelming for papers with 100+ entities

### 1.1 Visual Hierarchy & Layer Separation
>**Problem**: Dense graphs with 300+ relationships are hard to parse

**Solution**:
- Visual tiers with color gradients (core concepts → supporting definitions → mentioned-once terms)
- Clear layer boundaries (horizontal lines or background shading)
- Importance-based node sizing (larger = more central to paper)

### 1.2 Expertise-Based Filtering
>**Problem**: Users see entities below their knowledge level

**Solution**:
- Extend existing `user_expertise` filtering (currently only in tooltips) to graph view
- Filter entities by user-defined expertise level in "Personalize" tab
- Hide entities the user already knows, surface unfamiliar concepts

### 1.3 Entity Type Refinement
>**Current Issue**: Standalone symbols clutter the graph

**Changes**:
- **Remove**: Standalone symbol nodes (integrate into parent formulas/theorems)
- **Add**: `Formula` entity type for named equations (e.g., "ELBO", "KTO loss")
- **Add**: `Algorithm` entity type (e.g., "Algorithm 1: Gradient Descent")
- **Future**: User-defined entity types per research field

### 1.4 Backend: Importance Scoring & Filtering API
- Compute `importance_score` per entity (frequency $\times$ relationship count $\times$ definition presence)
- API: `GET /api/papers/{id}/knowledge-graph?min_importance=0.5&entity_types=definition,theorem,formula`
- Store importance in JSONB graph structure

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
- Query paper content + knowledge graph
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
1. **Phase 1.1-1.3** (KG visual hierarchy + entity refinement) → addresses core "too many entities" problem
2. **Phase 4.2** (Logical flow map) → low complexity, high impact
3. **Phase 2.1** (Multi-tab) → critical UX blocker

### Medium Term (After Phase 1 Complete)
4. **Phase 3.1** (RAG chat) → builds on refined KG
5. **Phase 4.1** (Reference peeking) → straightforward API integration
6. **Phase 1.4** (Filtering API) → requires importance scoring architecture

### Long Term (3+ months out)
7. **Phase 2.2-2.4** (Cross-paper features) → needs user validation with multi-paper usage
8. **Phase 5** (Research management) → defer until core reading experience is mature

---

## Technical Prerequisites

### From Existing Backlog (KNOWLEDGE_GRAPH_TODOS.md)
These items block roadmap features and should be completed first:

1. **Formula entity type** (blocks Phase 1.3)
2. **Source text quotes** (blocks Phase 3.2 - needed for `add_entity_to_kg`)
3. **Sub-paragraph entity spans** (blocks Phase 1.2 filtering - need fine-grained occurrence tracking)
4. **Importance scoring** (blocks Phase 1.4)

### New Technical Requirements

#### Phase 2 (Multi-Paper)
- Vector embeddings for entities (use Voyage AI or Anthropic embeddings)
- Cross-paper entity index (new table: `entity_alignments`)
- Compiled HTML caching layer (Redis or in-memory LRU cache)

#### Phase 3 (Chat)
- RAG retrieval pipeline (reuse KG + sections as corpus)
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

**Last Updated**: 2026-03-08
**Status**: Planning phase, pending stakeholder approval
