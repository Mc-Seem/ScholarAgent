"""Tests for reading-set chat: multi-paper retrieval, routes, and scope constraint."""

from __future__ import annotations

import importlib
import io
import json
from dataclasses import dataclass
from math import ceil

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api.main import app
from backend.app.api import chat_routes
from backend.app.agents.chat_agent import (
    DefinitionProposal,
    GroundedChatResult,
    GroundedCitation,
)
from backend.app.agents.chat_retrieval import (
    ALIGNMENT_EVIDENCE_LIMIT,
    PASSAGE_LIMIT,
    TOTAL_EVIDENCE_LIMIT,
    build_multi_paper_corpus,
    retrieve_reading_set_evidence,
)
from backend.app.database.connection import get_db
from backend.app.database.models import (
    Base,
    ChatAction,
    ChatConversation,
    ChatMessage,
    EntityAlignment,
    Paper,
    ReadingSet,
    ReadingSetPaper,
    User,
)


def paper_html(prefix: str, texts: list[str]) -> str:
    return "<article>" + "".join(
        f'<p data-id="{prefix}-p{index}">{text}</p>'
        for index, text in enumerate(texts, start=1)
    ) + "</article>"


def make_papers() -> list[dict]:
    return [
        {
            "id": "paper-one",
            "title": "First Paper",
            "html_content": paper_html("one", [
                "The policy gradient estimator uses the advantage function.",
                "Baselines reduce the variance of the policy gradient.",
                "We evaluate the estimator on control benchmarks.",
                "The advantage function compares actions to a baseline.",
                "Entropy regularization stabilizes the policy gradient updates.",
                "Trust regions constrain each policy update step.",
            ]),
            "sections_data": None,
        },
        {
            "id": "paper-two",
            "title": "Second Paper",
            "html_content": paper_html("two", [
                "The critic estimates the value function for the actor.",
                "Actor-critic methods use the policy gradient with a learned critic.",
                "Replay buffers decorrelate the critic's training samples.",
                "Target networks stabilize the value function estimates.",
                "The actor maximizes the critic's estimated returns.",
                "Soft updates interpolate the target network weights.",
            ]),
            "sections_data": None,
        },
    ]


def make_alignments() -> list[dict]:
    return [
        {
            "id": "al-1",
            "status": "auto",
            "paper_a_id": "paper-one",
            "subject_a_id": "concept:advantage",
            "label_a": "advantage function",
            "paper_b_id": "paper-two",
            "subject_b_id": "concept:critic",
            "label_b": "critic estimate",
            "confidence": "high",
            "rationale": "Both estimate how much better an action is.",
        },
        {
            "id": "al-2",
            "status": "confirmed",
            "paper_a_id": "paper-one",
            "subject_a_id": "concept:baseline",
            "label_a": "baseline",
            "paper_b_id": "paper-two",
            "subject_b_id": "concept:value",
            "label_b": "value function",
            "confidence": "medium",
            "rationale": None,
        },
        {
            "id": "al-3",
            "status": "rejected",
            "paper_a_id": "paper-one",
            "subject_a_id": "concept:entropy",
            "label_a": "entropy bonus",
            "paper_b_id": "paper-two",
            "subject_b_id": "concept:replay",
            "label_b": "replay buffer",
            "confidence": "low",
            "rationale": "Unrelated concepts.",
        },
        {
            "id": "al-4",
            "status": "stale",
            "paper_a_id": "paper-one",
            "subject_a_id": "concept:trust",
            "label_a": "trust region",
            "paper_b_id": "paper-two",
            "subject_b_id": "concept:target",
            "label_b": "target network",
            "confidence": "high",
            "rationale": None,
        },
    ]


