# Knowledge Graph Deduplication Plan

This note captures the intended direction for deduplication in the paper knowledge graph after formulas were introduced as a first-class entity type.

The current implementation already extracts `definitions`, `theorems`, `formulas`, and symbol observations, but deduplication is still shallow and mostly type-local. The remaining work is to make deduplication robust enough to reconcile repeated mentions within a type and overlaps across types without collapsing distinct concepts.

## Current State

The pipeline currently does the following:

- merges formulas with a simple normalized `label -> latex -> summary` key
- merges symbols with a simple normalized `latex + context` key
- merges definitions by normalized `term`
- merges theorems by normalized `type + number`

This is enough for obvious duplicates, but it does not address the more important cases:

- the same concept appearing as both a `definition` and a `formula`
- the same symbol appearing as a stray paper-level notation item and as a formula-scoped symbol
- multiple observations with partially overlapping evidence but different wording
- entities with different schemas that still refer to the same paper-level object

## Problem Statement

Deduplication is not only a within-type cleanup task. It is a graph canonicalization task.

If we only deduplicate within types, we still end up with obvious duplication in the final graph, for example:

- a `definition` node for KTO loss
- a `formula` node for KTO loss
- both nodes summarizing the same thing
- both nodes appearing as separate primary graph entries

This is undesirable because the graph becomes repetitive and relationship extraction has to reason over redundant nodes.

## Core Decision

Deduplication should happen in three stages:

1. Reconcile raw observations locally within each subsection across entity types.
2. Merge entities globally within their own type.
3. Reconcile merged entities globally across types using explicit precedence rules.

Cross-type reconciliation must not operate directly on the raw extraction schemas. Instead, the global cross-type pass should operate on merged entities that have been converted into a shared deduplication profile.

The reason for the extra local stage is that many duplicates originate from the same text span in the same subsection. We should exploit that local context before attempting global canonicalization.

## Design Principles

- Preserve the semantic distinction between entity types.
- Avoid global `O(n^2)` comparison across all entities.
- Never merge solely because names or glyphs match.
- Exploit strong local evidence before doing global reconciliation.
- Prefer deterministic blocking and scoring first.
- Use LLM adjudication only for small ambiguous candidate buckets.
- Keep provenance so that absorbed observations are still inspectable.

## Non-Goals

- Do not force all similar entities into one universal node type.
- Do not add formula-only fields such as dedicated `latex` directly to `definition`.
- Do not discard source observations after merging.
- Do not rely on a single similarity score with no interpretable signals.

## Shared Deduplication Profile

After within-type merging, every entity should be converted into a shared intermediate profile used only for deduplication and reconciliation.

Suggested fields:

- `entity_id`
- `entity_type`
- `priority`
- `surface_name`
- `aliases`
- `semantic_summary`
- `math_signatures`
- `text_signature`
- `scope_signature`
- `evidence_spans`

### Field Semantics

`surface_name`

- normalized primary human-readable name
- for definitions: derived from `term`
- for formulas: derived from `label` if present, else empty
- for symbols: derived from symbol string if the symbol is paper-level enough to stand alone

`aliases`

- normalized alternative names, abbreviations, or labels

`semantic_summary`

- concise canonical summary used for similarity and LLM adjudication

`math_signatures`

- zero or more normalized math expressions associated with the entity
- for formulas: derived from formula `latex`
- for definitions: extracted from inline/display math inside `definition_text`
- for theorems: extracted from statement math when useful
- for symbols: typically the symbol latex itself, but treated differently from full formulas

`text_signature`

- normalized concept text used for coarse semantic comparison

`scope_signature`

- section / DOM / neighborhood hints used to avoid accidental long-range merges

`evidence_spans`

- source locations and snippets that justify the merged entity

The important point is that definitions do not need a dedicated `latex` field in their storage schema. They only need derived `math_signatures` during dedup preparation.

## Stage 1: Local Subsection Reconciliation

Before global deduplication, reconcile raw observations extracted from the same subsection.

This stage exists to catch the easy and common case where the same local passage produces:

- a `definition` and a `formula`
- a stray symbol and a formula-scoped symbol
- two differently worded observations that clearly point to the same local object

This is not yet full paper-level canonicalization. It is a local cleanup pass that uses the strongest evidence we have:

