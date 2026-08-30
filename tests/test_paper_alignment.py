"""Tests for the reading-set term alignment engine and its routes."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.agents.paper_alignment import (
    AlignmentVerdict,
    PaperAlignmentCancelledError,
    build_alignments_for_reading_set,
    normalize_term,
)
from backend.app.api import reading_set_routes
from backend.app.api.main import app
from backend.app.database.connection import get_db
from backend.app.database.models import (
    Base,
    EntityAlignment,
    Paper,
    ReadingSet,
    ReadingSetPaper,
)


def kg_document(objects=None, notation=None, explanations=None) -> dict:
    """Minimal raw KG payload: only the fields the alignment loader reads."""
    return {
        "schema_version": "3.0",
        "objects": objects or [],
        "notation": notation or [],
        "explanations": explanations or [],
    }


def kg_object(stable_id: str, label: str, kind: str = "topic", aliases=None) -> dict:
    return {"stable_id": stable_id, "label": label, "kind": kind, "aliases": aliases or []}


@dataclass
class AlignmentContext:
    client: TestClient
    session_factory: sessionmaker

    def alignments(self, reading_set_id: str = "set-1") -> list[EntityAlignment]:
        with self.session_factory() as db:
            return (
                db.query(EntityAlignment)
                .filter(EntityAlignment.reading_set_id == reading_set_id)
                .order_by(EntityAlignment.label_a)
                .all()
            )

    def set_status(self, alignment_id: str, status: str) -> None:
        with self.session_factory() as db:
            db.get(EntityAlignment, alignment_id).status = status
            db.commit()


@pytest.fixture
def alignment_context(monkeypatch) -> AlignmentContext:
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
                filename="a.tar.gz",
                knowledge_graph=kg_document(objects=[
                    kg_object("a-policy", "Policy Improvement", kind="procedure"),
                    kg_object("a-value", "Value Function"),
                ]),
            ),
            Paper(
                id="paper-b",
                filename="b.tar.gz",
                knowledge_graph=kg_document(objects=[
                    kg_object("b-policy", "policy improvements", kind="procedure"),
                    kg_object("b-value", "Value Function"),
                ]),
            ),
            Paper(id="paper-c", filename="c.tar.gz"),  # no knowledge graph
            db_reading_set("set-1", ["paper-a", "paper-b"]),
        ])
        db.commit()

    monkeypatch.setattr(reading_set_routes, "alignment_session_factory", session_factory)
    reading_set_routes.alignment_build_progress.clear()
    reading_set_routes.alignment_cancel_flags.clear()

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield AlignmentContext(client, session_factory)
    app.dependency_overrides.clear()
    reading_set_routes.alignment_build_progress.clear()
    reading_set_routes.alignment_cancel_flags.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def db_reading_set(reading_set_id: str, paper_ids: list[str]) -> ReadingSet:
    reading_set = ReadingSet(id=reading_set_id, name=f"Set {reading_set_id}")
    reading_set.memberships = [
        ReadingSetPaper(reading_set_id=reading_set_id, paper_id=paper_id)
        for paper_id in paper_ids
    ]
    return reading_set


def fail_adjudicator(pairs):
    raise AssertionError(f"LLM adjudicator must not be called, got {len(pairs)} pairs")


def build(context: AlignmentContext, reading_set_id: str = "set-1", **kwargs) -> dict:
    kwargs.setdefault("adjudicator", fail_adjudicator)
    return build_alignments_for_reading_set(
        reading_set_id,
        session_factory=context.session_factory,
        **kwargs,
    )


class TestNormalization:
    def test_normalize_term_folds_case_punctuation_and_plural(self):
        assert normalize_term("Policy-Improvement steps!") == "policy improvement step"
        assert normalize_term("Q-function") == normalize_term("q function")

    def test_short_and_ss_words_are_not_singularized(self):
        assert normalize_term("loss") == "loss"
        assert normalize_term("gas") == "gas"


class TestDeterministicAlignment:
    def test_unique_label_matches_persist_without_llm(self, alignment_context):
        summary = build(alignment_context)

        assert summary["deterministic_count"] == 2
        assert summary["llm_count"] == 0
        rows = alignment_context.alignments()
        assert {(row.subject_a_id, row.subject_b_id) for row in rows} == {
            ("a-policy", "b-policy"),
            ("a-value", "b-value"),
        }
        assert all(row.method == "deterministic" for row in rows)
        assert all(row.confidence == "high" for row in rows)
        assert all(row.status == "auto" for row in rows)

    def test_pairs_are_stored_in_canonical_orientation(self, alignment_context):
        build(alignment_context)

        for row in alignment_context.alignments():
            assert row.paper_a_id < row.paper_b_id
            assert (row.paper_a_id, row.paper_b_id) == ("paper-a", "paper-b")

    def test_denormalized_labels_come_from_each_paper(self, alignment_context):
        build(alignment_context)

        policy = next(
            row for row in alignment_context.alignments() if row.subject_a_id == "a-policy"
        )
        assert policy.label_a == "Policy Improvement"
        assert policy.label_b == "policy improvements"

    def test_single_paper_set_completes_empty(self, alignment_context):
        with alignment_context.session_factory() as db:
            db.add(db_reading_set("set-solo", ["paper-a"]))
            db.commit()

        summary = build(alignment_context, "set-solo")

        assert summary["alignment_count"] == 0
        assert alignment_context.alignments("set-solo") == []

    def test_paper_without_kg_is_skipped_with_warning(self, alignment_context):
        with alignment_context.session_factory() as db:
            db.add(ReadingSetPaper(reading_set_id="set-1", paper_id="paper-c"))
            db.commit()

        summary = build(alignment_context)

        assert summary["skipped_papers"] == [
            {"paper_id": "paper-c", "filename": "c.tar.gz", "reason": "no_knowledge_graph"},
        ]
        assert summary["deterministic_count"] == 2


class TestLlmAdjudication:
    def prepare_ambiguous(self, context: AlignmentContext) -> None:
        """Paper B offers two candidates for A's "Q-function"."""
        with context.session_factory() as db:
            db.get(Paper, "paper-a").knowledge_graph = kg_document(objects=[
                kg_object("a-q", "Q-function"),
            ])
            db.get(Paper, "paper-b").knowledge_graph = kg_document(objects=[
                kg_object("b-q", "Q-function"),
                kg_object("b-av", "action-value function", aliases=["Q-function"]),
            ])
            db.commit()

    def test_ambiguous_bucket_goes_to_the_adjudicator(self, alignment_context):
        self.prepare_ambiguous(alignment_context)
        calls: list[list] = []

        def adjudicator(pairs):
            calls.append(pairs)
            return [
                AlignmentVerdict(
                    subject_a_id="a-q",
                    subject_b_id="b-q",
                    same=True,
                    confidence="medium",
                    rationale="Both denote the state-action value function.",
                ),
                AlignmentVerdict(
                    subject_a_id="a-q",
                    subject_b_id="b-av",
                    same=False,
                    confidence="low",
                    rationale="Alias overlap only.",
                ),
            ]

        summary = build(alignment_context, adjudicator=adjudicator)

        assert len(calls) == 1
        assert {(a.subject_id, b.subject_id) for a, b in calls[0]} == {
            ("a-q", "b-q"),
            ("a-q", "b-av"),
        }
        assert summary["llm_count"] == 1
        rows = alignment_context.alignments()
        assert len(rows) == 1
        assert rows[0].method == "llm"
        assert rows[0].confidence == "medium"
        assert rows[0].rationale == "Both denote the state-action value function."

    def test_verdicts_for_unknown_pairs_are_ignored(self, alignment_context):
        self.prepare_ambiguous(alignment_context)

        def adjudicator(pairs):
            return [
                AlignmentVerdict(
                    subject_a_id="a-q",
                    subject_b_id="not-a-candidate",
                    same=True,
                    confidence="high",
                    rationale="Hallucinated pair.",
                ),
            ]

        summary = build(alignment_context, adjudicator=adjudicator)

        assert summary["llm_count"] == 0
        assert alignment_context.alignments() == []


