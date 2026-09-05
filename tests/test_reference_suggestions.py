"""Tests for the reading-set reference suggestion agent and its route."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.agents import reference_suggestions
from backend.app.agents.reference_suggestions import (
    ReferenceRanking,
    collect_candidate_references,
    normalize_arxiv_id,
    suggest_references,
)
from backend.app.api.main import app
from backend.app.database.connection import get_db
from backend.app.database.models import (
    Base,
    Paper,
    ReadingSet,
    ReadingSetPaper,
)


def citation(key: str, text: str) -> dict:
    return {"key": key, "text": text, "dom_node_id": f"bib-{key}"}


def make_paper(paper_id: str, *, arxiv_id=None, citations=None, metadata=None) -> Paper:
    return Paper(
        id=paper_id,
        filename=f"{paper_id}.tar.gz",
        arxiv_id=arxiv_id,
        citations_data=citations,
        paper_metadata=metadata,
    )


def fail_ranker(member_summaries, candidates):
    raise AssertionError(f"LLM ranker must not be called, got {len(candidates)} candidates")


# =============================================================================
# Candidate collection (pure unit tests, no DB/HTTP/LLM)
# =============================================================================

class TestNormalization:
    def test_version_suffix_and_case_are_stripped(self):
        assert normalize_arxiv_id("2401.12345v2") == "2401.12345"
        assert normalize_arxiv_id(" 2401.12345V3 ") == "2401.12345"
        assert normalize_arxiv_id("2401.12345") == "2401.12345"


class TestCollectCandidateReferences:
    def test_extracts_and_dedupes_across_papers(self):
        papers = [
            make_paper("paper-a", citations=[
                citation("r1", "Foo et al. arXiv:2402.11111v2, 2024."),
                citation("r2", "Bar. arXiv 2403.22222."),
            ]),
            make_paper("paper-b", citations=[
                citation("r1", "Foo again, arXiv:2402.11111."),
                citation("r2", "No arxiv id in this entry."),
            ]),
        ]

        candidates, skipped = collect_candidate_references(papers)

        assert skipped == []
        by_id = {candidate.arxiv_id: candidate for candidate in candidates}
        assert set(by_id) == {"2402.11111", "2403.22222"}
        assert by_id["2402.11111"].cited_by_paper_ids == ["paper-a", "paper-b"]
        assert by_id["2403.22222"].cited_by_paper_ids == ["paper-a"]

    def test_member_papers_own_arxiv_ids_are_excluded(self):
        papers = [
            make_paper("paper-a", arxiv_id="2401.00001", citations=[
                citation("r1", "Companion paper arXiv:2401.00002v1."),
            ]),
            make_paper("paper-b", arxiv_id="2401.00002", citations=[
                citation("r1", "Self-adjacent cite arXiv:2401.00001."),
                citation("r2", "External arXiv:2405.55555."),
            ]),
        ]

        candidates, _ = collect_candidate_references(papers)

        assert [candidate.arxiv_id for candidate in candidates] == ["2405.55555"]

    def test_papers_without_citations_are_skipped(self):
        papers = [
            make_paper("paper-a", citations=[citation("r1", "arXiv:2402.11111")]),
            make_paper("paper-empty", citations=[]),
            make_paper("paper-none", citations=None),
        ]

        _, skipped = collect_candidate_references(papers)

        assert skipped == [
            {"paper_id": "paper-empty", "reason": "no_citations"},
            {"paper_id": "paper-none", "reason": "no_citations"},
        ]

    def test_cap_prefers_candidates_cited_by_multiple_papers(self):
        papers = [
            make_paper("paper-a", citations=[
                citation("r1", "Single cite arXiv:2402.11111."),
                citation("r2", "Shared cite arXiv:2403.22222."),
            ]),
            make_paper("paper-b", citations=[
                citation("r1", "Shared cite arXiv:2403.22222v4."),
            ]),
        ]

        candidates, _ = collect_candidate_references(papers, max_candidates=1)

        assert [candidate.arxiv_id for candidate in candidates] == ["2403.22222"]


# =============================================================================
# suggest_references pipeline (mocked fetch + injected ranker)
# =============================================================================

class TestSuggestReferences:
    def papers(self) -> list[Paper]:
        return [
            make_paper(
                "paper-a",
                citations=[
                    citation("r1", "Foo arXiv:2402.11111."),
                    citation("r2", "Bar arXiv:2403.22222."),
                ],
                metadata={"title": "Member A", "abstract": "About policy gradients."},
            ),
            make_paper("paper-b", citations=[citation("r1", "Foo arXiv:2402.11111.")]),
        ]

    def metadata(self) -> dict:
        return {
            "2402.11111": {"title": "Foo Paper", "abstract": "Foo abstract."},
            "2403.22222": {"title": "Bar Paper", "abstract": "Bar abstract."},
        }

    def test_ranked_suggestions_sorted_by_relevance_then_citations(self, monkeypatch):
        monkeypatch.setattr(
            reference_suggestions, "fetch_arxiv_metadata", lambda ids: self.metadata(),
        )

        def ranker(member_summaries, candidates):
            assert any("Member A" in summary for summary in member_summaries)
            return [
                ReferenceRanking(
                    arxiv_id="2402.11111", relevance="low", reason="Tangential.",
                ),
                ReferenceRanking(
                    arxiv_id="2403.22222", relevance="high", reason="Core method.",
                ),
            ]

        result = suggest_references(self.papers(), ranker=ranker)

        assert [item.arxiv_id for item in result.suggestions] == [
            "2403.22222",
            "2402.11111",
        ]
        top = result.suggestions[0]
        assert top.title == "Bar Paper"
        assert top.abstract == "Bar abstract."
        assert top.relevance == "high"
        assert top.reason == "Core method."

    def test_llm_failure_degrades_to_medium(self, monkeypatch):
        monkeypatch.setattr(
            reference_suggestions, "fetch_arxiv_metadata", lambda ids: self.metadata(),
        )

        def broken_ranker(member_summaries, candidates):
            raise RuntimeError("LLM unavailable")

        result = suggest_references(self.papers(), ranker=broken_ranker)

        assert len(result.suggestions) == 2
        assert all(item.relevance == "medium" for item in result.suggestions)
        assert all(item.reason == "Ranking unavailable" for item in result.suggestions)
        # Ties on relevance fall back to citing-paper count.
        assert result.suggestions[0].arxiv_id == "2402.11111"

    def test_candidates_missing_from_arxiv_response_are_dropped(self, monkeypatch):
        monkeypatch.setattr(
            reference_suggestions,
            "fetch_arxiv_metadata",
            lambda ids: {"2402.11111": {"title": "Foo Paper", "abstract": ""}},
        )

        def ranker(member_summaries, candidates):
            assert [candidate.arxiv_id for candidate in candidates] == ["2402.11111"]
            return [
                ReferenceRanking(arxiv_id="2402.11111", relevance="high", reason="Only one."),
            ]

        result = suggest_references(self.papers(), ranker=ranker)

        assert [item.arxiv_id for item in result.suggestions] == ["2402.11111"]

    def test_no_arxiv_references_returns_empty_without_fetch_or_llm(self, monkeypatch):
        monkeypatch.setattr(
            reference_suggestions,
            "fetch_arxiv_metadata",
            lambda ids: pytest.fail("arXiv API must not be called"),
        )
        papers = [
            make_paper("paper-a", citations=[citation("r1", "No id here.")]),
            make_paper("paper-b", citations=None),
        ]

        result = suggest_references(papers, ranker=fail_ranker)

        assert result.suggestions == []
        assert result.skipped_papers == [
            {"paper_id": "paper-b", "reason": "no_citations"},
        ]


# =============================================================================
# Atom parsing
# =============================================================================

ATOM_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2402.11111v2</id>
    <title>Foo
      Paper</title>
    <summary>  Foo   abstract. </summary>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2403.22222v1</id>
    <title>Bar Paper</title>
    <summary>Bar abstract.</summary>
  </entry>
</feed>
"""


