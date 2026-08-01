import json
from pathlib import Path

import pytest

from backend.app.agents.knowledge_graph_benchmark import (
    measure_canonical_document,
    measure_canonical_corpus,
    measure_legacy_graph,
)
from backend.app.agents.knowledge_graph_canonical import canonicalize_observations
from backend.app.agents.knowledge_graph_models import SourceObservation, SourceReference


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "knowledge_graph_baseline.json"


@pytest.fixture
def baseline_fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _canonical_document(paper_id, domain, relation_count):
    labels = [f"{domain} entity {index}" for index in range(8)]
    observations = [
        SourceObservation(
            id=f"{paper_id}-obs-{index}",
            kind="method" if index == 0 else "concept",
            label=label,
            payload={
                "summary": f"Evidence for {label}.",
                "contribution": 1.0 if index == 0 else 0.4,
                "relations": ([{
                    "type": "uses",
                    "target": labels[index + 1],
                    "evidence": f"{label} uses {labels[index + 1]}.",
                }] if index < relation_count else []),
            },
            confidence=0.9,
            source=SourceReference(
                paper_id=paper_id,
                section_id="sec-main",
                dom_node_id=f"{paper_id}-p-{index}",
                quote=f"Evidence for {label}.",
            ),
        )
        for index, label in enumerate(labels)
    ]
    return canonicalize_observations(paper_id, observations)


def test_measure_legacy_graph_reports_annotated_quality_and_volume(baseline_fixture):
    metrics = measure_legacy_graph(
        baseline_fixture["graph"],
        baseline_fixture["annotations"],
        rebuild_graph=baseline_fixture["rebuild_graph"],
    )

    assert metrics["node_count"] == 10
    assert metrics["edge_count"] == 5
    assert metrics["duplicate_node_count"] == 2
    assert metrics["duplicate_rate"] == pytest.approx(0.2)
    assert metrics["unsupported_node_count"] == 2
    assert metrics["unsupported_rate"] == pytest.approx(0.2)
    assert metrics["relations_without_evidence"] == 1
    assert metrics["relation_evidence_rate"] == pytest.approx(0.8)
    assert metrics["stable_id_rate"] == pytest.approx(0.3)
    assert metrics["payload_bytes"] > 0


def test_measure_legacy_graph_rejects_invalid_annotations(baseline_fixture):
    annotations = {**baseline_fixture["annotations"], "unsupported_node_ids": ["missing"]}

    with pytest.raises(ValueError, match="unknown node"):
        measure_legacy_graph(baseline_fixture["graph"], annotations)


def test_retrieval_fixture_covers_planned_query_classes(baseline_fixture):
    questions = baseline_fixture["retrieval_questions"]

    assert {question["class"] for question in questions} == {
        "direct_definition",
        "quotation",
        "summary",
        "dependency",
        "equation_use",
        "multi_step",
    }
    assert all(question["expected_source_ids"] for question in questions)


def test_measure_canonical_document_reports_full_and_overview_connectivity():
    metrics = measure_canonical_document(_canonical_document("paper-physics", "physics", 6), limit=6)

    assert metrics["full"]["node_count"] == 8
    assert metrics["full"]["edge_count"] == 6
    assert metrics["overview"]["node_count"] == 6
    assert metrics["overview"]["edge_count"] >= 5
    assert metrics["overview"]["isolate_count"] == 0
    assert metrics["overview"]["connected_component_count"] == 1
    assert metrics["overview"]["largest_component_rate"] == pytest.approx(1.0)
    assert metrics["ontology"]["coverage_rate"] == pytest.approx(1.0)
    assert metrics["relations"]["vocabulary_miss_count"] == 0
    assert metrics["overview"]["degree_distribution"]["ordinary_mean_degree"] <= 2


def test_measure_canonical_corpus_aggregates_domains_and_flags_sparse_graphs():
    documents = [
        ("physics", _canonical_document("paper-physics", "physics", 6)),
        ("biology", _canonical_document("paper-biology", "biology", 2)),
        ("social-science", _canonical_document("paper-social", "social science", 5)),
        ("computer-science", _canonical_document("paper-cs", "computer science", 7)),
    ]

    report = measure_canonical_corpus(documents, limit=6)

    assert report["paper_count"] == 4
    assert report["domain_counts"] == {
        "biology": 1,
        "computer-science": 1,
        "physics": 1,
        "social-science": 1,
    }
    assert report["aggregate"]["overview_isolate_rate"] > 0
    assert report["aggregate"]["overview_largest_component_rate"] < 1
    assert report["papers"][1]["connectivity_gate_passed"] is False
    assert report["aggregate"]["ontology_coverage_rate"] == pytest.approx(1.0)
    assert all(paper["ontology_gate_passed"] for paper in report["papers"])
    assert report["gates"]["min_ontology_coverage_rate"] == pytest.approx(0.9)


def test_measure_canonical_document_detects_name_collisions_from_existing_entities():
    observations = [
        SourceObservation(
            id=f"obs-{kind}",
            kind=kind,
            label="SLIME",
            payload={"summary": summary},
            source=SourceReference(
                paper_id="paper-slime",
                section_id="sec-main",
                quote=summary,
            ),
        )
        for kind, summary in [
            ("concept", "The proposed idea and its limitations."),
            ("method", "Reference-free preference optimization."),
        ]
    ]
    document = canonicalize_observations("paper-slime", observations)
    document.metrics.diagnostics["cross_type_label_collisions"] = []

    metrics = measure_canonical_document(document)

    assert metrics["cross_type_label_collision_count"] == 1
    assert metrics["cross_type_label_collisions"][0]["label"] == "SLIME"


def test_measure_canonical_document_reports_notation_scope_and_diagnostic_misses():
    document = _canonical_document("paper-physics", "physics", 4)
    document.metrics.diagnostics.update({
        "ontology_unclassified_count": 1,
        "relation_vocabulary_misses": ["measures"],
    })
    from backend.app.agents.knowledge_graph_models import NotationRecord

    evidence_id = document.observations[0].id
    document.notation = [
        NotationRecord(
            stable_id="notation:tau-supg",
            symbol="tau",
            meaning="stabilization parameter",
            scope_id="supg",
            evidence_ids=[evidence_id],
        ),
        NotationRecord(
            stable_id="notation:tau-decay",
            symbol="tau",
            meaning="decay lifetime",
            scope_id="decay",
            evidence_ids=[evidence_id],
        ),
    ]

    metrics = measure_canonical_document(document)

    assert metrics["ontology"]["coverage_rate"] == pytest.approx(8 / 9)
    assert metrics["relations"]["vocabulary_misses"] == ["measures"]
    assert metrics["notation"]["same_glyph_distinct_scope_count"] == 1
    assert metrics["notation"]["duplicate_signature_count"] == 0