class TestMultiPaperRetrieval:
    def test_corpus_is_built_per_paper_and_empty_without_html(self):
        papers = [*make_papers(), {
            "id": "paper-three",
            "title": "Compiled Nowhere",
            "html_content": None,
            "sections_data": None,
        }]

        corpora = build_multi_paper_corpus(papers)

        assert [item.paper_id for item in corpora] == ["paper-one", "paper-two", "paper-three"]
        assert [item.title for item in corpora] == ["First Paper", "Second Paper", "Compiled Nowhere"]
        assert all(item.corpus for item in corpora[:2])
        assert corpora[2].corpus == []

    def test_evidence_carries_paper_ids_and_prefixed_handles(self):
        corpora = build_multi_paper_corpus(make_papers())

        result = retrieve_reading_set_evidence("policy gradient", corpora)

        passages = [item for item in result.evidence if item.kind == "passage"]
        assert passages
        assert {item.paper_id for item in passages} == {"paper-one", "paper-two"}
        assert all(
            item.handle == f"paper:{item.paper_id}:passage:{item.source_id}"
            for item in passages
        )
        assert len(result.evidence) <= TOTAL_EVIDENCE_LIMIT
        assert result.graph_available is False
        assert result.used_graph is False

    def test_each_paper_stays_within_its_passage_budget(self):
        corpora = build_multi_paper_corpus(make_papers())
        per_paper_budget = ceil(PASSAGE_LIMIT / len(corpora)) + 1

        result = retrieve_reading_set_evidence("policy gradient", corpora)

        for paper_id in ("paper-one", "paper-two"):
            count = sum(
                1 for item in result.evidence
                if item.kind == "passage" and item.paper_id == paper_id
            )
            assert 0 < count <= per_paper_budget

    def test_alignment_evidence_included_and_inactive_excluded(self):
        corpora = build_multi_paper_corpus(make_papers())

        result = retrieve_reading_set_evidence(
            "advantage function",
            corpora,
            alignments=make_alignments(),
        )

        alignment_records = [item for item in result.evidence if item.kind == "alignment"]
        assert [item.handle for item in alignment_records] == ["alignment:al-1", "alignment:al-2"]
        assert len(alignment_records) <= ALIGNMENT_EVIDENCE_LIMIT
        first = alignment_records[0]
        assert "First Paper's 'advantage function'" in first.text
        assert "Second Paper's 'critic estimate'" in first.text
        assert "high confidence" in first.text
        assert "Both estimate how much better an action is." in first.text

    def test_papers_without_content_are_skipped_without_errors(self):
        corpora = build_multi_paper_corpus([
            {"id": "paper-three", "title": "Empty", "html_content": None, "sections_data": None},
            *make_papers(),
        ])

        result = retrieve_reading_set_evidence(
            "policy gradient",
            corpora,
            alignments=make_alignments(),
        )

        assert {item.paper_id for item in result.evidence if item.kind == "passage"} == {
            "paper-one",
            "paper-two",
        }

        empty = retrieve_reading_set_evidence("anything", build_multi_paper_corpus([
            {"id": "paper-three", "title": "Empty", "html_content": None, "sections_data": None},
        ]))
        assert empty.evidence == []

    def test_selection_context_anchors_quote_in_the_right_paper(self):
        corpora = build_multi_paper_corpus(make_papers())

        result = retrieve_reading_set_evidence(
            "critic",
            corpora,
            context={
                "kind": "selection",
                "paper_id": "paper-two",
                "data_id": "two-p2",
                "quote": "policy gradient with a learned critic",
            },
        )

        first = result.evidence[0]
        assert first.paper_id == "paper-two"
        assert first.source_id == "two-p2"
        assert first.text == "policy gradient with a learned critic"


class TestReadingSetChatMigration:
    def test_migration_renders_scope_changes_and_downgrade(self):
        migration = importlib.import_module(
            "backend.alembic.versions.013_add_reading_set_chat_scope"
        )
        output = io.StringIO()
        context = MigrationContext.configure(
            url="postgresql://",
            opts={"as_sql": True, "output_buffer": output},
        )

        with Operations.context(context):
            migration.upgrade()
            migration.downgrade()

        sql = output.getvalue()
        assert "ADD COLUMN reading_set_id" in sql
        assert "fk_chat_conversation_reading_set" in sql
        assert "ck_chat_conversation_scope" in sql
        assert "idx_chat_conversation_reading_set_user" in sql
        assert "DELETE FROM chat_conversations WHERE paper_id IS NULL" in sql
        assert "DROP COLUMN reading_set_id" in sql


@dataclass
class SetChatApiContext:
    client: TestClient
    session_factory: sessionmaker