class TestRebuildSemantics:
    def test_rebuild_replaces_auto_rows(self, alignment_context):
        build(alignment_context)
        first_ids = {row.id for row in alignment_context.alignments()}

        build(alignment_context)

        rows = alignment_context.alignments()
        assert len(rows) == 2
        assert {row.id for row in rows}.isdisjoint(first_ids)
        assert all(row.status == "auto" for row in rows)

    def test_rebuild_preserves_confirmed_and_rejected_rows(self, alignment_context):
        build(alignment_context)
        rows = alignment_context.alignments()
        confirmed = next(row for row in rows if row.subject_a_id == "a-policy")
        rejected = next(row for row in rows if row.subject_a_id == "a-value")
        alignment_context.set_status(confirmed.id, "confirmed")
        alignment_context.set_status(rejected.id, "rejected")

        build(alignment_context)

        rows = {row.subject_a_id: row for row in alignment_context.alignments()}
        assert rows["a-policy"].id == confirmed.id
        assert rows["a-policy"].status == "confirmed"
        assert rows["a-value"].id == rejected.id
        assert rows["a-value"].status == "rejected"
        assert len(rows) == 2

    def test_vanished_subjects_mark_kept_rows_stale(self, alignment_context):
        build(alignment_context)
        confirmed = next(
            row for row in alignment_context.alignments() if row.subject_a_id == "a-policy"
        )
        alignment_context.set_status(confirmed.id, "confirmed")

        with alignment_context.session_factory() as db:
            db.get(Paper, "paper-b").knowledge_graph = kg_document(objects=[
                kg_object("b-value", "Value Function"),
            ])
            db.commit()

        summary = build(alignment_context)

        assert summary["stale_count"] == 1
        rows = {row.subject_a_id: row for row in alignment_context.alignments()}
        assert rows["a-policy"].id == confirmed.id
        assert rows["a-policy"].status == "stale"
        assert rows["a-value"].status == "auto"


