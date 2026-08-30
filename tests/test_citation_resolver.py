"""Tests for the citation card, lazy cached resolution, and anchor validation."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.agents.citation_resolver import CitationResolution
from backend.app.api import citation_routes
from backend.app.api.main import app
from backend.app.database.connection import get_db
from backend.app.database.models import Base, CitationLink, Paper


SOURCE_HTML = (
    '<article>'
    '<p data-id="p-1">Our approach builds on transformers '
    '<cite class="ltx_cite"><a href="#bib.bib1">[1]</a></cite> for attention.</p>'
    '<p data-id="p-2">Unrelated paragraph.</p>'
    '<section class="ltx_bibliography">'
    '<ul><li class="ltx_bibitem" id="bib.bib1" data-id="bib-node-1">'
    'Ashish Vaswani et al. Attention Is All You Need. arXiv:1706.03762, 2017.'
    '</li></ul>'
    '</section>'
    '</article>'
)

TARGET_HTML = (
    '<article>'
    '<section data-id="sec-1"><h2 data-id="h-1">Attention</h2>'
    '<p data-id="p-b-1">Scaled dot-product attention weighs values by key similarity.</p>'
    '</section>'
    '</article>'
)


@dataclass
class CitationApiContext:
    client: TestClient
    session_factory: sessionmaker


@pytest.fixture
def citation_api() -> CitationApiContext:
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
                id="paper-a",
                filename="source.tar.gz",
                html_content=SOURCE_HTML,
                citations_data=[{
                    "key": "bib1",
                    "text": "Ashish Vaswani et al. Attention Is All You Need. arXiv:1706.03762, 2017.",
                    "dom_node_id": "bib-node-1",
                }],
                paper_metadata={"title": "Source Paper"},
            ),
            Paper(
                id="paper-b",
                filename="target.tar.gz",
                arxiv_id="1706.03762",
                html_content=TARGET_HTML,
                sections_data=[{
                    "id": "sec-1",
                    "title": "Attention",
                    "content_html": "<p>Scaled dot-product attention weighs values.</p>",
                }],
                paper_metadata={"title": "Attention Is All You Need"},
            ),
            Paper(id="paper-c", filename="empty.tar.gz"),
        ])
        db.commit()

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield CitationApiContext(client, session_factory)
    app.dependency_overrides.clear()
    citation_routes.citation_resolver_override = None
    Base.metadata.drop_all(engine)
    engine.dispose()


def card(context: CitationApiContext, paper_id: str = "paper-a", cite_key: str = "bib1"):
    return context.client.get(f"/api/papers/{paper_id}/citations/{cite_key}/card")


def resolve(context: CitationApiContext, target: str = "paper-b"):
    return context.client.post(
        "/api/papers/paper-a/citations/bib1/resolve",
        json={"target_paper_id": target},
    )


class TestCitationCard:
    def test_matches_library_paper_by_arxiv_id(self, citation_api):
        response = card(citation_api)
        assert response.status_code == 200
        body = response.json()
        assert body["arxiv_id"] == "1706.03762"
        assert body["matched_paper"]["id"] == "paper-b"
        assert body["matched_paper"]["title"] == "Attention Is All You Need"
        assert body["has_cached_resolution"] is False
        assert "Attention Is All You Need" in body["bib_text"]

    def test_matches_by_normalized_title_without_arxiv_id(self, citation_api):
        with citation_api.session_factory() as db:
            paper = db.query(Paper).filter(Paper.id == "paper-a").first()
            paper.citations_data = [{
                "key": "bib1",
                "text": "Vaswani et al. Attention is all you need! NeurIPS, 2017.",
                "dom_node_id": "bib-node-1",
            }]
            target = db.query(Paper).filter(Paper.id == "paper-b").first()
            target.arxiv_id = None
            db.commit()

        body = card(citation_api).json()
        assert body["arxiv_id"] is None
        assert body["matched_paper"]["id"] == "paper-b"

    def test_no_match_for_unknown_reference(self, citation_api):
        with citation_api.session_factory() as db:
            paper = db.query(Paper).filter(Paper.id == "paper-a").first()
            paper.citations_data = [{
                "key": "bib1",
                "text": "Some Author. A completely different reference. Journal, 1999.",
                "dom_node_id": "bib-node-1",
            }]
            db.commit()

        body = card(citation_api).json()
        assert body["arxiv_id"] is None
        assert body["matched_paper"] is None

    def test_missing_citation_key_is_404(self, citation_api):
        assert card(citation_api, cite_key="bib99").status_code == 404

    def test_paper_without_citations_data_is_404(self, citation_api):
        response = card(citation_api, paper_id="paper-c")
        assert response.status_code == 404
        assert response.json()["detail"] == "Paper has no extracted citations"

    def test_missing_paper_is_404(self, citation_api):
        assert card(citation_api, paper_id="missing").status_code == 404


class TestCitationResolve:
    def test_first_resolve_calls_llm_and_caches(self, citation_api, monkeypatch):
        calls = []

        def fake_resolver(prompt: str) -> CitationResolution:
            calls.append(prompt)
            return CitationResolution(
                target_kind="passage",
                section_id="sec-1",
                dom_node_id="p-b-1",
                quote="Scaled dot-product attention",
                confidence="high",
            )

        monkeypatch.setattr(citation_routes, "citation_resolver_override", fake_resolver)

        first = resolve(citation_api)
        assert first.status_code == 200
        body = first.json()
        assert body["target_kind"] == "passage"
        assert body["target_dom_node_id"] == "p-b-1"
        assert body["quote"] == "Scaled dot-product attention"
        assert body["cached"] is False
        assert len(calls) == 1
        # The prompt grounds the LLM in A's citing paragraph and B's sections.
        assert "builds on transformers" in calls[0]
        assert "sec-1" in calls[0]

        with citation_api.session_factory() as db:
            assert db.query(CitationLink).count() == 1

        second = resolve(citation_api)
        assert second.status_code == 200
        assert second.json()["cached"] is True
        assert len(calls) == 1  # no second LLM call

        assert card(citation_api).json()["has_cached_resolution"] is True

    def test_invalid_anchor_from_llm_becomes_none(self, citation_api, monkeypatch):
        monkeypatch.setattr(
            citation_routes,
            "citation_resolver_override",
            lambda prompt: CitationResolution(
                target_kind="passage",
                dom_node_id="not-a-real-node",
                quote="whatever",
                confidence="high",
            ),
        )

        body = resolve(citation_api).json()
        assert body["target_kind"] == "none"
        assert body["target_dom_node_id"] is None
        assert body["quote"] is None

    def test_invalid_section_from_llm_becomes_none(self, citation_api, monkeypatch):
        monkeypatch.setattr(
            citation_routes,
            "citation_resolver_override",
            lambda prompt: CitationResolution(
                target_kind="section",
                section_id="sec-imaginary",
                confidence="medium",
            ),
        )

        body = resolve(citation_api).json()
        assert body["target_kind"] == "none"
        assert body["target_section_id"] is None

    def test_quote_not_in_node_is_dropped_but_anchor_kept(self, citation_api, monkeypatch):
        monkeypatch.setattr(
            citation_routes,
            "citation_resolver_override",
            lambda prompt: CitationResolution(
                target_kind="passage",
                dom_node_id="p-b-1",
                quote="text that is not in the node",
                confidence="medium",
            ),
        )

        body = resolve(citation_api).json()
        assert body["target_kind"] == "passage"
        assert body["target_dom_node_id"] == "p-b-1"
        assert body["quote"] is None

    def test_stale_html_version_invalidates_cache(self, citation_api, monkeypatch):
        calls = []

        def fake_resolver(prompt: str) -> CitationResolution:
            calls.append(prompt)
            return CitationResolution(
                target_kind="section", section_id="sec-1", confidence="high",
            )

        monkeypatch.setattr(citation_routes, "citation_resolver_override", fake_resolver)

        assert resolve(citation_api).json()["cached"] is False
        assert len(calls) == 1

        # Recompiling B changes its HTML, so the cached anchor may be wrong.
        with citation_api.session_factory() as db:
            target = db.query(Paper).filter(Paper.id == "paper-b").first()
            target.html_content = TARGET_HTML + "<p data-id='p-new'>New passage.</p>"
            db.commit()

        body = resolve(citation_api).json()
        assert body["cached"] is False
        assert len(calls) == 2

        with citation_api.session_factory() as db:
            assert db.query(CitationLink).count() == 1  # stale row replaced

    def test_resolve_against_uncompiled_target_is_409(self, citation_api):
        assert resolve(citation_api, target="paper-c").status_code == 409

    def test_resolve_against_missing_target_is_404(self, citation_api):
        assert resolve(citation_api, target="missing").status_code == 404

    def test_resolve_without_citations_data_is_404(self, citation_api):
        response = citation_api.client.post(
            "/api/papers/paper-c/citations/bib1/resolve",
            json={"target_paper_id": "paper-b"},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Paper has no extracted citations"
