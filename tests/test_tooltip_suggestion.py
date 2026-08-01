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


def test_suggest_endpoint_returns_schema_v3_occurrence_anchors(api_client, monkeypatch):
    """The reader validates this payload, so its occurrence keys are a contract.

    Suggestions used to carry ``section_id``/``char_offset``/``snippet``; schema-v3
    anchors carry stable ids and offsets instead. A client validating the old
    shape rejected every generated suggestion as malformed.
    """
    from backend.app.api.main import app
    from backend.app.database.connection import get_db
    from backend.app.database.models import Paper

    db = next(app.dependency_overrides[get_db]())
    db.add(Paper(
        id="paper-1",
        filename="paper.tar.gz",
        knowledge_graph=_canonical_tooltip_graph(count=3),
    ))
    db.commit()
    monkeypatch.setattr(
        tooltip_suggestion,
        "filter_entities_by_expertise",
        lambda entities, _expertise, _progress=None: entities,
    )

    response = api_client.post(
        "/api/papers/paper-1/tooltips/suggest",
        json={"user_expertise": "Researcher", "entity_types": None},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["suggested_count"] == 3
    occurrence = body["suggestions"][0]["occurrences"][0]
    assert set(occurrence) == {
        "stable_id", "subject_id", "dom_node_id", "equation_id",
        "start", "end", "text", "scope_id", "local_override_id",
    }


def test_suggest_endpoint_validates_entity_types_against_schema_v3_kinds(api_client):
    """Kinds live on objects; the pre-rework code read a "nodes" key that is gone."""
    from backend.app.api.main import app
    from backend.app.database.connection import get_db
    from backend.app.database.models import Paper

    db = next(app.dependency_overrides[get_db]())
    db.add(Paper(
        id="paper-2",
        filename="paper.tar.gz",
        knowledge_graph=_canonical_tooltip_graph(count=2),
    ))
    db.commit()

    rejected = api_client.post(
        "/api/papers/paper-2/tooltips/suggest",
        json={"user_expertise": "Researcher", "entity_types": ["symbol"]},
    )

    assert rejected.status_code == 400
    assert "topic" in rejected.json()["detail"]
    assert "notation" in rejected.json()["detail"]


def _paper_with_graph(paper_id="paper-apply", count=2):
    """Store a paper whose HTML actually contains the anchored nodes."""
    from backend.app.api.main import app
    from backend.app.database.connection import get_db
    from backend.app.database.models import Paper

    graph = _canonical_tooltip_graph(count=count)
    html = "<article>" + "".join(
        f"<p data-id='p-{index}'>Definition for concept {index}.</p>"
        for index in range(count)
    ) + "</article>"
    db = next(app.dependency_overrides[get_db]())
    db.add(Paper(id=paper_id, filename="paper.tar.gz", html_content=html, knowledge_graph=graph))
    db.commit()
    return graph


def _drafts_for(graph):
    """Exactly what the drafts panel can send: no anchor positions at all."""
    return [
        {
            "entity_id": item["stable_id"],
            "entity_label": item["label"],
            "entity_type": item["kind"],
            "tooltip_content": f"Note about {item['label']}.",
        }
        for item in graph["objects"]
    ]


def test_apply_resolves_occurrences_from_the_graph_when_the_client_sends_none(api_client):
    """The drafts panel has no occurrences to send, so the server must find them.

    Stored suggestions keep only label and text: ``tooltip_suggestions`` has no
    column for anchors. Requiring them in the request produced notes with zero
    highlighted occurrences, which is invisible to the reader.
    """
    graph = _paper_with_graph()

    response = api_client.post(
        "/api/papers/paper-apply/tooltips/apply",
        json={"suggestions": _drafts_for(graph)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["tooltips_created"] == 2
    assert body["spans_injected"] == 2
    assert body["errors"] == []

    html = api_client.get("/api/papers/paper-apply").json()["html_content"]
    assert html.count('class="kg-entity"') == 2
    assert html.count(f'data-subject-id="{graph["objects"][0]["stable_id"]}"') == 1


def test_apply_anchors_entities_that_already_have_a_note_without_duplicating_it(api_client):
    """A note can exist while its highlights do not, and reruns must fix that."""
    graph = _paper_with_graph(paper_id="paper-reapply")
    drafts = _drafts_for(graph)
    api_client.post("/api/papers/paper-reapply/tooltips/apply", json={"suggestions": drafts})

    from backend.app.api.main import app
    from backend.app.database.connection import get_db
    from backend.app.database.models import Paper

    db = next(app.dependency_overrides[get_db]())
    paper = db.query(Paper).filter(Paper.id == "paper-reapply").first()
    paper.html_content = "".join(
        f"<p data-id='p-{index}'>Definition for concept {index}.</p>" for index in range(2)
    )
    db.commit()

    again = api_client.post(
        "/api/papers/paper-reapply/tooltips/apply",
        json={"suggestions": drafts},
    )

    assert again.status_code == 200
    assert again.json()["spans_injected"] == 2
    assert again.json()["tooltips_created"] == 0
    tooltips = api_client.get("/api/papers/paper-reapply/tooltips").json()
    assert len(tooltips) == 2


def test_apply_reports_entities_the_graph_cannot_anchor(api_client):
    """A manual draft has no subject in the graph, so it highlights nothing."""
    _paper_with_graph(paper_id="paper-manual")

    response = api_client.post(
        "/api/papers/paper-manual/tooltips/apply",
        json={"suggestions": [{
            "entity_id": "manual_1",
            "entity_label": "Hand-written term",
            "entity_type": "other",
            "tooltip_content": "My own note.",
        }]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["tooltips_created"] == 1
    assert body["spans_injected"] == 0
    assert body["errors"] == ["No occurrences in the knowledge graph for: Hand-written term"]


def test_canonical_facets_generate_tooltip_content():
    entity = {
        "type": "procedure",
        "label": "Coordinate ascent",
        "facets": [{"kind": "procedure", "payload": {"text": "Alternates variational updates."}}],
    }

    assert tooltip_suggestion.generate_tooltip_content(entity) == "Alternates variational updates."