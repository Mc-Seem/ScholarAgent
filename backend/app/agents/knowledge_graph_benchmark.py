"""Deterministic quality and payload measurements for knowledge graph fixtures."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from backend.app.agents.knowledge_graph_canonical import cross_type_label_collisions
from backend.app.agents.knowledge_graph_models import KnowledgeGraphDocument
from backend.app.agents.knowledge_graph_projection import overview_projection


MAX_OVERVIEW_ISOLATE_RATE = 0.10
MIN_OVERVIEW_LARGEST_COMPONENT_RATE = 0.70


def _ids(items: list[dict[str, Any]]) -> set[str]:
    return {str(item["id"]) for item in items}


def _rate(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def _connectivity_metrics(
    node_ids: Iterable[str],
    edges: Iterable[tuple[str, str]],
) -> dict[str, Any]:
    nodes = set(node_ids)
    adjacency = {node_id: set() for node_id in nodes}
    valid_edges = []
    for source_id, target_id in edges:
        if source_id in nodes and target_id in nodes and source_id != target_id:
            adjacency[source_id].add(target_id)
            adjacency[target_id].add(source_id)
            valid_edges.append((source_id, target_id))

    components = []
    remaining = set(nodes)
    while remaining:
        seed = min(remaining)
        component = {seed}
        pending = [seed]
        remaining.remove(seed)
        while pending:
            current = pending.pop()
            neighbors = adjacency[current] & remaining
            remaining.difference_update(neighbors)
            component.update(neighbors)
            pending.extend(neighbors)
        components.append(component)

    isolate_count = sum(not neighbors for neighbors in adjacency.values())
    largest_component_size = max((len(component) for component in components), default=0)
    possible_edges = len(nodes) * (len(nodes) - 1) / 2
    undirected_edges = {tuple(sorted(edge)) for edge in valid_edges}
    return {
        "node_count": len(nodes),
        "edge_count": len(valid_edges),
        "isolate_count": isolate_count,
        "isolate_rate": _rate(isolate_count, len(nodes)),
        "connected_component_count": len(components),
        "largest_component_size": largest_component_size,
        "largest_component_rate": _rate(largest_component_size, len(nodes)),
        "mean_degree": _rate(sum(len(neighbors) for neighbors in adjacency.values()), len(nodes)),
        "edge_density": _rate(len(undirected_edges), int(possible_edges)),
    }


def _validate_annotations(
    node_ids: set[str], edge_ids: set[str], annotations: dict[str, Any]
) -> None:
    annotated_node_ids = set(annotations.get("unsupported_node_ids", []))
    for group_name in ("duplicate_groups", "distinct_scope_groups"):
        for group in annotations.get(group_name, []):
            annotated_node_ids.update(group)

    unknown_nodes = annotated_node_ids - node_ids
    if unknown_nodes:
        raise ValueError(f"annotations reference unknown node IDs: {sorted(unknown_nodes)}")

    evidence_ids = set(annotations.get("relations_requiring_evidence", []))
    unknown_edges = evidence_ids - edge_ids
    if unknown_edges:
        raise ValueError(f"annotations reference unknown edge IDs: {sorted(unknown_edges)}")


def measure_legacy_graph(
    graph: dict[str, Any],
    annotations: dict[str, Any],
    *,
    rebuild_graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Measure a flat legacy graph against explicit human annotations."""
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    node_ids = _ids(nodes)
    edge_ids = _ids(edges)
    _validate_annotations(node_ids, edge_ids, annotations)

    duplicate_node_count = sum(
        max(0, len(set(group)) - 1) for group in annotations.get("duplicate_groups", [])
    )
    unsupported_node_count = len(set(annotations.get("unsupported_node_ids", [])))
    evidence_edges = [
        edge for edge in edges
        if edge["id"] in set(annotations.get("relations_requiring_evidence", []))
    ]
    relations_without_evidence = sum(
        not str(edge.get("evidence", "")).strip() for edge in evidence_edges
    )

    stable_id_rate = None
    if rebuild_graph is not None:
        rebuild_ids = _ids(rebuild_graph.get("nodes", []))
        stable_id_rate = _rate(len(node_ids & rebuild_ids), len(node_ids))

    canonical_payload = json.dumps(
        graph, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")

    return {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "node_type_counts": dict(sorted(Counter(node.get("type", "unknown") for node in nodes).items())),
        "duplicate_node_count": duplicate_node_count,
        "duplicate_rate": _rate(duplicate_node_count, len(nodes)),
        "unsupported_node_count": unsupported_node_count,
        "unsupported_rate": _rate(unsupported_node_count, len(nodes)),
        "relations_requiring_evidence": len(evidence_edges),
        "relations_without_evidence": relations_without_evidence,
        "relation_evidence_rate": _rate(
            len(evidence_edges) - relations_without_evidence, len(evidence_edges)
        ),
        "payload_bytes": len(canonical_payload),
        "stable_id_rate": stable_id_rate,
    }


def measure_canonical_document(
    document: KnowledgeGraphDocument | dict[str, Any],
    *,
    limit: int = 20,
) -> dict[str, Any]:
    """Measure full-corpus and bounded-overview connectivity for one paper."""
    parsed = (
        document
        if isinstance(document, KnowledgeGraphDocument)
        else KnowledgeGraphDocument.model_validate(document)
    )
    projection = overview_projection(parsed, limit=limit)
    full = _connectivity_metrics(
        (entity.stable_id for entity in parsed.entities),
        ((relation.source_id, relation.target_id) for relation in parsed.relations),
    )
    full["node_type_counts"] = dict(sorted(Counter(entity.type for entity in parsed.entities).items()))
    overview = _connectivity_metrics(
        (node.stable_id for node in projection.nodes),
        ((relation.source_id, relation.target_id) for relation in projection.relations),
    )
    overview["node_type_counts"] = dict(sorted(Counter(node.type for node in projection.nodes).items()))
    overview["node_retention_rate"] = _rate(overview["node_count"], full["node_count"])
    overview["relation_retention_rate"] = _rate(overview["edge_count"], full["edge_count"])
    collisions = cross_type_label_collisions(parsed.entities)
    semantic_types = {"concept", "claim", "method"}
    semantic_collision_count = sum(
        set(collision["types"]) <= semantic_types for collision in collisions
    )
    return {
        "schema_version": parsed.schema_version,
        "full": full,
        "overview": overview,
        "cross_type_label_collision_count": len(collisions),
        "semantic_cross_type_label_collision_count": semantic_collision_count,
        "cross_type_label_collisions": collisions,
    }


def _paper_id(document: KnowledgeGraphDocument) -> str:
    return next(
        (observation.source.paper_id for observation in document.observations),
        "unknown",
    )


def _connectivity_gate(metrics: dict[str, Any]) -> bool:
    overview = metrics["overview"]
    return (
        overview["isolate_rate"] <= MAX_OVERVIEW_ISOLATE_RATE
        and overview["largest_component_rate"] >= MIN_OVERVIEW_LARGEST_COMPONENT_RATE
    )


def measure_canonical_corpus(
    documents: Iterable[tuple[str, KnowledgeGraphDocument | dict[str, Any]]],
    *,
    limit: int = 20,
) -> dict[str, Any]:
    """Aggregate comparable overview-connectivity metrics across paper domains."""
    papers = []
    for domain, document in documents:
        parsed = (
            document
            if isinstance(document, KnowledgeGraphDocument)
            else KnowledgeGraphDocument.model_validate(document)
        )
        metrics = measure_canonical_document(parsed, limit=limit)
        papers.append({
            "paper_id": _paper_id(parsed),
            "domain": domain,
            **metrics,
            "connectivity_gate_passed": _connectivity_gate(metrics),
        })

    overview_node_count = sum(paper["overview"]["node_count"] for paper in papers)
    overview_edge_count = sum(paper["overview"]["edge_count"] for paper in papers)
    overview_isolate_count = sum(paper["overview"]["isolate_count"] for paper in papers)
    largest_component_nodes = sum(paper["overview"]["largest_component_size"] for paper in papers)
    return {
        "paper_count": len(papers),
        "domain_counts": dict(sorted(Counter(paper["domain"] for paper in papers).items())),
        "papers": papers,
        "aggregate": {
            "overview_node_count": overview_node_count,
            "overview_edge_count": overview_edge_count,
            "overview_isolate_rate": _rate(overview_isolate_count, overview_node_count),
            "overview_largest_component_rate": _rate(largest_component_nodes, overview_node_count),
            "cross_type_label_collision_count": sum(
                paper["cross_type_label_collision_count"] for paper in papers
            ),
            "semantic_cross_type_label_collision_count": sum(
                paper["semantic_cross_type_label_collision_count"] for paper in papers
            ),
            "connectivity_gate_pass_rate": _rate(
                sum(paper["connectivity_gate_passed"] for paper in papers),
                len(papers),
            ),
        },
        "gates": {
            "max_overview_isolate_rate": MAX_OVERVIEW_ISOLATE_RATE,
            "min_overview_largest_component_rate": MIN_OVERVIEW_LARGEST_COMPONENT_RATE,
        },
    }


def measure_fixture(fixture: dict[str, Any]) -> dict[str, Any]:
    if "schema_version" in fixture:
        return measure_canonical_document(fixture)
    return measure_legacy_graph(
        fixture["graph"],
        fixture["annotations"],
        rebuild_graph=fixture.get("rebuild_graph"),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixtures", nargs="+", type=Path, help="Legacy fixture or canonical graph JSON")
    parser.add_argument("--output", type=Path, help="Optional JSON report destination")
    parser.add_argument("--limit", type=int, default=20, help="Canonical overview node budget")
    args = parser.parse_args()

    loaded = [json.loads(path.read_text(encoding="utf-8")) for path in args.fixtures]
    if len(loaded) == 1 and "graph" in loaded[0]:
        report = {
            "fixture": loaded[0].get("name", args.fixtures[0].stem),
            "metrics": measure_fixture(loaded[0]),
        }
    else:
        corpus_documents = []
        for path, payload in zip(args.fixtures, loaded, strict=True):
            if "papers" in payload:
                corpus_documents.extend(
                    (paper.get("domain", "unspecified"), paper["document"])
                    for paper in payload["papers"]
                )
            else:
                corpus_documents.append((payload.get("domain", "unspecified"), payload.get("document", payload)))
        report = measure_canonical_corpus(corpus_documents, limit=args.limit)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()