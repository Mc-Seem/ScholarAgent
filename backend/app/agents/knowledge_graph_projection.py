"""Bounded, evidence-backed projections over canonical knowledge graph documents."""

from __future__ import annotations

from collections import Counter
from typing import Any, Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.app.agents.knowledge_graph_models import (
    CanonicalEntity,
    EntityFacet,
    EntitySignals,
    KnowledgeGraphDocument,
    Relation,
    SourceObservation,
    SourceReference,
)


DEFAULT_OVERVIEW_LIMIT = 20
MAX_OVERVIEW_LIMIT = 30
MAX_SUBGRAPH_NODES = 50
MAX_SUBGRAPH_EDGES = 100
OVERVIEW_CORE_SEED_FRACTION = 0.25


class LegacyKnowledgeGraphError(ValueError):
    pass


class MalformedKnowledgeGraphError(ValueError):
    pass


class ProjectionModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProjectionEvidence(ProjectionModel):
    observation_id: str
    kind: str
    label: str
    source: SourceReference


class ProjectionNode(ProjectionModel):
    stable_id: str
    type: str
    label: str
    aliases: list[str]
    facets: list[EntityFacet]
    signals: EntitySignals
    rank: float = Field(ge=0.0)
    evidence: list[ProjectionEvidence]


class ProjectionRelation(ProjectionModel):
    stable_id: str
    type: str
    source_id: str
    target_id: str
    confidence: float
    evidence: list[ProjectionEvidence]


class KnowledgeGraphProjection(ProjectionModel):
    status: Literal["ready"] = "ready"
    schema_version: str
    nodes: list[ProjectionNode]
    relations: list[ProjectionRelation]
    total_entity_count: int
    total_relation_count: int
    truncated: bool = False


class SearchResult(ProjectionModel):
    stable_id: str
    type: str
    label: str
    aliases: list[str]
    score: float = Field(ge=0.0)
    signals: EntitySignals
    facets: list[EntityFacet]
    evidence: list[ProjectionEvidence]


def parse_document(data: dict[str, Any] | KnowledgeGraphDocument) -> KnowledgeGraphDocument:
    if isinstance(data, KnowledgeGraphDocument):
        return data
    if not isinstance(data, dict) or "schema_version" not in data:
        raise LegacyKnowledgeGraphError("knowledge graph must be rebuilt using the canonical schema")
    try:
        return KnowledgeGraphDocument.model_validate(data)
    except ValidationError as error:
        raise MalformedKnowledgeGraphError("stored canonical knowledge graph is invalid") from error


def _observation_index(document: KnowledgeGraphDocument) -> dict[str, SourceObservation]:
    return {observation.id: observation for observation in document.observations}


def _evidence(
    evidence_ids: Iterable[str], observation_index: dict[str, SourceObservation]
) -> list[ProjectionEvidence]:
    return [
        ProjectionEvidence(
            observation_id=observation.id,
            kind=observation.kind,
            label=observation.label,
            source=observation.source,
        )
        for evidence_id in evidence_ids
        if (observation := observation_index.get(evidence_id)) is not None
    ]


def _connectivity(document: KnowledgeGraphDocument) -> Counter[str]:
    counts: Counter[str] = Counter()
    for relation in document.relations:
        counts[relation.source_id] += 1
        counts[relation.target_id] += 1
    return counts


def entity_rank(
    entity: CanonicalEntity,
    *,
    connectivity: int = 0,
    max_connectivity: int = 1,
    expertise: Literal["novice", "intermediate", "expert"] = "intermediate",
) -> float:
    normalized_connectivity = connectivity / max(1, max_connectivity)
    signals = entity.signals
    base = (
        0.35 * signals.contribution
        + 0.20 * signals.prominence
        + 0.15 * signals.recurrence
        + 0.15 * signals.confidence
        + 0.15 * normalized_connectivity
    )
    familiarity_penalty = {"novice": 0.0, "intermediate": 0.1, "expert": 0.25}[expertise]
    if signals.contribution >= 0.8:
        familiarity_penalty = 0.0
    return max(0.0, base - familiarity_penalty * signals.familiarity)


def _ranked_entities(
    document: KnowledgeGraphDocument,
    entities: Iterable[CanonicalEntity],
    expertise: Literal["novice", "intermediate", "expert"],
) -> list[tuple[CanonicalEntity, float]]:
    connectivity = _connectivity(document)
    maximum = max(connectivity.values(), default=1)
    ranked = [
        (
            entity,
            entity_rank(
                entity,
                connectivity=connectivity[entity.stable_id],
                max_connectivity=maximum,
                expertise=expertise,
            ),
        )
        for entity in entities
    ]
    return sorted(ranked, key=lambda item: (-item[1], item[0].label.casefold(), item[0].stable_id))


