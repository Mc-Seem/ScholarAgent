"""Versioned canonical knowledge graph contracts persisted in ``Paper.knowledge_graph``."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


SCHEMA_VERSION = "3.0"
EntityType = Literal["topic", "claim", "procedure", "artifact", "quantity"]
ObservationKind = Literal[
    "topic", "claim", "procedure", "artifact", "quantity", "equation", "notation", "relation"
]
RelationType = Literal[
    "is_a",
    "part_of",
    "uses",
    "depends_on",
    "applies_to",
    "produces",
    "supports",
    "challenges",
    "compares_with",
]

LEGACY_OBSERVATION_KINDS = {
    "concept": "topic",
    "method": "procedure",
    "formula": "equation",
    "symbol": "notation",
}
LEGACY_RELATION_TYPES = {
    "defines": ("is_a", "definition"),
    "derives_from": ("depends_on", "derivation"),
    "evaluated_by": ("uses", "evaluation"),
}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


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

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_kind(cls, data: Any) -> Any:
        if isinstance(data, dict) and data.get("kind") in LEGACY_OBSERVATION_KINDS:
            data = {**data, "kind": LEGACY_OBSERVATION_KINDS[data["kind"]]}
        return data


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
    kind: EntityType = Field(validation_alias=AliasChoices("kind", "type"))
    label: str = Field(min_length=1)
    aliases: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(
        min_length=1,
        validation_alias=AliasChoices("evidence_ids", "observation_ids"),
    )
    facets: list[EntityFacet] = Field(default_factory=list)
    signals: EntitySignals = Field(default_factory=EntitySignals)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_kind(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        field_name = "kind" if "kind" in data else "type"
        if data.get(field_name) in LEGACY_OBSERVATION_KINDS:
            return {**data, field_name: LEGACY_OBSERVATION_KINDS[data[field_name]]}
        return data

    @property
    def type(self) -> EntityType:
        """Compatibility accessor for projection code during the schema transition."""
        return self.kind

    @property
    def observation_ids(self) -> list[str]:
        """Compatibility accessor for canonicalization code during the schema transition."""
        return self.evidence_ids


class Relation(StrictModel):
    stable_id: str = Field(min_length=1)
    type: RelationType
    source_id: str = Field(min_length=1)
    target_id: str = Field(min_length=1)
    qualifiers: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(min_length=1)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_type(cls, data: Any) -> Any:
        if not isinstance(data, dict) or data.get("type") not in LEGACY_RELATION_TYPES:
            return data
        relation_type, qualifier = LEGACY_RELATION_TYPES[data["type"]]
        qualifiers = list(data.get("qualifiers", []))
        if qualifier not in qualifiers:
            qualifiers.append(qualifier)
        return {**data, "type": relation_type, "qualifiers": qualifiers}

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
    object_count: int = Field(
        ge=0,
        validation_alias=AliasChoices("object_count", "entity_count"),
    )
    relation_count: int = Field(ge=0)
    diagnostics: dict[str, Any] = Field(default_factory=dict)

    @property
    def entity_count(self) -> int:
        """Compatibility accessor for existing graph API responses."""
        return self.object_count


class EquationRecord(StrictModel):
    stable_id: str = Field(min_length=1)
    equation_id: str = Field(min_length=1)
    latex: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    paper_role: str = Field(min_length=1)
    notation_ids: list[str] = Field(default_factory=list)
    object_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(min_length=1)


class NotationRecord(StrictModel):
    stable_id: str = Field(min_length=1)
    symbol: str = Field(min_length=1)
    meaning: str = Field(min_length=1)
    scope_id: str = Field(min_length=1)
    units: str | None = None
    constraints: list[str] = Field(default_factory=list)
    object_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(min_length=1)


class SemanticExplanation(StrictModel):
    stable_id: str = Field(min_length=1)
    subject_id: str = Field(min_length=1)
    base_content: str = Field(min_length=1)
    expertise: Literal["novice", "intermediate", "expert"] = "intermediate"
    evidence_ids: list[str] = Field(min_length=1)


class SemanticOccurrence(StrictModel):
    stable_id: str = Field(min_length=1)
    subject_id: str = Field(min_length=1)
    dom_node_id: str | None = None
    equation_id: str | None = None
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str = Field(min_length=1)
    scope_id: str = Field(min_length=1)
    local_override_id: str | None = None

    @model_validator(mode="after")
    def validate_anchor(self) -> "SemanticOccurrence":
        if not (self.dom_node_id or self.equation_id):
            raise ValueError("occurrence must identify a DOM node or equation")
        if self.end <= self.start:
            raise ValueError("occurrence end must follow start")
        if self.end - self.start != len(self.text):
            raise ValueError("occurrence offsets must match text length")
        return self


class KnowledgeGraphDocument(StrictModel):
    schema_version: Literal[SCHEMA_VERSION]
    build: BuildMetadata
    observations: list[SourceObservation]
    objects: list[CanonicalEntity] = Field(validation_alias=AliasChoices("objects", "entities"))
    relations: list[Relation]
    equations: list[EquationRecord] = Field(default_factory=list)
    notation: list[NotationRecord] = Field(default_factory=list)
    explanations: list[SemanticExplanation] = Field(default_factory=list)
    occurrences: list[SemanticOccurrence] = Field(default_factory=list)
    metrics: KnowledgeGraphMetrics

    @property
    def entities(self) -> list[CanonicalEntity]:
        """Compatibility accessor for graph projections during the schema transition."""
        return self.objects

    @model_validator(mode="after")
    def validate_references_and_counts(self) -> "KnowledgeGraphDocument":
        observation_ids = [observation.id for observation in self.observations]
        entity_ids = [entity.stable_id for entity in self.objects]
        relation_ids = [relation.stable_id for relation in self.relations]
        equation_ids = [equation.stable_id for equation in self.equations]
        notation_ids = [item.stable_id for item in self.notation]
        explanation_ids = [item.stable_id for item in self.explanations]
        occurrence_ids = [item.stable_id for item in self.occurrences]
        if len(observation_ids) != len(set(observation_ids)):
            raise ValueError("observation IDs must be unique")
        if len(entity_ids) != len(set(entity_ids)):
            raise ValueError("entity IDs must be unique")
        if len(relation_ids) != len(set(relation_ids)):
            raise ValueError("relation IDs must be unique")
        for label, values in (
            ("equation", equation_ids),
            ("notation", notation_ids),
            ("explanation", explanation_ids),
            ("occurrence", occurrence_ids),
        ):
            if len(values) != len(set(values)):
                raise ValueError(f"{label} IDs must be unique")

        known_observations = set(observation_ids)
        known_entities = set(entity_ids)
        known_notation = set(notation_ids)
        known_subjects = known_entities | known_notation
        known_explanations = set(explanation_ids)
        for entity in self.objects:
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

        for equation in self.equations:
            if set(equation.notation_ids) - known_notation:
                raise ValueError(f"equation {equation.stable_id} references unknown notation")
            if set(equation.object_ids) - known_entities:
                raise ValueError(f"equation {equation.stable_id} references unknown objects")
            if set(equation.evidence_ids) - known_observations:
                raise ValueError(f"equation {equation.stable_id} references unknown evidence")
        for item in self.notation:
            if set(item.object_ids) - known_entities:
                raise ValueError(f"notation {item.stable_id} references unknown objects")
            if set(item.evidence_ids) - known_observations:
                raise ValueError(f"notation {item.stable_id} references unknown evidence")
        for explanation in self.explanations:
            if explanation.subject_id not in known_subjects:
                raise ValueError(f"explanation {explanation.stable_id} references unknown subject")
            if set(explanation.evidence_ids) - known_observations:
                raise ValueError(f"explanation {explanation.stable_id} references unknown evidence")
        for occurrence in self.occurrences:
            if occurrence.subject_id not in known_subjects:
                raise ValueError(f"occurrence {occurrence.stable_id} references unknown subject")
            if occurrence.local_override_id and occurrence.local_override_id not in known_explanations:
                raise ValueError(f"occurrence {occurrence.stable_id} references unknown override")

        expected_counts = (len(self.observations), len(self.objects), len(self.relations))
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