class TestFetchArxivMetadata:
    def test_parses_entries_version_insensitively(self, monkeypatch):
        requested: dict = {}

        class FakeResponse:
            text = ATOM_FEED

            def raise_for_status(self):
                pass

        class FakeClient:
            def __init__(self, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def get(self, url, params=None):
                requested["url"] = url
                requested["params"] = params
                return FakeResponse()

        monkeypatch.setattr(reference_suggestions.httpx, "Client", FakeClient)

        metadata = reference_suggestions.fetch_arxiv_metadata(
            ["2402.11111", "2403.22222"],
        )

        assert requested["url"] == reference_suggestions.ARXIV_API_URL
        assert requested["params"] == {"id_list": "2402.11111,2403.22222"}
        assert metadata == {
            "2402.11111": {"title": "Foo Paper", "abstract": "Foo abstract."},
            "2403.22222": {"title": "Bar Paper", "abstract": "Bar abstract."},
        }

    def test_empty_id_list_skips_the_request(self):
        assert reference_suggestions.fetch_arxiv_metadata([]) == {}


# =============================================================================
# Route
# =============================================================================

@dataclass
class SuggestionApiContext:
    client: TestClient
    session_factory: sessionmaker


@pytest.fixture
def suggestion_api(monkeypatch) -> SuggestionApiContext:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with session_factory() as db:
        reading_set = ReadingSet(id="set-1", name="Set set-1")
        reading_set.memberships = [
            ReadingSetPaper(reading_set_id="set-1", paper_id="member-a"),
            ReadingSetPaper(reading_set_id="set-1", paper_id="member-b"),
            ReadingSetPaper(reading_set_id="set-1", paper_id="member-c"),
        ]
        db.add_all([
            make_paper(
                "member-a",
                arxiv_id="2401.00001",
                citations=[
                    citation("r1", "Foo et al. arXiv:2402.11111v2."),
                    citation("r2", "Bar. arXiv:2403.22222."),
                    citation("r3", "Self cite arXiv:2401.00001v1."),
                ],
                metadata={"title": "Member A", "abstract": "About policy gradients."},
            ),
            make_paper(
                "member-b",
                citations=[citation("r1", "Foo again arXiv:2402.11111.")],
            ),
            make_paper("member-c"),  # no citations_data -> skipped
            # In the library (not a member), matched version-insensitively.
            make_paper("library-paper", arxiv_id="2403.22222v3"),
            reading_set,
        ])
        db.commit()

    monkeypatch.setattr(
        reference_suggestions,
        "fetch_arxiv_metadata",
        lambda ids: {
            "2402.11111": {"title": "Foo Paper", "abstract": "Foo abstract."},
            "2403.22222": {"title": "Bar Paper", "abstract": "Bar abstract."},
        },
    )
    monkeypatch.setattr(
        reference_suggestions,
        "_default_ranker",
        lambda member_summaries, candidates: [
            ReferenceRanking(arxiv_id="2402.11111", relevance="high", reason="Core method."),
            ReferenceRanking(arxiv_id="2403.22222", relevance="low", reason="Tangential."),
        ],
    )

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield SuggestionApiContext(client, session_factory)
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


class TestReferenceSuggestionsRoute:
    def test_response_shape_and_library_matching(self, suggestion_api):
        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )

        assert response.status_code == 200
        body = response.json()
        assert body["reading_set_id"] == "set-1"
        assert body["skipped_papers"] == [
            {"paper_id": "member-c", "reason": "no_citations"},
        ]
        assert [item["arxiv_id"] for item in body["suggestions"]] == [
            "2402.11111",
            "2403.22222",
        ]
        foo, bar = body["suggestions"]
        assert foo == {
            "arxiv_id": "2402.11111",
            "title": "Foo Paper",
            "abstract": "Foo abstract.",
            "relevance": "high",
            "reason": "Core method.",
            "cited_by_paper_ids": ["member-a", "member-b"],
            "library_paper_id": None,
            "in_reading_set": False,
        }
        assert bar["library_paper_id"] == "library-paper"
        assert bar["in_reading_set"] is False
        assert bar["relevance"] == "low"

    def test_member_paper_arxiv_ids_never_surface_as_suggestions(self, suggestion_api):
        # Once the matching library paper joins the set, its arXiv id belongs
        # to a member and the candidate is excluded from the suggestions.
        with suggestion_api.session_factory() as db:
            db.add(ReadingSetPaper(reading_set_id="set-1", paper_id="library-paper"))
            db.commit()

        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )

        assert response.status_code == 200
        assert [item["arxiv_id"] for item in response.json()["suggestions"]] == [
            "2402.11111",
        ]

    def test_in_reading_set_safety_flag_for_member_library_match(
        self, suggestion_api, monkeypatch,
    ):
        # The exclusion normally prevents this, but the field must stay correct
        # if a candidate slips through (e.g. membership changed mid-pipeline).
        with suggestion_api.session_factory() as db:
            db.add(ReadingSetPaper(reading_set_id="set-1", paper_id="library-paper"))
            db.commit()

        def stub_suggest_references(db_papers, max_candidates=25, **kwargs):
            return reference_suggestions.ReferenceSuggestionResult(
                suggestions=[
                    reference_suggestions.ReferenceCandidate(
                        arxiv_id="2403.22222",
                        cited_by_paper_ids=["member-a"],
                        title="Bar Paper",
                        abstract="Bar abstract.",
                        relevance="high",
                        reason="Core method.",
                    ),
                ],
                skipped_papers=[],
            )

        monkeypatch.setattr(
            reference_suggestions, "suggest_references", stub_suggest_references,
        )

        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )

        assert response.status_code == 200
        bar = response.json()["suggestions"][0]
        assert bar["library_paper_id"] == "library-paper"
        assert bar["in_reading_set"] is True

    def test_llm_failure_degrades_to_medium(self, suggestion_api, monkeypatch):
        def broken_ranker(member_summaries, candidates):
            raise RuntimeError("LLM unavailable")

        monkeypatch.setattr(reference_suggestions, "_default_ranker", broken_ranker)

        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )

        assert response.status_code == 200
        suggestions = response.json()["suggestions"]
        assert len(suggestions) == 2
        assert all(item["relevance"] == "medium" for item in suggestions)
        assert all(item["reason"] == "Ranking unavailable" for item in suggestions)

    def test_max_candidates_caps_suggestions(self, suggestion_api):
        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
            json={"max_candidates": 1},
        )

        assert response.status_code == 200
        suggestions = response.json()["suggestions"]
        # 2402.11111 is cited by two member papers, so the cap keeps it.
        assert [item["arxiv_id"] for item in suggestions] == ["2402.11111"]

    def test_max_candidates_out_of_bounds_is_422(self, suggestion_api):
        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
            json={"max_candidates": 51},
        )
        assert response.status_code == 422

    def test_unknown_field_is_rejected(self, suggestion_api):
        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
            json={"bogus": True},
        )
        assert response.status_code == 422

    def test_set_without_arxiv_references_returns_empty_list(self, suggestion_api):
        with suggestion_api.session_factory() as db:
            reading_set = ReadingSet(id="set-empty", name="Set set-empty")
            reading_set.memberships = [
                ReadingSetPaper(reading_set_id="set-empty", paper_id="member-c"),
            ]
            db.add(reading_set)
            db.commit()

        response = suggestion_api.client.post(
            "/api/reading-sets/set-empty/reference-suggestions",
        )

        assert response.status_code == 200
        assert response.json() == {
            "reading_set_id": "set-empty",
            "suggestions": [],
            "skipped_papers": [{"paper_id": "member-c", "reason": "no_citations"}],
        }

    def test_missing_set_is_404(self, suggestion_api):
        response = suggestion_api.client.post(
            "/api/reading-sets/missing/reference-suggestions",
        )
        assert response.status_code == 404