@pytest.fixture
def set_chat_api() -> SetChatApiContext:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    papers = make_papers()
    with session_factory() as db:
        db.add(User(id=1))
        db.add_all([
            Paper(
                id=paper["id"],
                filename=f"{paper['id']}.tar.gz",
                html_content=paper["html_content"],
                paper_metadata={"title": paper["title"]},
            )
            for paper in papers
        ])
        db.add(Paper(id="paper-three", filename="three.tar.gz"))
        db.add(ReadingSet(id="set-1", name="RL Survey"))
        db.flush()
        db.add_all([
            ReadingSetPaper(reading_set_id="set-1", paper_id="paper-one"),
            ReadingSetPaper(reading_set_id="set-1", paper_id="paper-two"),
            ReadingSetPaper(reading_set_id="set-1", paper_id="paper-three"),
        ])
        db.add_all([
            EntityAlignment(
                id=alignment["id"],
                reading_set_id="set-1",
                paper_a_id=alignment["paper_a_id"],
                subject_a_id=alignment["subject_a_id"],
                label_a=alignment["label_a"],
                paper_b_id=alignment["paper_b_id"],
                subject_b_id=alignment["subject_b_id"],
                label_b=alignment["label_b"],
                method="deterministic",
                score=0.9,
                confidence=alignment["confidence"],
                status=alignment["status"],
                rationale=alignment["rationale"],
            )
            for alignment in make_alignments()
        ])
        db.commit()

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield SetChatApiContext(client, session_factory)
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def create_set_conversation(context: SetChatApiContext, title: str = "Set discussion") -> dict:
    response = context.client.post(
        "/api/reading-sets/set-1/chat/conversations",
        json={"title": title},
    )
    assert response.status_code == 201
    return response.json()


def parse_sse(response) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    event_name = "message"
    for line in response.iter_lines():
        if line.startswith("event: "):
            event_name = line.removeprefix("event: ")
        elif line.startswith("data: "):
            events.append((event_name, json.loads(line.removeprefix("data: "))))
    return events


