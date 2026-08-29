"""Tests for reading set CRUD, paper membership, and cascade behavior."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api.main import app
from backend.app.database.connection import get_db
from backend.app.database.models import (
    Base,
    Paper,
    ReadingSet,
    ReadingSetPaper,
)


@dataclass
class ReadingSetApiContext:
    client: TestClient
    session_factory: sessionmaker


@pytest.fixture
def reading_set_api() -> ReadingSetApiContext:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with session_factory() as db:
        db.add_all([
            Paper(
                id="paper-one",
                filename="one.tar.gz",
                arxiv_id="2401.00001",
                html_content="<article/>",
                paper_metadata={"title": "First Paper"},
            ),
            Paper(id="paper-two", filename="two.tar.gz"),
        ])
        db.commit()

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield ReadingSetApiContext(client, session_factory)
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def create_set(context: ReadingSetApiContext, name: str = "RL Survey") -> dict:
    response = context.client.post("/api/reading-sets", json={"name": name})
    assert response.status_code == 201
    return response.json()


class TestReadingSetCrud:
    def test_create_returns_empty_set_with_name(self, reading_set_api):
        created = create_set(reading_set_api, "Policy Gradient Papers")
        assert created["name"] == "Policy Gradient Papers"
        assert created["papers"] == []
        assert created["id"]

    def test_create_rejects_blank_name(self, reading_set_api):
        response = reading_set_api.client.post("/api/reading-sets", json={"name": "   "})
        assert response.status_code == 422

    def test_list_returns_created_sets_in_creation_order(self, reading_set_api):
        first = create_set(reading_set_api, "First")
        second = create_set(reading_set_api, "Second")
        response = reading_set_api.client.get("/api/reading-sets")
        assert response.status_code == 200
        listed = response.json()
        assert [item["id"] for item in listed] == [first["id"], second["id"]]

    def test_get_returns_single_set(self, reading_set_api):
        created = create_set(reading_set_api)
        response = reading_set_api.client.get(f"/api/reading-sets/{created['id']}")
        assert response.status_code == 200
        assert response.json()["name"] == "RL Survey"

    def test_get_missing_set_is_404(self, reading_set_api):
        response = reading_set_api.client.get("/api/reading-sets/missing")
        assert response.status_code == 404

    def test_rename_updates_name_and_timestamp(self, reading_set_api):
        created = create_set(reading_set_api)
        response = reading_set_api.client.put(
            f"/api/reading-sets/{created['id']}",
            json={"name": "Renamed"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Renamed"
        assert body["updated_at"] >= created["updated_at"]

    def test_delete_removes_set(self, reading_set_api):
        created = create_set(reading_set_api)
        response = reading_set_api.client.delete(f"/api/reading-sets/{created['id']}")
        assert response.status_code == 204
        assert reading_set_api.client.get(
            f"/api/reading-sets/{created['id']}"
        ).status_code == 404

    def test_delete_missing_set_is_404(self, reading_set_api):
        response = reading_set_api.client.delete("/api/reading-sets/missing")
        assert response.status_code == 404


class TestReadingSetMembership:
    def test_add_paper_returns_set_with_paper_summary(self, reading_set_api):
        created = create_set(reading_set_api)
        response = reading_set_api.client.post(
            f"/api/reading-sets/{created['id']}/papers/paper-one",
        )
        assert response.status_code == 200
        papers = response.json()["papers"]
        assert len(papers) == 1
        assert papers[0]["id"] == "paper-one"
        assert papers[0]["title"] == "First Paper"
        assert papers[0]["arxiv_id"] == "2401.00001"
        assert papers[0]["has_html"] is True
        assert papers[0]["has_knowledge_graph"] is False

    def test_add_paper_twice_is_idempotent(self, reading_set_api):
        created = create_set(reading_set_api)
        reading_set_api.client.post(f"/api/reading-sets/{created['id']}/papers/paper-one")
        response = reading_set_api.client.post(
            f"/api/reading-sets/{created['id']}/papers/paper-one",
        )
        assert response.status_code == 200
        assert len(response.json()["papers"]) == 1

    def test_add_missing_paper_is_404(self, reading_set_api):
        created = create_set(reading_set_api)
        response = reading_set_api.client.post(
            f"/api/reading-sets/{created['id']}/papers/missing",
        )
        assert response.status_code == 404

    def test_add_paper_to_missing_set_is_404(self, reading_set_api):
        response = reading_set_api.client.post("/api/reading-sets/missing/papers/paper-one")
        assert response.status_code == 404

    def test_remove_paper_returns_updated_set(self, reading_set_api):
        created = create_set(reading_set_api)
        reading_set_api.client.post(f"/api/reading-sets/{created['id']}/papers/paper-one")
        reading_set_api.client.post(f"/api/reading-sets/{created['id']}/papers/paper-two")
        response = reading_set_api.client.delete(
            f"/api/reading-sets/{created['id']}/papers/paper-one",
        )
        assert response.status_code == 200
        papers = response.json()["papers"]
        assert [paper["id"] for paper in papers] == ["paper-two"]

    def test_remove_non_member_paper_is_404(self, reading_set_api):
        created = create_set(reading_set_api)
        response = reading_set_api.client.delete(
            f"/api/reading-sets/{created['id']}/papers/paper-one",
        )
        assert response.status_code == 404


class TestReadingSetCascades:
    def test_deleting_set_removes_memberships_but_keeps_papers(self, reading_set_api):
        created = create_set(reading_set_api)
        reading_set_api.client.post(f"/api/reading-sets/{created['id']}/papers/paper-one")

        assert reading_set_api.client.delete(
            f"/api/reading-sets/{created['id']}"
        ).status_code == 204

        with reading_set_api.session_factory() as db:
            assert db.query(ReadingSetPaper).count() == 0
            assert db.query(ReadingSet).count() == 0
            assert db.get(Paper, "paper-one") is not None

    def test_deleting_paper_removes_its_memberships_but_keeps_set(self, reading_set_api):
        created = create_set(reading_set_api)
        reading_set_api.client.post(f"/api/reading-sets/{created['id']}/papers/paper-one")
        reading_set_api.client.post(f"/api/reading-sets/{created['id']}/papers/paper-two")

        with reading_set_api.session_factory() as db:
            paper = db.get(Paper, "paper-one")
            db.delete(paper)
            db.commit()

        response = reading_set_api.client.get(f"/api/reading-sets/{created['id']}")
        assert response.status_code == 200
        assert [paper["id"] for paper in response.json()["papers"]] == ["paper-two"]
