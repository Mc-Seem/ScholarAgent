import json
from pathlib import Path

from backend.app.agents.knowledge_graph_retrieval import (
    build_fixture_document,
    evaluate_retrieval,
    hybrid_retrieve,
    passage_retrieve,
)


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "knowledge_graph_baseline.json"


def fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_passage_retrieval_returns_ranked_source_evidence():
    data = fixture()

    result = passage_retrieve("What is the ELBO?", data["retrieval_corpus"], limit=2)

    assert result.source_ids == ["p-elbo-definition", "eq-elbo"]
    assert result.token_count > 0


def test_hybrid_retrieval_adds_only_budgeted_one_hop_evidence():
    data = fixture()
    document = build_fixture_document(data)

    result = hybrid_retrieve(
        "What does the ELBO depend on?",
        data["retrieval_corpus"],
        document,
        source_limit=3,
        entity_budget=4,
    )

    assert "eq-elbo" in result.source_ids
    assert "p-kl" in result.source_ids
    assert result.linked_entity_count <= 4
    assert result.expansion_depth == 1


def test_retrieval_evaluation_reports_metrics_and_conservative_gates():
    report = evaluate_retrieval(fixture(), repetitions=3)

    assert set(report["query_classes"]) == {
        "direct_definition",
        "quotation",
        "summary",
        "dependency",
        "equation_use",
        "multi_step",
    }
    for metrics in report["query_classes"].values():
        assert 0 <= metrics["passage"]["evidence_recall"] <= 1
        assert 0 <= metrics["hybrid"]["citation_faithfulness"] <= 1
        assert metrics["passage"]["latency_ms"] >= 0
        assert metrics["hybrid"]["token_count"] >= 0
        assert metrics["decision"] in {"passage_only", "hybrid"}
    assert set(report["promoted_classes"]) == {
        query_class
        for query_class, metrics in report["query_classes"].items()
        if metrics["decision"] == "hybrid"
    }


def test_fixture_document_relations_have_canonical_endpoints_and_evidence():
    document = build_fixture_document(fixture())
    entity_ids = {entity.stable_id for entity in document.entities}
    observation_ids = {observation.id for observation in document.observations}

    assert all(
        relation.source_id in entity_ids and relation.target_id in entity_ids
        for relation in document.relations
    )
    assert all(set(relation.evidence_ids) <= observation_ids for relation in document.relations)