class TestReadingSetConversationApi:
    def test_crud_is_reading_set_scoped(self, set_chat_api):
        conversation = create_set_conversation(set_chat_api, "  Cross-paper questions  ")
        conversation_id = conversation["id"]
        assert conversation["title"] == "Cross-paper questions"
        assert conversation["reading_set_id"] == "set-1"
        assert conversation["paper_id"] is None

        listed = set_chat_api.client.get("/api/reading-sets/set-1/chat/conversations")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()] == [conversation_id]

        renamed = set_chat_api.client.patch(
            f"/api/reading-sets/set-1/chat/conversations/{conversation_id}",
            json={"title": "Renamed"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["title"] == "Renamed"

        wrong_set = set_chat_api.client.get(
            f"/api/reading-sets/missing/chat/conversations/{conversation_id}/messages",
        )
        assert wrong_set.status_code == 404

        not_paper_scoped = set_chat_api.client.get(
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
        )
        assert not_paper_scoped.status_code == 404

        deleted = set_chat_api.client.delete(
            f"/api/reading-sets/set-1/chat/conversations/{conversation_id}",
        )
        assert deleted.status_code == 204
        with set_chat_api.session_factory() as db:
            assert db.query(ChatConversation).count() == 0

    def test_missing_set_and_blank_titles_are_rejected(self, set_chat_api):
        missing = set_chat_api.client.post(
            "/api/reading-sets/missing/chat/conversations",
            json={"title": "Discussion"},
        )
        blank = set_chat_api.client.post(
            "/api/reading-sets/set-1/chat/conversations",
            json={"title": "   "},
        )

        assert missing.status_code == 404
        assert blank.status_code == 422

    def test_deleting_reading_set_cascades_conversations(self, set_chat_api):
        conversation_id = create_set_conversation(set_chat_api)["id"]
        with set_chat_api.session_factory() as db:
            db.add(ChatMessage(
                conversation_id=conversation_id,
                role="user",
                content="Question",
                citations=[],
            ))
            db.commit()

        deleted = set_chat_api.client.delete("/api/reading-sets/set-1")

        assert deleted.status_code == 204
        with set_chat_api.session_factory() as db:
            assert db.query(ChatConversation).count() == 0
            assert db.query(ChatMessage).count() == 0

    def test_scope_check_constraint_requires_exactly_one_scope(self, set_chat_api):
        with set_chat_api.session_factory() as db:
            db.add(ChatConversation(
                paper_id="paper-one",
                reading_set_id="set-1",
                user_id=1,
                title="Both scopes",
            ))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()

        with set_chat_api.session_factory() as db:
            db.add(ChatConversation(user_id=1, title="No scope"))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()


class TestReadingSetChatStream:
    def test_stream_passes_set_snapshot_and_persists_paper_scoped_citations(
        self,
        set_chat_api,
        monkeypatch,
    ):
        conversation_id = create_set_conversation(set_chat_api)["id"]
        captured = {}

        def grounded(**kwargs):
            captured.update(kwargs)
            return GroundedChatResult(
                content="First Paper introduces the estimator.",
                citations=[GroundedCitation(
                    kind="quote",
                    label="First Paper — estimator",
                    source_id="one-p1",
                    quote="policy gradient estimator",
                    paper_id="paper-one",
                )],
                graph_available=False,
                used_graph=False,
            )

        monkeypatch.setattr(chat_routes, "run_reading_set_chat_agent", grounded)
        with set_chat_api.client.stream(
            "POST",
            f"/api/reading-sets/set-1/chat/conversations/{conversation_id}/messages",
            json={"content": "How is the estimator defined?"},
        ) as response:
            assert response.status_code == 200
            events = parse_sse(response)

        assert [name for name, _ in events] == ["status", "status", "final"]
        final = events[-1][1]
        assert final["message"]["role"] == "assistant"
        assert final["citations"] == [{
            "kind": "quote",
            "label": "First Paper — estimator",
            "source_id": "one-p1",
            "section_id": None,
            "subject_id": None,
            "quote": "policy gradient estimator",
            "paper_id": "paper-one",
        }]
        assert final["pending_action"] is None

        papers_by_id = {paper["id"]: paper for paper in captured["papers"]}
        assert set(papers_by_id) == {"paper-one", "paper-two", "paper-three"}
        assert papers_by_id["paper-one"]["title"] == "First Paper"
        assert papers_by_id["paper-three"]["html_content"] is None
        assert {alignment["status"] for alignment in captured["alignments"]} == {"auto", "confirmed"}

        history = set_chat_api.client.get(
            f"/api/reading-sets/set-1/chat/conversations/{conversation_id}/messages",
        ).json()
        assert [message["role"] for message in history] == ["user", "assistant"]
        assert history[1]["citations"][0]["paper_id"] == "paper-one"

    def test_definition_proposals_are_disabled_in_set_scope(self, set_chat_api, monkeypatch):
        conversation_id = create_set_conversation(set_chat_api)["id"]
        monkeypatch.setattr(
            chat_routes,
            "run_reading_set_chat_agent",
            lambda **_kwargs: GroundedChatResult(
                content="A definition rewrite is not available here.",
                citations=[],
                graph_available=False,
                used_graph=False,
                definition_proposal=DefinitionProposal(
                    subject_id="concept:advantage",
                    target_text="advantage function",
                    base_definition="Old definition",
                    proposed_definition="New definition",
                    knowledge_graph_version="version",
                ),
            ),
        )

        with set_chat_api.client.stream(
            "POST",
            f"/api/reading-sets/set-1/chat/conversations/{conversation_id}/messages",
            json={"content": "Rewrite the advantage definition."},
        ) as response:
            events = parse_sse(response)

        final = events[-1][1]
        assert final["pending_action"] is None
        assert final["message"]["pending_action"] is None
        with set_chat_api.session_factory() as db:
            assert db.query(ChatAction).count() == 0

    def test_stream_emits_sanitized_error_and_keeps_user_message(
        self,
        set_chat_api,
        monkeypatch,
    ):
        conversation_id = create_set_conversation(set_chat_api)["id"]
        monkeypatch.setattr(
            chat_routes,
            "run_reading_set_chat_agent",
            lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("provider secret")),
        )

        with set_chat_api.client.stream(
            "POST",
            f"/api/reading-sets/set-1/chat/conversations/{conversation_id}/messages",
            json={"content": "Persist this question"},
        ) as response:
            events = parse_sse(response)

        assert [name for name, _ in events] == ["status", "status", "error"]
        assert events[-1][1] == {
            "type": "error",
            "message": "The chat response could not be generated.",
        }
        history = set_chat_api.client.get(
            f"/api/reading-sets/set-1/chat/conversations/{conversation_id}/messages",
        ).json()
        assert [(message["role"], message["content"]) for message in history] == [
            ("user", "Persist this question"),
        ]
