# Formula Entity Plan for Knowledge Graph

> **Superseded (2026-07-25):** Formula anchoring is now deterministic from compiler `equations_data`. Significant formulas are canonical entities/facets; formula-local symbols remain scoped facet attributes and become entities only when explicitly defined, recurrent across significant formulas, or independently discussed. The active contract is documented in `docs/kg-pipeline.md`.

This note captures the agreed direction for issue `#4`: introducing formulas as a first-class entity in the paper knowledge graph.

## Decision Summary

- A `formula` node represents a formula explicitly present in the paper.
- The extraction pipeline must not invent or reconstruct formulas for concepts that are only described in prose.
- `formula` becomes a first-class graph entity alongside `definition` and `theorem`.
- `symbol` remains a graph entity, but it is secondary to formulas and should usually be attached to a parent formula rather than surfaced as a peer-level entry point.
- Extraction should produce scoped symbol observations before deduplication.
- Deduplication should use type-specific blocking and only send small ambiguous candidate clusters to the LLM.
- Backward compatibility with the current prototype API is not a constraint for this work.

## Intended End State

The final graph should be easy to navigate for both users and LLM agents:

- `definition`: concept-level prose objects
- `theorem`: theorem / lemma / corollary / proposition objects
- `formula`: named or otherwise important formulas explicitly written in the paper
- `symbol`: mathematical notation objects derived from local observations

The main graph should favor traversal through `definition`, `theorem`, and `formula` nodes. Symbol nodes remain available for drill-down and tooltip grounding, but should not dominate the visible graph.

## Formula Scope

A formula should be extracted only if it is explicitly present in the paper source or compiled HTML output. This includes displayed equations and important inline formulas when they are discussed as distinct objects.

The extractor must not:

- invent formulas for prose-only concepts
- expand textbook concepts into equations unless the paper itself shows them
- create separate formula nodes for every algebraic manipulation step
- treat every equation as graph-worthy if it has no conceptual role in the paper

## Extraction-Stage Entity Model

Extraction should operate over subsections and return four categories:

- `definitions`
- `theorems`
- `formulas`
- `stray_symbols`

`stray_symbols` is an extraction-stage category only. In the final graph it should be merged into regular `symbol` nodes.

### Formula Extraction Output

Each extracted formula should include both formula-level data and scoped symbol observations.

Suggested fields:

- `label`: explicit formula name if present, else `null`
- `latex`: exact formula as written in the paper
- `summary`: short explanation of the formula's role in the paper
- `dom_node_id`
- `section_id`
- `symbols`: list of formula-scoped symbol observations

Suggested formula-scoped symbol observation fields:

- `symbol`: exact symbol notation
- `latex`: LaTeX form for rendering
- `local_meaning`: concise meaning in the context of this formula
- `role_in_formula`: optional short description if useful

### Stray Symbol Extraction Output

Stray symbols are symbols introduced or discussed outside a formula context, for example:

- inline notation introduced in prose
- notation explained in tables
- symbols referenced in text without a formula parent

Suggested fields:

- `symbol`
- `latex`
- `local_meaning`
- `dom_node_id`
- `section_id`

## Final Graph Model

### Formula Node

Minimum fields:

- `id`
- `type: "formula"`
- `label`
- `latex`
- `summary`
- `dom_node_id`
- `section_id`
- `aliases` (optional)
- `symbol_ids` (optional derived field)

Notes:

- `label` may fall back to a generated human-readable title when no explicit name is given, but the original explicit name should be preserved when present.
- The first implementation does not need a narrow `formula_kind` enum. If additional role metadata is needed later, prefer a broad and domain-agnostic field.

### Symbol Node

Minimum fields:

- `id`
- `type: "symbol"`
- `label`
- `latex`
- `summary` or `context`
- `scope`
- `dom_node_id`
- `section_id`
- `refers_to_entity_id` (optional)

The important distinction is:

- formula nodes represent mathematical objects
- symbol nodes represent notation and local meaning within mathematical objects or prose context

