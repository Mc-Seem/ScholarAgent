# Knowledge Graph Retrieval Evaluation

## Decision

Passage/equation retrieval remains the runtime default for every evaluated query class. Canonical graph expansion is experimental and is not wired into agent or chat flows.

The hybrid path improved relational evidence recall, but no class passed all four promotion gates: at least five percentage points of recall improvement, no citation-faithfulness regression, at most 1.5× passage latency, and at most 1.25× source-context tokens.

## Reproduction

```bash
.venv/bin/python -m backend.app.agents.knowledge_graph_retrieval \
  tests/fixtures/knowledge_graph_baseline.json --repetitions 100
```

The corpus and source judgments live in `tests/fixtures/knowledge_graph_baseline.json`. The harness in `backend/app/agents/knowledge_graph_retrieval.py` compares lexical passage/equation retrieval with canonical entity linking plus a budgeted one-hop expansion.

## Results

Recorded on 2026-07-25. Latency is the median of 100 in-process runs; it excludes network and model calls.

| Query class | Passage recall / faithfulness | Hybrid recall / faithfulness | Passage / hybrid latency | Passage / hybrid tokens | Decision |
|---|---:|---:|---:|---:|---|
| Direct definition | 1.00 / 1.00 | 1.00 / 0.67 | 0.031 / 0.063 ms | 26 / 35 | Passage only |
| Quotation | 1.00 / 0.50 | 1.00 / 0.33 | 0.033 / 0.065 ms | 26 / 35 | Passage only |
| Summary | 1.00 / 1.00 | 1.00 / 0.67 | 0.031 / 0.057 ms | 26 / 35 | Passage only |
| Dependency | 0.50 / 0.50 | 1.00 / 0.67 | 0.031 / 0.062 ms | 26 / 35 | Passage only |
| Equation use | 0.50 / 0.50 | 1.00 / 0.67 | 0.035 / 0.065 ms | 26 / 35 | Passage only |
| Multi-step | 0.33 / 0.50 | 0.67 / 0.67 | 0.035 / 0.068 ms | 26 / 35 | Passage only |

## Interpretation

- Direct, quotation, and summary questions gain no recall and add irrelevant context.
- Dependency and equation-use questions show the expected graph recall benefit, but the current expansion is about 2× slower and 1.35× larger in source tokens.
- Multi-step tracing improves but still misses one expected source under the one-hop/entity budget.
- The next experiment should rerank graph-added evidence against passages rather than append all neighbor evidence. Promotion remains per class, never global.