class TestReferenceSuggestionPersistence:
    """Runs are saved on the reading set and stay reviewable after import."""

    def test_run_is_persisted_on_the_reading_set(self, suggestion_api):
        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )
        assert response.status_code == 200

        with suggestion_api.session_factory() as db:
            stored = db.get(ReadingSet, "set-1").reference_suggestions
        assert stored["generated_at"]
        assert [entry["arxiv_id"] for entry in stored["suggestions"]] == [
            "2402.11111",
            "2403.22222",
        ]
        assert stored["suggestions"][0]["reason"] == "Core method."

    def test_imported_suggestion_stays_accessible_on_the_next_run(self, suggestion_api):
        first = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )
        assert first.status_code == 200

        # The user imports the suggested library paper into the set: its arXiv
        # id now belongs to a member, so it is no longer a fresh candidate.
        with suggestion_api.session_factory() as db:
            db.add(ReadingSetPaper(reading_set_id="set-1", paper_id="library-paper"))
            db.commit()

        second = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )

        assert second.status_code == 200
        suggestions = second.json()["suggestions"]
        assert [item["arxiv_id"] for item in suggestions] == [
            "2402.11111",
            "2403.22222",
        ]
        imported = suggestions[1]
        assert imported["in_reading_set"] is True
        assert imported["library_paper_id"] == "library-paper"
        # The stored ranking survives even though the candidate was not re-ranked.
        assert imported["relevance"] == "low"
        assert imported["reason"] == "Tangential."

    def test_retained_run_is_returned_without_fetch_or_llm_when_nothing_is_new(
        self, suggestion_api, monkeypatch,
    ):
        first = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )
        assert first.status_code == 200

        # Import both suggestions, leaving no referenced paper outside the set.
        with suggestion_api.session_factory() as db:
            db.add(make_paper("imported-foo", arxiv_id="2402.11111"))
            db.add(ReadingSetPaper(reading_set_id="set-1", paper_id="imported-foo"))
            db.add(ReadingSetPaper(reading_set_id="set-1", paper_id="library-paper"))
            db.commit()
        monkeypatch.setattr(
            reference_suggestions,
            "fetch_arxiv_metadata",
            lambda ids: pytest.fail("arXiv API must not be called"),
        )
        monkeypatch.setattr(reference_suggestions, "_default_ranker", fail_ranker)

        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )

        assert response.status_code == 200
        suggestions = response.json()["suggestions"]
        assert {item["arxiv_id"] for item in suggestions} == {
            "2402.11111",
            "2403.22222",
        }
        assert all(item["in_reading_set"] for item in suggestions)

    def test_fresh_candidates_replace_their_stored_entries(self, suggestion_api):
        with suggestion_api.session_factory() as db:
            reading_set = db.get(ReadingSet, "set-1")
            reading_set.reference_suggestions = {
                "generated_at": "2026-01-01T00:00:00",
                "suggestions": [
                    {
                        "arxiv_id": "2402.11111",
                        "title": "Stale Title",
                        "abstract": "Stale abstract.",
                        "relevance": "low",
                        "reason": "Stale reason.",
                        "cited_by_paper_ids": ["member-a"],
                    },
                ],
            }
            db.commit()

        response = suggestion_api.client.post(
            "/api/reading-sets/set-1/reference-suggestions",
        )

        assert response.status_code == 200
        foo = response.json()["suggestions"][0]
        assert foo["arxiv_id"] == "2402.11111"
        assert foo["title"] == "Foo Paper"
        assert foo["relevance"] == "high"
        assert foo["reason"] == "Core method."
