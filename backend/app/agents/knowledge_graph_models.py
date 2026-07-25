"""Versioned canonical knowledge graph contracts persisted in ``Paper.knowledge_graph``."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


SCHEMA_VERSION = "1.0"
EntityType = Literal["concept", "claim", "method", "formula", "symbol"]
ObservationKind = Literal["concept", "claim", "method", "formula", "symbol", "relation"]
RelationType = Literal[
    "defines",
    "uses",
    "depends_on",
    "supports",
    "derives_from",
    "evaluated_by",
    "has_formula",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceReference(StrictModel):
    paper_id: str = Field(min_length=1)
    section_id: str | None = None
    section_title: str | None = None
    dom_node_id: str | None = None
    equation_id: str | None = None
    quote: str = Field(min_length=1)
    char_start: int | None = Field(default=None, ge=0)
    char_end: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_location(self) -> "SourceReference":
        if not (self.section_id or self.dom_node_id or self.equation_id):
            raise ValueError("source must identify a section, DOM node, or equation")
        if self.char_end is not None and self.char_start is None:
            raise ValueError("char_end requires char_start")
        if self.char_start is not None and self.char_end is not None and self.char_end < self.char_start:
            raise ValueError("char_end must not precede char_start")
        return self


class SourceObservation(StrictModel):
    id: str = Field(min_length=1)
    kind: ObservationKind
    label: str = Field(min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source: SourceReference


class EntityFacet(StrictModel):
    kind: str = Field(min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    evidence_ids: list[str] = Field(default_factory=list)


class EntitySignals(StrictModel):
    contribution: float = Field(default=0.0, ge=0.0, le=1.0)
    prominence: float = Field(default=0.0, ge=0.0, le=1.0)
    recurrence: float = Field(default=0.0, ge=0.0, le=1.0)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    familiarity: float = Field(default=0.0, ge=0.0, le=1.0)


class CanonicalEntity(StrictModel):
    stable_id: str = Field(min_length=1)
    type: EntityType
    label: str = Field(min_length=1)
    aliases: list[str] = Field(default_factory=list)
    observation_ids: list[str] = Field(min_length=1)
    facets: list[EntityFacet] = Field(default_factory=list)
    signals: EntitySignals = Field(default_factory=EntitySignals)


class Relation(StrictModel):
    stable_id: str = Field(min_length=1)
    type: RelationType
    source_id: str = Field(min_length=1)
    target_id: str = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def reject_self_relation(self) -> "Relation":
        if self.source_id == self.target_id:
            raise ValueError("relation endpoints must differ")
        return self


class BuildMetadata(StrictModel):
    pipeline_version: str = Field(min_length=1)
    prompt_versions: dict[str, str] = Field(default_factory=dict)
    models: dict[str, str] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class KnowledgeGraphMetrics(StrictModel):
    observation_count: int = Field(ge=0)
    entity_count: int = Field(ge=0)
    relation_count: int = Field(ge=0)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class KnowledgeGraphDocument(StrictModel):
    schema_version: Literal[SCHEMA_VERSION]
    build: BuildMetadata
    observations: list[SourceObservation]
    entities: list[CanonicalEntity]
    relations: list[Relation]
    metrics: KnowledgeGraphMetrics

    @model_validator(mode="after")
    def validate_references_and_counts(self) -> "KnowledgeGraphDocument":
        observation_ids = [observation.id for observation in self.observations]
        entity_ids = [entity.stable_id for entity in self.entities]
        relation_ids = [relation.stable_id for relation in self.relations]
        if len(observation_ids) != len(set(observation_ids)):
            raise ValueError("observation IDs must be unique")
        if len(entity_ids) != len(set(entity_ids)):
            raise ValueError("entity IDs must be unique")
        if len(relation_ids) != len(set(relation_ids)):
            raise ValueError("relation IDs must be unique")

        known_observations = set(observation_ids)
        known_entities = set(entity_ids)
        for entity in self.entities:
            unknown = set(entity.observation_ids) - known_observations
            if unknown:
                raise ValueError(f"entity {entity.stable_id} references unknown observations: {sorted(unknown)}")
            for facet in entity.facets:
                unknown = set(facet.evidence_ids) - known_observations
                if unknown:
                    raise ValueError(f"facet on {entity.stable_id} references unknown evidence: {sorted(unknown)}")
        for relation in self.relations:
            if relation.source_id not in known_entities or relation.target_id not in known_entities:
                raise ValueError(f"relation {relation.stable_id} has an unknown endpoint")
            unknown = set(relation.evidence_ids) - known_observations
            if unknown:
                raise ValueError(f"relation {relation.stable_id} references unknown evidence: {sorted(unknown)}")

        expected_counts = (len(self.observations), len(self.entities), len(self.relations))
        actual_counts = (
            self.metrics.observation_count,
            self.metrics.entity_count,
            self.metrics.relation_count,
        )
        if actual_counts != expected_counts:
            raise ValueError("metrics counts must match document contents")
        return self


def validate_knowledge_graph_document(data: dict[str, Any]) -> KnowledgeGraphDocument:
    """Parse and validate a persisted canonical document."""
    return KnowledgeGraphDocument.model_validate(data)