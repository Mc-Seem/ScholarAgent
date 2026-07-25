"""API-level tests for cooperative knowledge graph build cancellation.

These exercise the real FastAPI endpoints (build/cancel/progress) together
with the background task, using a dedicated in-memory database wired up so
that the background task (which opens its own DB session, bypassing the
FastAPI dependency override) also sees the same in-memory data.
"""

from datetime import datetime, UTC

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.database.models import Base, Paper


@pytest.fixture
def kg_client(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    Base.metadata.create_all(engine)
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        session = TestSessionLocal()
        try:
            yield session
        finally:
            session.close()

    from backend.app.api import main as main_module
    from backend.app.api.main import app
    from backend.app.database import connection as connection_module

    app.dependency_overrides[connection_module.get_db] = override_get_db
    # `_run_kg_build_task` opens its own session directly via `SessionLocal()`,
    # bypassing the FastAPI dependency override above, so it must be patched
    # too for the background task to see the same in-memory paper.
    monkeypatch.setattr(connection_module, "SessionLocal", TestSessionLocal)

    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    monkeypatch.setattr("backend.app.api.main.UPLOADS_DIR", uploads_dir)

    # `kg_build_progress`/`kg_cancel_flags` are module-level dicts shared
    # across the whole test process; reset them so state from an earlier
    # test (possibly for the same default paper id) cannot leak in.
    main_module.kg_build_progress.clear()
    main_module.kg_cancel_flags.clear()

    client = TestClient(app)
    yield client, TestSessionLocal

    main_module.kg_build_progress.clear()
    main_module.kg_cancel_flags.clear()
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)


def _seed_compiled_paper(session_factory, paper_id: str = "paper-kg-1") -> str:
    session = session_factory()
    try:
        paper = Paper(
            id=paper_id,
            filename="paper.tar.gz",
            html_content="<article><p data-id='p1'>Hello</p></article>",
            uploaded_at=datetime.now(UTC),
            compiled_at=datetime.now(UTC),
            sections_data=[{"id": "sec-1", "title": "Intro", "level": 1}],
            equations_data=[],
            citations_data=[],
            paper_metadata={"title": "Test paper"},
        )
        session.add(paper)
        session.commit()
    finally:
        session.close()
    return paper_id


def _empty_canonical_graph():
    return {
        "schema_version": "1.0",
        "build": {
            "pipeline_version": "2.0",
            "prompt_versions": {"section_observations": "1.0"},
            "models": {"section_observations": "test"},
            "created_at": "2026-07-25T00:00:00Z",
        },
        "observations": [],
        "entities": [],
        "relations": [],
        "metrics": {
            "observation_count": 0,
            "entity_count": 0,
            "relation_count": 0,
            "diagnostics": {},
        },
    }


def _canonical_graph(entity_count: int = 40):
    from backend.app.agents.knowledge_graph_canonical import canonicalize_observations
    from backend.app.agents.knowledge_graph_models import SourceObservation, SourceReference

    observations = []
    for index in range(entity_count):
        observations.append(SourceObservation(
            id=f"obs-{index}",
            kind="concept",
            label=f"Concept {index}",
            payload={
                "summary": f"Evidence for concept {index}.",
                "aliases": [f"C{index}"],
                "contribution": index / entity_count,
            },
            confidence=0.9,
            source=SourceReference(
                paper_id="paper-kg-1",
                section_id=f"sec-{index % 3}",
                dom_node_id=f"p-{index}",
                quote=f"Evidence for concept {index}.",
            ),
        ))
    for index in range(1, min(12, entity_count)):
        observations.append(SourceObservation(
            id=f"obs-relation-{index}",
            kind="relation",
            label=f"Concept 0 depends on Concept {index}",
            payload={"type": "depends_on", "source": "Concept 0", "target": f"Concept {index}"},
            confidence=0.8,
            source=SourceReference(
                paper_id="paper-kg-1",
                section_id="sec-0",
                dom_node_id=f"relation-{index}",
                quote=f"Concept 0 depends on Concept {index}.",
            ),
        ))
    return canonicalize_observations("paper-kg-1", observations).model_dump(mode="json")


