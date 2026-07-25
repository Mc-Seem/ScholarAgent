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
| Bounded 30-node/60-edge transform median / p95 | 0.023 ms / 0.124 ms |
| Bounded 30-node/60-edge Dagre median / p95 | 13.899 ms / 42.644 ms |

Timing values are environment-sensitive and are diagnostic baselines, not universal constants. Cardinality, payload, and quality rates are deterministic.

## Canonical Connectivity Metrics

The canonical benchmark reports the full graph and the bounded overview separately:

- `isolate_rate`: fraction of returned entities with degree zero;
- `connected_component_count`: weakly connected components, including isolates;
- `largest_component_rate`: fraction of entities in the largest weakly connected component;
- `mean_degree` and `edge_density`: diagnostic graph volume independent of relation direction;
- `relation_retention_rate`: fraction of full-graph relations whose endpoints both appear in the overview;
- `semantic_cross_type_label_collision_count`: unique same-name entity pairs among `concept`, `claim`, and `method`; aliases for the same pair count once and are not auto-merged.

The initial connectivity gate requires no more than 10% overview isolates and at least 70% of overview nodes in the largest component. These are projection-quality gates, not extraction truth metrics: a sparse full graph must still be reported rather than hidden by the projection.

## Recorded Canonical Connectivity Check

Recorded on 2026-07-25 against the only canonical document in the local eight-paper database (`arXiv-2602.02383v2`, machine learning). Four other records had legacy graphs and three had no graph, so this is a one-paper validation rather than the requested cross-domain corpus result.

| Overview metric (20 nodes) | Rank-only selection | Topology-aware selection |
|---|---:|---:|
| Relations | 8 | 31 |
| Isolates | 10 (50%) | 2 (10%) |
| Connected components | 12 | 3 |
| Largest component | 8 (40%) | 18 (90%) |
| Mean degree | 0.8 | 2.7 |
| Full relations retained | 6.5% | 25.2% |

The full graph remains sparse: 196 entities, 123 relations, 98 isolates (50%), and a 69-node largest component (35.2%). The benchmark also found ten unique semantic cross-type name collisions plus one `concept`/`symbol` collision; examples include `SLIME`, `DPO`, `SimPO`, `KTO`, `MT-Bench`, and `Arena-Hard`. This supports improving extraction/canonicalization labels next, but not blind cross-type merging.

No scalar rank weights were changed. On this paper, reserving five of twenty slots for the highest-ranked core seeds and using the remaining budget for connected neighbors retained sixteen entities with `contribution >= 0.8` while passing both connectivity gates. Rebuild and benchmark the remaining papers across distinct domains before treating the 25% seed budget or the gate values as permanent.

## Retrieval Corpus

The same fixture defines questions and expected source IDs for six classes: direct definition, quotation, summary, dependency, equation use, and multi-step tracing. The first three represent passage-oriented controls; the latter three are the candidate graph-beneficial classes. Expected source IDs are evidence judgments, not expected entity IDs, so both retrieval paths are scored against source recall and citation faithfulness.

## Promotion Gates

The reworked pipeline and bounded consumers must satisfy all applicable gates:

- Rebuilding unchanged input yields 100% stable canonical entity and relation IDs.
- Duplicate rate is at least 50% lower than the annotated legacy baseline, without merging any `distinct_scope_groups`.
- Unsupported-entity rate is 5% or lower on annotated fixtures.
- Every persisted and projected relation has valid endpoints and at least one source evidence reference.
- The default overview contains 15–25 nodes and has a hard cap of 30; initial payload and layout work depend on that cap, not total canonical entities.
- A default overview has at most 10% isolated nodes and at least 70% of its nodes in the largest weakly connected component on the cross-domain canonical corpus.
- A 30-node/60-edge synthetic overview transforms at p95 below 10 ms and lays out at p95 below 100 ms on the pinned development runtime.
- Hybrid retrieval is enabled per query class only when evidence recall improves by at least 5 percentage points, citation faithfulness does not regress, p95 latency is no more than 1.5 times passage-only latency, and source-context token use is no more than 1.25 times the passage-only path.

Passage-only retrieval remains the default whenever a class is neutral, worse, or lacks enough evaluated examples to support promotion.