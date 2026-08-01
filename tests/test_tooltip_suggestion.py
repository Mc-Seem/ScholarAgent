from backend.app.agents.knowledge_graph_canonical import canonicalize_observations
from backend.app.agents.knowledge_graph_models import SourceObservation, SourceReference
from backend.app.agents import tooltip_suggestion


def _canonical_tooltip_graph(count=35):
    observations = [
        SourceObservation(
            id=f"obs-{index}",
            kind="topic",
            label=f"Concept {index}",
            payload={"summary": f"Definition for concept {index}.", "contribution": index / count},
            confidence=0.9,
            source=SourceReference(
                paper_id="paper-1",
                section_id="sec-1",
                dom_node_id=f"p-{index}",
                quote=f"Definition for concept {index}.",
            ),
        )
        for index in range(count)
    ]
    return canonicalize_observations("paper-1", observations).model_dump(mode="json")


def test_tooltip_suggestions_use_all_explanation_subjects_with_occurrences(monkeypatch):
    captured = []

    def select_all(entities, _expertise, _progress_callback=None):
        captured.extend(entities)
        return entities

    monkeypatch.setattr(tooltip_suggestion, "filter_entities_by_expertise", select_all)

    result = tooltip_suggestion.suggest_tooltips(
        _canonical_tooltip_graph(),
        "Familiar with probability but new to this paper.",
    )

    assert result["total_entities"] == 35
    assert result["suggested_count"] == 35
    assert len(captured) == 35
    assert all(entity["evidence"] for entity in captured)
    assert all(suggestion["occurrences"] for suggestion in result["suggestions"])
    assert all(suggestion["entity_type"] == "topic" for suggestion in result["suggestions"])


def test_canonical_facets_generate_tooltip_content():
    entity = {
        "type": "procedure",
        "label": "Coordinate ascent",
        "facets": [{"kind": "procedure", "payload": {"text": "Alternates variational updates."}}],
    }

    assert tooltip_suggestion.generate_tooltip_content(entity) == "Alternates variational updates."