def _store_graph(session_factory, paper_id: str, graph):
    with session_factory() as db:
        paper = db.query(Paper).filter(Paper.id == paper_id).one()
        paper.knowledge_graph = graph
        db.commit()


class TestKnowledgeGraphCancelEndpoint:
    def test_cancel_returns_404_for_unknown_paper(self, kg_client):
        client, _ = kg_client
        response = client.post("/api/papers/does-not-exist/knowledge-graph/cancel")
        assert response.status_code == 404

    def test_cancel_returns_409_when_no_build_is_running(self, kg_client):
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)

        response = client.post(f"/api/papers/{paper_id}/knowledge-graph/cancel")
        assert response.status_code == 409

    def test_cancel_endpoint_sets_flag_when_build_is_extracting(self, kg_client):
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)

        from backend.app.api import main as main_module
        main_module.kg_build_progress[paper_id] = {"stage": "extracting", "progress": {}}

        response = client.post(f"/api/papers/{paper_id}/knowledge-graph/cancel")
        assert response.status_code == 200
        assert main_module.kg_cancel_flags[paper_id] is True

    def test_build_then_cancel_marks_task_as_cancelled(self, kg_client, monkeypatch):
        """
        Reproduction test for the "Stop" nitpick: cancelling a running build
        must actually stop the underlying extraction (cooperative
        cancellation) and the progress state must reflect a distinct
        "cancelled" stage rather than silently reporting "complete".

        Note: this does not call the HTTP cancel endpoint from *inside* the
        (synchronously executed) background task, since nesting a TestClient
        request inside another one running on the same task can deadlock.
        Instead it simulates a concurrent "Stop" click by flipping the shared
        cancel flag directly (exactly what the cancel endpoint does), and
        verifies the endpoint's own request/response behavior separately.
        """
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)

        from backend.app.agents import knowledge_graph as kg_module
        from backend.app.api import main as main_module

        calls = {"cancel_check_true_seen": False}

        def fake_build_kg_for_paper(pid, progress_callback=None, cancel_check=None):
            progress_callback("symbols", 1, 2)
            # Simulate the user clicking "Stop" while the build is running.
            main_module.kg_cancel_flags[pid] = True
            assert cancel_check() is True
            calls["cancel_check_true_seen"] = True
            raise kg_module.KnowledgeGraphCancelledError("stopped by test")

        monkeypatch.setattr(kg_module, "build_kg_for_paper", fake_build_kg_for_paper)

        response = client.post(f"/api/papers/{paper_id}/knowledge-graph/build")
        assert response.status_code == 200

        assert calls["cancel_check_true_seen"] is True
        assert main_module.kg_build_progress[paper_id]["stage"] == "cancelled"

    def test_cancel_flag_is_cleared_so_a_restart_is_not_immediately_cancelled(
        self, kg_client, monkeypatch,
    ):
        """
        Restart-edge case: after a build was cancelled, starting a *new*
        build for the same paper must not be immediately cancelled again by
        a stale flag left over from the previous run.
        """
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)

        from backend.app.agents import knowledge_graph as kg_module
        from backend.app.api import main as main_module

        def cancelling_build(pid, progress_callback=None, cancel_check=None):
            main_module.kg_cancel_flags[pid] = True
            raise kg_module.KnowledgeGraphCancelledError("stopped")

        monkeypatch.setattr(kg_module, "build_kg_for_paper", cancelling_build)
        first = client.post(f"/api/papers/{paper_id}/knowledge-graph/build")
        assert first.status_code == 200
        assert main_module.kg_build_progress[paper_id]["stage"] == "cancelled"

        observed_cancel_checks = []

        def completing_build(pid, progress_callback=None, cancel_check=None):
            observed_cancel_checks.append(cancel_check())
            return _empty_canonical_graph()

        monkeypatch.setattr(kg_module, "build_kg_for_paper", completing_build)
        second = client.post(f"/api/papers/{paper_id}/knowledge-graph/build")
        assert second.status_code == 200

        assert observed_cancel_checks == [False]
        assert main_module.kg_build_progress[paper_id]["stage"] == "complete"

    def test_malformed_build_output_is_not_persisted(self, kg_client, monkeypatch):
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)

        from backend.app.agents import knowledge_graph as kg_module
        from backend.app.api import main as main_module

        monkeypatch.setattr(
            kg_module,
            "build_kg_for_paper",
            lambda _pid, progress_callback=None, cancel_check=None: {
                "nodes": [], "edges": [], "metadata": {}
            },
        )

        response = client.post(f"/api/papers/{paper_id}/knowledge-graph/build")

        assert response.status_code == 200
        assert main_module.kg_build_progress[paper_id]["stage"] == "error"
        with session_factory() as db:
            assert db.query(Paper).filter(Paper.id == paper_id).one().knowledge_graph is None


