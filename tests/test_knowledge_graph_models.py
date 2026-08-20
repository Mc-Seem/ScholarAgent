from copy import deepcopy

import pytest
from pydantic import ValidationError

from backend.app.agents.knowledge_graph_models import (
    BuildMetadata,
    CanonicalEntity,
    EntityFacet,
    EntitySignals,
    EquationRecord,
    KnowledgeGraphDocument,
    KnowledgeGraphMetrics,
    NotationRecord,
    Relation,
    SemanticExplanation,
    SemanticOccurrence,
    SourceObservation,
    SourceReference,
)


def _document_data():
    source = SourceReference(
        paper_id="paper-1",
        section_id="sec-method",
        dom_node_id="p-definition",
        quote="We define the evidence lower bound.",
    )
    observation = SourceObservation(
        id="obs-1",
        kind="topic",
        label="Evidence lower bound",
        payload={"summary": "The variational objective."},
        confidence=0.9,
        source=source,
    )
    entity = CanonicalEntity(
        stable_id="topic:elbo",
        kind="topic",
        label="Evidence lower bound",
        aliases=["ELBO"],
        observation_ids=[observation.id],
        roles=["study_object"],
        facets=[EntityFacet(kind="definition", payload={"text": "The variational objective."}, evidence_ids=[observation.id])],
        signals=EntitySignals(contribution=0.9, prominence=0.8, recurrence=0.5, confidence=0.9, familiarity=0.4),
    )
    artifact_observation = SourceObservation(
        id="obs-2",
        kind="artifact",
        label="Variational model",
        payload={"summary": "The optimized model."},
        confidence=0.9,
        source=source,
    )
    artifact = CanonicalEntity(
        stable_id="artifact:model",
        kind="artifact",
        label="Variational model",
        observation_ids=[artifact_observation.id],
        facets=[],
        signals=EntitySignals(),
    )
    relation = Relation(
        stable_id="relation:uses",
        type="uses",
        source_id=entity.stable_id,
        target_id=artifact.stable_id,
        qualifiers=["input"],
        evidence_ids=[observation.id],
        confidence=0.8,
    )
    notation = NotationRecord(
        stable_id="notation:q",
        symbol="q",
        meaning="Variational distribution",
        scope_id="sec-method",
        object_ids=[entity.stable_id],
        evidence_ids=[observation.id],
    )
    equation = EquationRecord(
        stable_id="equation:elbo",
        equation_id="eq-1",
        latex="L(q)=E_q[f]",
        summary="Defines the optimization objective.",
        notation_ids=[notation.stable_id],
        object_ids=[entity.stable_id],
        defined_object_id=entity.stable_id,
        evidence_ids=[observation.id],
    )
    explanation = SemanticExplanation(
        stable_id="explanation:elbo",
        subject_id=entity.stable_id,
        base_content="The objective optimized by variational inference.",
        expertise="intermediate",
        evidence_ids=[observation.id],
    )
    occurrence = SemanticOccurrence(
        stable_id="occurrence:elbo",
        subject_id=entity.stable_id,
        dom_node_id="p-definition",
        start=14,
        end=34,
        text="evidence lower bound",
        scope_id="sec-method",
    )
    return {
        "schema_version": "3.0",
        "build": BuildMetadata(pipeline_version="3.0", prompt_versions={"section": "2"}, models={"section": "test"}),
        "observations": [observation, artifact_observation],
        "objects": [entity, artifact],
        "relations": [relation],
        "equations": [equation],
        "notation": [notation],
        "explanations": [explanation],
        "occurrences": [occurrence],
        "metrics": KnowledgeGraphMetrics(
            observation_count=2,
            object_count=2,
            relation_count=1,
            diagnostics={},
        ),
    }


def test_canonical_document_round_trip_is_versioned():
    document = KnowledgeGraphDocument.model_validate(_document_data())

    restored = KnowledgeGraphDocument.model_validate_json(document.model_dump_json())

    assert restored == document
    assert restored.schema_version == "3.0"
    dumped = restored.model_dump(mode="json")
    assert "objects" in dumped and "entities" not in dumped
    assert dumped["objects"][0]["kind"] == "topic"
    assert dumped["relations"][0]["qualifiers"] == ["input"]


def test_canonical_document_rejects_missing_schema_version():
    data = _document_data()
    del data["schema_version"]

    with pytest.raises(ValidationError):
        KnowledgeGraphDocument.model_validate(data)


@pytest.mark.parametrize(
    "mutation",
    [
        "relation_type",
        "endpoint",
        "evidence",
        "notation",
        "defined_object",
        "subject",
        "occurrence_location",
    ],
)
def test_canonical_document_rejects_invalid_relations(mutation):
    data = deepcopy(KnowledgeGraphDocument.model_validate(_document_data()).model_dump(mode="json"))
    if mutation == "relation_type":
        data["relations"][0]["type"] = "mentions"
    elif mutation == "endpoint":
        data["relations"][0]["target_id"] = "missing"
    elif mutation == "evidence":
        data["relations"][0]["evidence_ids"] = ["missing"]
    elif mutation == "notation":
        data["equations"][0]["notation_ids"] = ["missing"]
    elif mutation == "defined_object":
        data["equations"][0]["defined_object_id"] = "missing"
    elif mutation == "subject":
        data["explanations"][0]["subject_id"] = "missing"
    else:
        data["occurrences"][0]["dom_node_id"] = None

    with pytest.raises(ValidationError):
        KnowledgeGraphDocument.model_validate(data)


def test_stored_equations_drop_the_retired_paper_role_label():
    """Graphs saved before the label was retired must still load."""
    data = deepcopy(KnowledgeGraphDocument.model_validate(_document_data()).model_dump(mode="json"))
    data["equations"][0]["paper_role"] = "Defines the total objective as a sum of losses."

    document = KnowledgeGraphDocument.model_validate(data)

    assert not hasattr(document.equations[0], "paper_role")
    assert "paper_role" not in document.equations[0].model_dump()


def test_schema_v2_requires_rebuild_instead_of_implicit_conversion():
    data = _document_data()
    data["schema_version"] = "1.0"

    with pytest.raises(ValidationError):
        KnowledgeGraphDocument.model_validate(data)