def _select_overview_entities(
    document: KnowledgeGraphDocument,
    ranked: list[tuple[CanonicalEntity, float]],
    limit: int,
) -> list[tuple[CanonicalEntity, float]]:
    """Keep core contributions, then spend the remaining budget on their neighborhood."""
    if not ranked or limit <= 0:
        return []

    rank_by_id = {entity.stable_id: rank for entity, rank in ranked}
    candidate_ids = set(rank_by_id)
    adjacency = {entity_id: set() for entity_id in candidate_ids}
    for relation in document.relations:
        if relation.source_id in candidate_ids and relation.target_id in candidate_ids:
            adjacency[relation.source_id].add(relation.target_id)
            adjacency[relation.target_id].add(relation.source_id)

    core_ids = [
        entity.stable_id
        for entity, _ in ranked
        if entity.signals.contribution >= 0.8
    ]
    core_budget = max(1, min(limit, round(limit * OVERVIEW_CORE_SEED_FRACTION)))
    selected_ids = set(core_ids[:core_budget])
    if not selected_ids:
        selected_ids.add(ranked[0][0].stable_id)

    while len(selected_ids) < min(limit, len(ranked)):
        remaining = [item for item in ranked if item[0].stable_id not in selected_ids]
        frontier = [
            item for item in remaining
            if adjacency[item[0].stable_id] & selected_ids
        ]
        if frontier:
            entity, _ = min(
                frontier,
                key=lambda item: (
                    -len(adjacency[item[0].stable_id] & selected_ids),
                    -item[1],
                    item[0].label.casefold(),
                    item[0].stable_id,
                ),
            )
        else:
            entity = remaining[0][0]
        selected_ids.add(entity.stable_id)

    return [item for item in ranked if item[0].stable_id in selected_ids]


def _project_node(
    entity: CanonicalEntity,
    rank: float,
    observation_index: dict[str, SourceObservation],
) -> ProjectionNode:
    return ProjectionNode(
        stable_id=entity.stable_id,
        type=entity.type,
        label=entity.label,
        aliases=entity.aliases,
        facets=entity.facets,
        signals=entity.signals,
        rank=rank,
        evidence=_evidence(entity.observation_ids, observation_index),
    )


def _project_relations(
    document: KnowledgeGraphDocument,
    selected_ids: set[str],
    observation_index: dict[str, SourceObservation],
    edge_budget: int,
) -> list[ProjectionRelation]:
    candidates = [
        relation for relation in document.relations
        if relation.source_id in selected_ids and relation.target_id in selected_ids
    ]
    candidates.sort(key=lambda relation: (-relation.confidence, relation.stable_id))
    return [
        ProjectionRelation(
            stable_id=relation.stable_id,
            type=relation.type,
            source_id=relation.source_id,
            target_id=relation.target_id,
            confidence=relation.confidence,
            evidence=_evidence(relation.evidence_ids, observation_index),
        )
        for relation in candidates[:edge_budget]
    ]


def overview_projection(
    document: KnowledgeGraphDocument,
    *,
    types: set[str] | None = None,
    section: str | None = None,
    min_importance: float = 0.0,
    expertise: Literal["novice", "intermediate", "expert"] = "intermediate",
    show_familiar: bool = False,
    limit: int = DEFAULT_OVERVIEW_LIMIT,
) -> KnowledgeGraphProjection:
    observation_index = _observation_index(document)
    selected_types = types or {"concept", "claim", "method"}
    candidates = []
    for entity in document.entities:
        if entity.type not in selected_types:
            continue
        entity_evidence = _evidence(entity.observation_ids, observation_index)
        if section and not any(item.source.section_id == section for item in entity_evidence):
            continue
        if (
            expertise == "expert"
            and not show_familiar
            and entity.signals.familiarity >= 0.8
            and entity.signals.contribution < 0.8
        ):
            continue
        candidates.append(entity)

    ranked = [item for item in _ranked_entities(document, candidates, expertise) if item[1] >= min_importance]
    bounded_limit = max(1, min(limit, MAX_OVERVIEW_LIMIT))
    selected = _select_overview_entities(document, ranked, bounded_limit)
    nodes = [_project_node(entity, rank, observation_index) for entity, rank in selected]
    selected_ids = {node.stable_id for node in nodes}
    relations = _project_relations(document, selected_ids, observation_index, MAX_SUBGRAPH_EDGES)
    return KnowledgeGraphProjection(
        schema_version=document.schema_version,
        nodes=nodes,
        relations=relations,
        total_entity_count=len(document.entities),
        total_relation_count=len(document.relations),
        truncated=len(ranked) > len(nodes),
    )