class TestKnowledgeGraphProjectionEndpoints:
    def test_overview_is_capped_and_relations_have_returned_endpoints(self, kg_client):
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)
        _store_graph(session_factory, paper_id, _canonical_graph())

        response = client.get(f"/api/papers/{paper_id}/knowledge-graph/overview?limit=999")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ready"
        assert len(body["nodes"]) == 30
        node_ids = {node["stable_id"] for node in body["nodes"]}
        assert all(
            relation["source_id"] in node_ids and relation["target_id"] in node_ids
            for relation in body["relations"]
        )
        assert all(relation["evidence"] for relation in body["relations"])

    def test_subgraph_and_search_are_bounded_server_side(self, kg_client):
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)
        graph = _canonical_graph()
        _store_graph(session_factory, paper_id, graph)
        seed_id = next(entity["stable_id"] for entity in graph["entities"] if entity["label"] == "Concept 0")

        subgraph = client.get(
            f"/api/papers/{paper_id}/knowledge-graph/subgraph",
            params={"seed_ids": seed_id, "node_budget": 5, "edge_budget": 3},
        )
        search = client.get(
            f"/api/papers/{paper_id}/knowledge-graph/search",
            params={"query": "C17", "limit": 5},
        )

        assert subgraph.status_code == 200
        assert len(subgraph.json()["nodes"]) == 5
        assert len(subgraph.json()["relations"]) == 3
        assert search.status_code == 200
        assert [result["label"] for result in search.json()["results"]] == ["Concept 17"]

    def test_legacy_graph_returns_rebuild_required_state(self, kg_client):
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)
        _store_graph(session_factory, paper_id, {"nodes": [], "edges": []})

        response = client.get(f"/api/papers/{paper_id}/knowledge-graph/overview")

        assert response.status_code == 200
        assert response.json()["status"] == "rebuild_required"

    def test_malformed_canonical_graph_returns_server_error(self, kg_client):
        client, session_factory = kg_client
        paper_id = _seed_compiled_paper(session_factory)
        _store_graph(session_factory, paper_id, {"schema_version": "1.0"})

        response = client.get(f"/api/papers/{paper_id}/knowledge-graph/overview")

        assert response.status_code == 500
        assert response.json()["detail"]["code"] == "malformed_knowledge_graph"


class TestKnowledgeGraphBuildProgressStream:
    def test_sse_terminates_and_cleans_up_on_cancelled_stage(self, kg_client, monkeypatch):
        client, _ = kg_client
        from backend.app.api import main as main_module

        # Speed up the endpoint's internal polling/cleanup delay so the test
        # can observe the stream terminate naturally (instead of the client
        # forcing the connection closed), without actually waiting seconds.
        async def instant_sleep(_seconds):
            return None

        monkeypatch.setattr("backend.app.api.main.asyncio.sleep", instant_sleep)

        paper_id = "paper-sse-cancelled"
        main_module.kg_build_progress[paper_id] = {"stage": "cancelled", "progress": {}}

        events = []
        with client.stream(
            "GET", f"/api/papers/{paper_id}/knowledge-graph/build/progress",
        ) as response:
            for line in response.iter_lines():
                if line.startswith("data: "):
                    events.append(line)

        # The stream must end on its own (the `for` loop above completes
        # without us forcing a `break`) once the "cancelled" stage is seen,
        # exactly like it already does for "complete"/"error".
        assert any('"cancelled"' in event for event in events)
        assert paper_id not in main_module.kg_build_progress