class TestCancellation:
    def test_cancel_before_persist_leaves_no_rows(self, alignment_context):
        cancelled_stages: list[str] = []

        def cancel_check() -> bool:
            return bool(cancelled_stages)

        def progress_callback(stage: str, current: int, total: int) -> None:
            if stage == "blocking":
                cancelled_stages.append(stage)

        with pytest.raises(PaperAlignmentCancelledError):
            build(
                alignment_context,
                progress_callback=progress_callback,
                cancel_check=cancel_check,
            )

        assert alignment_context.alignments() == []

    def test_progress_reports_every_stage(self, alignment_context):
        stages: list[str] = []

        build(alignment_context, progress_callback=lambda stage, *_: stages.append(stage))

        assert [stage for index, stage in enumerate(stages) if stage not in stages[:index]] == [
            "load_documents",
            "build_profiles",
            "blocking",
            "adjudication",
            "persist",
        ]


class TestAlignmentRoutes:
    def test_build_endpoint_runs_task_to_completion(self, alignment_context):
        response = alignment_context.client.post("/api/reading-sets/set-1/alignments/build")

        assert response.status_code == 202
        # TestClient runs the background task synchronously after the response.
        progress = reading_set_routes.alignment_build_progress["set-1"]
        assert progress["stage"] == "complete"
        assert progress["deterministic_count"] == 2
        assert len(alignment_context.alignments()) == 2

    def test_build_endpoint_for_missing_set_is_404(self, alignment_context):
        response = alignment_context.client.post("/api/reading-sets/missing/alignments/build")
        assert response.status_code == 404

    def test_build_conflict_while_running(self, alignment_context):
        reading_set_routes.alignment_build_progress["set-1"] = {"stage": "linking"}
        response = alignment_context.client.post("/api/reading-sets/set-1/alignments/build")
        assert response.status_code == 409

    def test_cancel_without_running_build_is_409(self, alignment_context):
        response = alignment_context.client.post(
            "/api/reading-sets/set-1/alignments/build/cancel",
        )
        assert response.status_code == 409

    def test_cancel_sets_the_cooperative_flag(self, alignment_context):
        reading_set_routes.alignment_build_progress["set-1"] = {"stage": "linking"}
        response = alignment_context.client.post(
            "/api/reading-sets/set-1/alignments/build/cancel",
        )
        assert response.status_code == 200
        assert reading_set_routes.alignment_cancel_flags["set-1"] is True

    def test_list_alignments_with_filters(self, alignment_context):
        build(alignment_context)

        listed = alignment_context.client.get("/api/reading-sets/set-1/alignments").json()
        assert len(listed) == 2

        by_subject = alignment_context.client.get(
            "/api/reading-sets/set-1/alignments",
            params={"subject_id": "b-policy"},
        ).json()
        assert [item["subject_a_id"] for item in by_subject] == ["a-policy"]

        by_paper = alignment_context.client.get(
            "/api/reading-sets/set-1/alignments",
            params={"paper_id": "paper-a"},
        ).json()
        assert len(by_paper) == 2

    def test_confirm_and_reject_update_status(self, alignment_context):
        build(alignment_context)
        alignment_id = alignment_context.alignments()[0].id

        confirmed = alignment_context.client.post(
            f"/api/reading-sets/set-1/alignments/{alignment_id}/confirm",
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "confirmed"

        rejected = alignment_context.client.post(
            f"/api/reading-sets/set-1/alignments/{alignment_id}/reject",
        )
        assert rejected.status_code == 200
        assert rejected.json()["status"] == "rejected"

    def test_confirm_missing_alignment_is_404(self, alignment_context):
        response = alignment_context.client.post(
            "/api/reading-sets/set-1/alignments/missing/confirm",
        )
        assert response.status_code == 404

    def test_removing_paper_from_set_deletes_its_alignments(self, alignment_context):
        build(alignment_context)

        response = alignment_context.client.delete(
            "/api/reading-sets/set-1/papers/paper-b",
        )
        assert response.status_code == 200
        assert alignment_context.alignments() == []