def focus_projection(
    document: KnowledgeGraphDocument,
    *,
    seed_ids: set[str] | None = None,
    section: str | None = None,
    dom_node_id: str | None = None,
    equation_id: str | None = None,
    types: set[str] | None = None,
    expertise: Literal["novice", "intermediate", "expert"] = "intermediate",
    node_budget: int = 30,
    edge_budget: int = 60,
) -> KnowledgeGraphProjection:
    observation_index = _observation_index(document)
    entity_by_id = {entity.stable_id: entity for entity in document.entities}
    resolved_seeds = {seed_id for seed_id in (seed_ids or set()) if seed_id in entity_by_id}
    if section or dom_node_id or equation_id:
        for entity in document.entities:
            evidence = _evidence(entity.observation_ids, observation_index)
            if any(
                (not section or item.source.section_id == section)
                and (not dom_node_id or item.source.dom_node_id == dom_node_id)
                and (not equation_id or item.source.equation_id == equation_id)
                for item in evidence
            ):
                resolved_seeds.add(entity.stable_id)
    if not resolved_seeds:
        return KnowledgeGraphProjection(
            schema_version=document.schema_version,
            nodes=[],
            relations=[],
            total_entity_count=len(document.entities),
            total_relation_count=len(document.relations),
        )

    allowed_types = types or {entity.type for entity in document.entities}
    bounded_nodes = max(1, min(node_budget, MAX_SUBGRAPH_NODES))
    bounded_edges = max(0, min(edge_budget, MAX_SUBGRAPH_EDGES))
    ranked_all = _ranked_entities(document, document.entities, expertise)
    rank_by_id = {entity.stable_id: rank for entity, rank in ranked_all}
    ranked_seeds = sorted(
        (entity_by_id[seed_id] for seed_id in resolved_seeds if entity_by_id[seed_id].type in allowed_types),
        key=lambda entity: (-rank_by_id[entity.stable_id], entity.stable_id),
    )
    selected_ids = {entity.stable_id for entity in ranked_seeds[:bounded_nodes]}
    neighbor_ids = set()
    for relation in document.relations:
        if relation.source_id in selected_ids:
            neighbor_ids.add(relation.target_id)
        if relation.target_id in selected_ids:
            neighbor_ids.add(relation.source_id)
    neighbors = [
        entity_by_id[neighbor_id] for neighbor_id in neighbor_ids - selected_ids
        if entity_by_id[neighbor_id].type in allowed_types
    ]
    neighbors.sort(key=lambda entity: (-rank_by_id[entity.stable_id], entity.stable_id))
    for neighbor in neighbors[:max(0, bounded_nodes - len(selected_ids))]:
        selected_ids.add(neighbor.stable_id)

    selected_entities = sorted(
        (entity_by_id[entity_id] for entity_id in selected_ids),
        key=lambda entity: (-rank_by_id[entity.stable_id], entity.stable_id),
    )
    nodes = [
        _project_node(entity, rank_by_id[entity.stable_id], observation_index)
        for entity in selected_entities
    ]
    relations = _project_relations(document, selected_ids, observation_index, bounded_edges)
    return KnowledgeGraphProjection(
        schema_version=document.schema_version,
        nodes=nodes,
        relations=relations,
        total_entity_count=len(document.entities),
        total_relation_count=len(document.relations),
        truncated=len(resolved_seeds | neighbor_ids) > len(nodes),
    )


def search_entities(
    document: KnowledgeGraphDocument,
    query: str,
    *,
    types: set[str] | None = None,
    limit: int = 10,
) -> list[SearchResult]:
    normalized_query = " ".join(query.casefold().split())
    if not normalized_query:
        return []
    observation_index = _observation_index(document)
    connectivity = _connectivity(document)
    maximum = max(connectivity.values(), default=1)
    results = []
    for entity in document.entities:
        if types and entity.type not in types:
            continue
        labels = [entity.label, *entity.aliases]
        normalized_labels = [" ".join(label.casefold().split()) for label in labels]
        if normalized_query in normalized_labels:
            text_score = 1.0
        elif any(label.startswith(normalized_query) for label in normalized_labels):
            text_score = 0.8
        elif any(normalized_query in label for label in normalized_labels):
            text_score = 0.6
        else:
            facet_text = " ".join(str(facet.payload) for facet in entity.facets).casefold()
            if normalized_query not in facet_text:
                continue
            text_score = 0.4
        rank = entity_rank(
            entity,
            connectivity=connectivity[entity.stable_id],
            max_connectivity=maximum,
        )
        results.append((entity, text_score + 0.2 * rank))
    results.sort(key=lambda item: (-item[1], item[0].label.casefold(), item[0].stable_id))
    return [
        SearchResult(
            stable_id=entity.stable_id,
            type=entity.type,
            label=entity.label,
            aliases=entity.aliases,
            score=score,
            signals=entity.signals,
            facets=entity.facets,
            evidence=_evidence(entity.observation_ids, observation_index),
        )
        for entity, score in results[:max(1, min(limit, 50))]
    ]