- shared `section_id`
- nearby or identical `dom_node_id`
- overlapping names or aliases
- overlapping math signatures
- obvious summary overlap

Expected outputs of this stage:

- local cross-type links or candidate groups
- optionally, early deterministic local absorptions when confidence is very high
- preserved provenance so later global dedup still sees the full evidence

Important constraint:

- local reconciliation should prefer creating links or candidate groups over destructive merges unless the case is nearly exact

Why:

- the same subsection can still mention related but distinct objects
- local agreement is strong evidence, but it is not sufficient to flatten everything immediately

## Stage 2: Within-Type Global Deduplication

Within-type deduplication remains the first pass because it reduces noise before cross-type reconciliation.

### Definitions

Primary signals:

- normalized `term`
- alias or abbreviation normalization
- summary similarity
- overlapping math signatures extracted from `definition_text`

Rules:

- same term and highly similar summaries: merge deterministically
- same term but incompatible summaries: keep separate and send to adjudication bucket
- presence of the same formula inside the definition text is a supporting signal, not sufficient alone

### Formulas

Primary signals:

- explicit label equality
- normalized formula fingerprint
- section proximity
- summary similarity

Rules:

- same explicit label and compatible latex: merge deterministically
- same latex but different role summaries: do not auto-merge
- unnamed formulas rely more heavily on math signature plus local context

### Symbols

Primary signals:

- normalized symbol latex
- context similarity
- shared parent formula
- scope compatibility

Rules:

- matching glyphs are not enough
- formula-scoped symbol observations should usually merge first inside their parent formula cluster
- stray symbol observations may later absorb formula-scoped observations if they clearly refer to the same paper-level symbol

### Theorems

Primary signals:

- theorem type
- theorem number
- normalized name
- statement similarity for unnumbered items

Rules:

- numbered theorem-like items merge deterministically by type plus number
- unnumbered items require statement-level similarity

## Stage 3: Cross-Type Global Reconciliation

After within-type merging, reconcile entities across types.

This stage should not blindly "merge" nodes in all cases. Often the correct operation is:

- `promote`: keep one canonical node as primary
- `attach`: keep another entity as structured evidence or representation
- `absorb`: collapse a weaker duplicate into the canonical node while preserving provenance
- `keep_separate`: similar but genuinely distinct

### Cross-Type Priorities

Default precedence:

- `definition > formula`
- `formula > formula-scoped symbol`
- `stray symbol > formula-scoped symbol`

Notes:

- `definition > formula` means a concept-level definition is the primary entry point when both nodes describe the same paper-level object.
- This does not mean the formula node should always be deleted. In many cases the formula should survive as an attached mathematical representation of the canonical definition.
- `stray symbol > formula-scoped symbol` applies only when the stray symbol clearly has paper-level meaning beyond a single formula.

## Cross-Type Matching Strategy

Cross-type candidates should be generated only when at least one strong bridge exists:

- same normalized surface name
- alias overlap
- shared math signature
- high summary similarity
- repeated co-location in the same DOM neighborhood

Recommended rule:

- require at least one semantic signal and one structural signal before sending a pair or cluster to adjudication

Examples:

- definition term "KTO loss" and formula label "KTO loss" with overlapping math signature: likely same concept
- definition of KL divergence containing $D_{KL}(P||Q)$ and formula labeled KL divergence: likely same concept
- formula using symbol $x$ and stray symbol $x$: not enough without matching meaning

## Canonical Outcomes

### Definition + Formula

When a `definition` and a `formula` refer to the same paper-level concept:

- the canonical node should usually be `definition`
- the formula should be attached as a mathematical representation
- the canonical node should retain provenance from both sources

Why:

- the definition usually carries the broader semantics
- the formula is often a representation of the concept, not a separate graph entry of equal status

### Stray Symbol + Formula-Scoped Symbol

When a symbol is both introduced in prose and used inside formulas:

- the canonical node should usually be a paper-level `symbol`
- formula-local observations should become scoped evidence attached to that symbol

Why:

- this preserves both paper-level meaning and local formula roles

### Formula + Formula

When two formula nodes are the same concept with repeated mentions:

- merge into one formula entity
- preserve aliases, all evidence spans, and symbol links

### Definition + Definition

When two definition nodes describe the same concept:

- merge into one definition entity
- keep the richer summary and all source evidence

