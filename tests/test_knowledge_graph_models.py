from copy import deepcopy

import pytest
from pydantic import ValidationError

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


def _document_data():
    source = SourceReference(
        paper_id="paper-1",
        section_id="sec-method",
        dom_node_id="p-definition",
        quote="We define the evidence lower bound.",
    )
    observation = SourceObservation(
        id="obs-1",
        kind="concept",
        label="Evidence lower bound",
        payload={"summary": "The variational objective."},
        confidence=0.9,
        source=source,
    )
    entity = CanonicalEntity(
        stable_id="concept:elbo",
        type="concept",
        label="Evidence lower bound",
        aliases=["ELBO"],
        observation_ids=[observation.id],
        facets=[EntityFacet(kind="definition", payload={"text": "The variational objective."}, evidence_ids=[observation.id])],
        signals=EntitySignals(contribution=0.9, prominence=0.8, recurrence=0.5, confidence=0.9, familiarity=0.4),
    )
    relation = Relation(
        stable_id="relation:uses",
        type="uses",
        source_id=entity.stable_id,
        target_id="formula:elbo",
        evidence_ids=[observation.id],
        confidence=0.8,
    )
    formula = CanonicalEntity(
        stable_id="formula:elbo",
        type="formula",
        label="ELBO objective",
        observation_ids=[observation.id],
        facets=[],
        signals=EntitySignals(),
    )
    return {
        "schema_version": "1.0",
        "build": BuildMetadata(pipeline_version="2.0", prompt_versions={"section": "1"}, models={"section": "test"}),
        "observations": [observation],
        "entities": [entity, formula],
        "relations": [relation],
        "metrics": KnowledgeGraphMetrics(
            observation_count=1,
            entity_count=2,
            relation_count=1,
            diagnostics={},
        ),
    }


def test_canonical_document_round_trip_is_versioned():
    document = KnowledgeGraphDocument.model_validate(_document_data())

    restored = KnowledgeGraphDocument.model_validate_json(document.model_dump_json())

    assert restored == document
    assert restored.schema_version == "1.0"


def test_canonical_document_rejects_missing_schema_version():
    data = _document_data()
    del data["schema_version"]

    with pytest.raises(ValidationError):
        KnowledgeGraphDocument.model_validate(data)


@pytest.mark.parametrize("mutation", ["relation_type", "endpoint", "evidence"])
def test_canonical_document_rejects_invalid_relations(mutation):
    data = deepcopy(KnowledgeGraphDocument.model_validate(_document_data()).model_dump(mode="json"))
    if mutation == "relation_type":
        data["relations"][0]["type"] = "mentions"
    elif mutation == "endpoint":
        data["relations"][0]["target_id"] = "missing"
    else:
        data["relations"][0]["evidence_ids"] = ["missing"]

    with pytest.raises(ValidationError):
        KnowledgeGraphDocument.model_validate(data)