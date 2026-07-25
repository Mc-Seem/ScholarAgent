from datetime import UTC, datetime

import pytest

from backend.app.agents.knowledge_graph_models import (
    BuildMetadata,
    CanonicalEntity,
    EntityFacet,
    EntitySignals,
    KnowledgeGraphDocument,
    KnowledgeGraphMetrics,
    Relation,
    SourceObservation,
    SourceReference,
)
from backend.app.agents.knowledge_graph_projection import (
    LegacyKnowledgeGraphError,
    focus_projection,
    overview_projection,
    search_entities,
)


def make_document(entity_count=40):
    observations = []
    entities = []
    for index in range(entity_count):
        observation = SourceObservation(
            id=f"obs-{index}",
            kind="concept",
            label=f"Concept {index}",
            payload={"summary": f"Evidence for concept {index}."},
            confidence=0.8,
            source=SourceReference(
                paper_id="paper-1",
                section_id=f"sec-{index % 3}",
                dom_node_id=f"p-{index}",
                quote=f"Evidence for concept {index}.",
            ),
        )
        observations.append(observation)
        entities.append(CanonicalEntity(
            stable_id=f"concept:{index}",
            type="concept",
            label=f"Concept {index}",
            aliases=[f"C{index}"],
            observation_ids=[observation.id],
            facets=[EntityFacet(
                kind="definition",
                payload={"text": f"Evidence for concept {index}."},
                evidence_ids=[observation.id],
            )],
            signals=EntitySignals(
                contribution=1.0 if index == entity_count - 1 else index / entity_count,
                prominence=1 - (index / (entity_count * 2)),
                recurrence=(index % 5) / 5,
                confidence=0.8,
                familiarity=1.0 if index in {entity_count - 1, entity_count - 2} else 0.1,
            ),
        ))

    relations = []
    for index in range(1, min(entity_count, 12)):
        relations.append(Relation(
            stable_id=f"relation:{index}",
            type="depends_on",
            source_id="concept:0",
            target_id=f"concept:{index}",
            evidence_ids=[f"obs-{index}"],
            confidence=0.8,
        ))
    return KnowledgeGraphDocument(
        schema_version="1.0",
        build=BuildMetadata(
            pipeline_version="2.0",
            created_at=datetime(2026, 7, 25, tzinfo=UTC),
        ),
        observations=observations,
        entities=entities,
        relations=relations,
        metrics=KnowledgeGraphMetrics(
            observation_count=len(observations),
            entity_count=len(entities),
            relation_count=len(relations),
            diagnostics={},
        ),
    )


def test_overview_is_hard_capped_and_preserves_core_contributions_for_experts():
    document = make_document()

    projection = overview_projection(document, limit=100, expertise="expert")

    assert len(projection.nodes) == 30
    assert "concept:39" in {node.stable_id for node in projection.nodes}
    assert all(edge.source_id in {node.stable_id for node in projection.nodes} for edge in projection.relations)
    assert all(edge.target_id in {node.stable_id for node in projection.nodes} for edge in projection.relations)


def test_overview_prefers_connected_neighbors_over_disconnected_lower_rank_nodes():
    document = make_document(20)
    entity_by_id = {entity.stable_id: entity for entity in document.entities}
    for index, entity in enumerate(document.entities):
        entity.signals.contribution = 1.0 if index == 19 else 0.2
        entity.signals.prominence = 0.9 if index >= 12 else 0.2
        entity.signals.recurrence = 0.0
    entity_by_id["concept:0"].signals.contribution = 0.9

    projection = overview_projection(document, limit=8)
    selected_ids = {node.stable_id for node in projection.nodes}
    connected_ids = {f"concept:{index}" for index in range(12)}

    assert {"concept:0", "concept:19"} <= selected_ids
    assert len(selected_ids & connected_ids) >= 7
    assert len(projection.relations) >= 6


def test_overview_filters_types_sections_and_familiar_entities():
    document = make_document()

    projection = overview_projection(
        document,
        types={"concept"},
        section="sec-1",
        expertise="expert",
        show_familiar=False,
        limit=20,
    )

    assert projection.nodes
    assert all(node.type == "concept" for node in projection.nodes)
    assert all(any(evidence.source.section_id == "sec-1" for evidence in node.evidence) for node in projection.nodes)
    assert "concept:38" not in {node.stable_id for node in projection.nodes}


def test_focus_projection_is_one_hop_and_respects_node_and_edge_budgets():
    document = make_document()

    projection = focus_projection(
        document,
        seed_ids={"concept:0"},
        node_budget=5,
        edge_budget=3,
    )

    returned_ids = {node.stable_id for node in projection.nodes}
    assert "concept:0" in returned_ids
    assert len(projection.nodes) == 5
    assert len(projection.relations) == 3
    assert all(edge.source_id in returned_ids and edge.target_id in returned_ids for edge in projection.relations)


def test_focus_projection_can_seed_from_source_location():
    projection = focus_projection(make_document(9), section="sec-2", node_budget=4)

    assert projection.nodes
    assert all(
        any(evidence.source.section_id == "sec-2" for evidence in node.evidence)
        or node.stable_id == "concept:0"
        for node in projection.nodes
    )


def test_search_returns_ranked_results_without_projection_expansion():
    results = search_entities(make_document(), "C17", limit=5)

    assert [result.stable_id for result in results] == ["concept:17"]
    assert results[0].evidence


def test_projection_rejects_legacy_unversioned_graphs():
    from backend.app.agents.knowledge_graph_projection import parse_document

    with pytest.raises(LegacyKnowledgeGraphError):
        parse_document({"nodes": [], "edges": []})