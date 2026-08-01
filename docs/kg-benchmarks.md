# Knowledge Graph Benchmarks

This document fixes the pre-rework baseline, corpus annotations, and promotion gates used by the canonical knowledge graph work. The deterministic fixture is `tests/fixtures/knowledge_graph_baseline.json`; it intentionally models known legacy failure modes rather than an ideal graph.

## Reproducing the Baseline

Run quality, volume, payload, and rebuild-identity measurements from the project root:

```bash
.venv/bin/python -m backend.app.agents.knowledge_graph_benchmark tests/fixtures/knowledge_graph_baseline.json
```

Run the current client transform and Dagre layout path with the pinned Node runtime:

```bash
mise exec -- npm --prefix frontend run benchmark:kg
```

Run the bounded synthetic overview gate (30 nodes and 60 edges):

```bash
mise exec -- npm --prefix frontend run benchmark:kg:overview
```

Run connectivity and cross-type collision measurements over exported canonical documents from several domains:

```bash
.venv/bin/python -m backend.app.agents.knowledge_graph_benchmark exports/physics.json exports/biology.json exports/ml.json --limit 20 --output kg-corpus-report.json
```

Each input may be a canonical document directly or `{ "domain": "...", "document": { ... } }`. A manifest may instead contain `papers[]` with `domain` and `document` fields. This makes domain coverage explicit and prevents a single-paper result from being presented as a corpus conclusion.

The fixture annotations are authoritative. A benchmark fails when an annotation references a missing node or relation, preventing fixture edits from silently invalidating the measurements. Duplicate groups identify observations that should canonicalize together; `distinct_scope_groups` identify similar observations that must remain separate.

## Recorded Legacy Baseline

Recorded on 2026-07-25 with the checked-in dependency lockfiles:

| Metric | Baseline |
|---|---:|
| Nodes | 10 |
| Edges | 5 |
| Duplicate nodes | 2 (20%) |
| Unsupported nodes | 2 (20%) |
| Relations with evidence | 4/5 (80%) |
| Stable IDs across equivalent rebuilds | 3/10 (30%) |
| Canonical JSON payload | 2,699 bytes |
| Client transform median / p95 | 0.007 ms / 0.036 ms |
| Dagre layout median / p95 | 1.988 ms / 3.251 ms |
| Bounded 30-node/60-edge transform median / p95 | 0.022 ms / 0.044 ms |
| Bounded 30-node/60-edge Dagre median / p95 | 11.615 ms / 13.622 ms |

Timing values are environment-sensitive and are diagnostic baselines, not universal constants. Cardinality, payload, and quality rates are deterministic.

## Canonical Connectivity Metrics

The canonical benchmark reports the full graph and the bounded overview separately:

- `isolate_rate`: fraction of returned entities with degree zero;
- `connected_component_count`: weakly connected components, including isolates;
- `largest_component_rate`: fraction of entities in the largest weakly connected component;
- `mean_degree`, ordinary/hub degree distribution, and `edge_density`;
- node/relation retention and omitted-relation counts before and after sparse projection;
- ontology coverage across `topic`, `claim`, `procedure`, `artifact`, and `quantity` with a 90% gate;
- relation-vocabulary misses and qualifier volume;
- cross-kind name collisions, duplicate notation signatures, and same-glyph/different-scope notation counts.

The connectivity gate requires no more than 10% overview isolates and at least 70% of overview nodes in the largest component. Ordinary-node degree should normally remain one or two; structurally central hubs may exceed that. These are projection-quality gates: omitted canonical relations remain available through focused expansion and details.

## Schema-v3 Corpus Check

`tests/test_knowledge_graph_benchmark.py` runs the same deterministic corpus harness across physics, biology, social science, and computer science fixtures. It verifies 100% top-level ontology coverage for labeled objects, zero controlled-relation misses, ordinary overview mean degree at most two, scoped same-glyph notation separation, and explicit failure reporting for a deliberately sparse paper. This is a contract fixture rather than a claim about extraction accuracy on a production corpus; real papers still need rebuilds before they can be compared under schema v3.

The overview no longer renders every induced edge. It selects contribution-preserving connected neighbors and emits an information-ranked spanning backbone, while the canonical document and focused subgraph endpoints retain all source-backed relations. Dense eight-node test graphs therefore render seven overview edges and report every omitted relation rather than deleting it.

## Retrieval Corpus

The same fixture defines questions and expected source IDs for six classes: direct definition, quotation, summary, dependency, equation use, and multi-step tracing. The first three represent passage-oriented controls; the latter three are the candidate graph-beneficial classes. Expected source IDs are evidence judgments, not expected entity IDs, so both retrieval paths are scored against source recall and citation faithfulness.

## Promotion Gates

The reworked pipeline and bounded consumers must satisfy all applicable gates:

- Rebuilding unchanged input yields 100% stable canonical entity and relation IDs.
- Duplicate rate is at least 50% lower than the annotated legacy baseline, without merging any `distinct_scope_groups`.
- Unsupported-entity rate is 5% or lower on annotated fixtures.
- Every persisted and projected relation has valid endpoints and at least one source evidence reference.
- At least 90% of labeled important objects fit the five universal kinds without adding domain-shaped top-level enums.
- Same-glyph notation with distinct meaning/scope remains separate; identical scoped notation reuses explanations and evidence.
- The default overview contains 15–25 nodes and has a hard cap of 30; initial payload and layout work depend on that cap, not total canonical entities.
- A default overview has at most 10% isolated nodes and at least 70% of its nodes in the largest weakly connected component on the cross-domain canonical corpus.
- A 30-node/60-edge synthetic overview transforms at p95 below 10 ms and lays out at p95 below 100 ms on the pinned development runtime.
- Hybrid retrieval is enabled per query class only when evidence recall improves by at least 5 percentage points, citation faithfulness does not regress, p95 latency is no more than 1.5 times passage-only latency, and source-context token use is no more than 1.25 times the passage-only path.

Passage-only retrieval remains the default whenever a class is neutral, worse, or lacks enough evaluated examples to support promotion.