## Presentation-Layer Aggregation

Not every case of apparent duplication should be solved by making backend deduplication more aggressive.

There is an important distinction between:

- canonicalization for extraction and reasoning
- aggregation for graph navigation and frontend presentation

For example, a paper may legitimately contain:

- a `definition` for "KTO loss function"
- a `formula` representing that loss
- a paper-level `symbol` such as `\mathcal{L}_\textrm{KTO}` used to refer to it later

These are different extraction-level facets of the same human-facing concept. Treating them as three fully separate peer nodes may be correct structurally, but it is often poor UX.

Current conclusion:

- backend deduplication should continue to preserve type distinctions between `definition`, `formula`, and `symbol`
- cross-type adjudication should focus on attachment and canonicalization, not on collapsing all such entities into one raw backend node
- user-facing graph navigation may need a separate concept aggregation layer

Recommended future direction:

- keep `definition`, `formula`, and `symbol` as backend entities
- introduce a presentation-level concept node or concept view
- let that concept aggregate:
  - primary definition
  - attached formulas
  - attached symbols
- render those as collapsible facets in the frontend instead of forcing users to traverse all of them as equal peers

This should be treated as a representation/UI problem built on top of deduplication outputs, not as a reason to keep extending backend dedup logic indefinitely.

## LLM Role

The LLM should not do free-form global deduplication.

The LLM should only resolve small ambiguous buckets after deterministic blocking has already done most of the work.

Expected LLM tasks:

- decide whether candidate entities refer to the same paper-level object
- choose canonical type when cross-type overlap is real
- select between `attach`, `absorb`, and `keep_separate`

Expected non-LLM tasks:

- normalization
- signature extraction
- candidate blocking
- high-confidence deterministic merges

## Suggested Implementation Shape

Extend the current deduplication step into the following sub-steps:

1. Normalize raw observations.
2. Reconcile local subsection observations across types.
3. Merge within type globally.
4. Build shared deduplication profiles for merged entities.
5. Generate cross-type candidate buckets globally using blocking.
6. Resolve high-confidence cases deterministically.
7. Send only ambiguous buckets to the LLM.
8. Build canonical entities plus attachments and provenance.

The output of deduplication should therefore include more than just flat entity lists. It should also produce canonicalization metadata, for example:

- `canonical_entity_id`
- `absorbed_entity_ids`
- `attached_formula_ids`
- `evidence_spans`
- `dedup_notes` or `resolution_reason`

## Schema Implications

The stored graph entities may remain type-specific, but deduplication needs an internal canonicalization layer.

Recommended additions:

- provenance on all final entities
- attachment metadata between canonical nodes and absorbed/attached nodes
- optional derived math-signature extraction for definitions and theorems
- aggregated occurrence metadata on deduplicated entities, for example:
  - `section_ids`
  - `dom_node_ids`
  - optional merged `occurrences` / evidence spans

Why this matters:

- later relationship extraction should be able to narrow candidates by entity locality instead of showing every section all paper-wide entities
- frontend concept views will likely also need a compact account of where an entity appears across the paper

Not recommended:

- adding dedicated formula fields to definitions just to make matching easier

## Testing Strategy

We should test deduplication with paper-local scenarios, not only unit-level string normalization.

Important fixtures:

- same concept extracted once as a prose definition and once as a formula
- same formula repeated in multiple sections
- same symbol reused with different meanings in different scopes
- same glyph introduced in prose and reused inside formulas with consistent meaning
- similar formulas with different conceptual roles that must remain separate

## Open Questions

- When should a formula remain a peer-level node instead of being attached under a definition?
- Should theorem-to-formula overlaps ever canonicalize, or only relate through edges?
- Do we want explicit confidence scores on canonicalization outcomes?
- How much provenance should be exposed in the frontend graph versus kept as backend metadata?

## Proposed Next Step

Implement deduplication as a dedicated redesign of the current `deduplicate_entities` stage rather than incremental heuristics on the existing code path.

The first milestone should be:

- local subsection reconciliation for `definition <-> formula` and `stray symbol <-> formula-scoped symbol`
- robust within-type global merging
- shared deduplication profile generation
- deterministic global cross-type reconciliation for the same two pairs

LLM adjudication can then be added only for the ambiguous clusters that remain.