## Edge Taxonomy

Initial edge types:

- `has_symbol`: formula -> symbol
- `defines`: definition -> symbol or definition -> formula
- `uses`: theorem -> formula, theorem -> symbol, formula -> definition, formula -> symbol
- `depends_on`: retained where it adds useful structure
- `mentions`: retained as the weakest relationship class

`has_symbol` should be the default structural edge for formula-contained notation.

## Extraction Flow

### 1. Subsection Extraction

For each subsection, extract:

- definitions
- theorems
- formulas
- stray symbols

When a formula is extracted, the same extraction step should also emit the meaningful symbols contained in that formula. This gives us immediate local `has_symbol` structure before any cross-section merging.

### 2. Deduplication

Deduplicate entities after extraction, including formula-scoped and stray symbol observations.

This stage should resolve:

- duplicate definitions
- duplicate theorems
- duplicate formulas
- symbol observations that refer to the same paper-level symbol entity

### 3. Relationship Extraction

After deduplication, run the existing dependency / relationship extraction against the merged entity set.

### 4. Graph Assembly

Build the final graph using the merged entities and resolved relationships.

## Deduplication Strategy

We do not want global `O(n^2)` LLM comparisons. Deduplication should use:

1. normalization
2. type-specific blocking
3. deterministic merges where confidence is high
4. cluster-level LLM adjudication only for ambiguous buckets

### General Rule

The LLM should resolve duplicate clusters, not individual pairs. Each adjudication step should receive a small bucket of candidate entities and return cluster membership or canonical selections.

### Definition Blocking

Primary signals:

- normalized term
- alias / abbreviation normalization
- summary similarity

### Theorem Blocking

Primary signals:

- theorem number
- theorem type
- normalized label
- statement similarity for unnumbered cases

### Formula Blocking

Primary signals:

- explicit label equality, if present
- normalized LaTeX fingerprint
- nearby section context
- summary similarity

Formula deduplication must not rely on LaTeX edit distance alone. Similar formulas can play different roles, and the same formula can appear with minor notation changes across the paper.

### Symbol Blocking

Primary signals:

- normalized symbol LaTeX
- local meaning similarity
- scope compatibility
- shared parent formula or nearby section context

Symbols must never be merged solely because the glyphs match.

## Prompt Requirements

The extraction prompts should explicitly enforce canonical, concise outputs because deduplication depends on them.

For formula extraction:

- extract only formulas explicitly present in the paper
- include exact formula text
- include a concise summary of the role of the formula
- include only meaningful symbols from the formula
- exclude punctuation-like notation, dummy indices, and purely syntactic markers

For symbol observations:

- provide short noun-phrase or compact descriptive meanings
- avoid long free-form explanations
- describe meaning in local context, not global mathematical folklore

## Implementation Notes

The current prototype hardcodes node types across backend and frontend. That should be generalized as part of this work rather than treated as a constraint.

Areas expected to change:

- `backend/app/agents/knowledge_graph.py`
- `backend/app/api/main.py`
- `backend/app/agents/tooltip_suggestion.py`
- `frontend/components/reader/KnowledgeGraphView.tsx`
- `frontend/components/reader/NodeInfoPanel.tsx`
- `frontend/components/reader/GraphNode.tsx`
- tooltip entity-type selection and grouping logic

## Phased Implementation

Recommended order:

1. Extend extraction schemas to add `formula` and scoped symbol observations.
2. Refactor deduplication to work on type-specific buckets.
3. Update graph assembly to emit `formula` nodes and `has_symbol` edges.
4. Generalize API and frontend handling of entity types.
5. Re-tune graph visibility so formulas become the default math-level entry point.

## Open Questions

- Do we want unnamed but clearly important displayed equations to become formula nodes in v1, or only explicitly named formulas?
- Should symbol nodes preserve a list of parent formulas in the final graph, or should parentage be reconstructed from `has_symbol` edges only?
- Do we want a dedicated visibility mode in the UI that hides standalone symbols by default?
