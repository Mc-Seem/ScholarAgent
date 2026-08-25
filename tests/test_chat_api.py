"""Tests for paper-scoped chat persistence and API contracts."""

from __future__ import annotations

import asyncio
import importlib
import io
import json
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api.main import app
from backend.app.api import chat_routes
from backend.app.agents.chat_agent import (
    DefinitionProposal,
    GroundedChatResult,
    GroundedCitation,
)
from backend.app.agents.chat_retrieval import knowledge_document_version
from backend.app.agents.knowledge_graph_retrieval import build_fixture_document
from backend.app.agents.knowledge_graph_models import SemanticExplanation
from backend.app.database.connection import get_db
from backend.app.database.models import (
    Base,
    ChatAction,
    ChatConversation,
    ChatMessage,
    Paper,
    Tooltip,
    User,
)


@dataclass
class ChatApiContext:
    client: TestClient
    session_factory: sessionmaker


@pytest.fixture
def chat_api() -> ChatApiContext:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with session_factory() as db:
        db.add(User(id=1))
        db.add_all([
            Paper(id="paper-one", filename="one.tar.gz"),
            Paper(id="paper-two", filename="two.tar.gz"),
        ])
        db.commit()

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield ChatApiContext(client, session_factory)
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def create_conversation(context: ChatApiContext, title: str = "Discussion") -> dict:
    response = context.client.post(
        "/api/papers/paper-one/chat/conversations",
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


def install_semantic_document(context: ChatApiContext):
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "knowledge_graph_baseline.json").read_text(
            encoding="utf-8",
        )
    )
    document = build_fixture_document(fixture)
    document = document.model_copy(update={
        "explanations": [SemanticExplanation(
            stable_id="explanation:quantity:elbo",
            subject_id="quantity:elbo",
            base_content="A lower bound on the log evidence.",
            expertise="intermediate",
            evidence_ids=[document.objects[0].observation_ids[0]],
        )],
    })
    with context.session_factory() as db:
        paper = db.get(Paper, "paper-one")
        paper.knowledge_graph = document.model_dump(mode="json")
        paper.html_content = "<article>" + "".join(
            f'<p data-id="{item["id"]}">{item["text"]}</p>'
            for item in fixture["retrieval_corpus"]
        ) + "</article>"
        db.commit()
    return document


def seed_action(
    context: ChatApiContext,
    document,
    *,
    base_definition: str = "A lower bound on the log evidence.",
    status: str = "pending",
) -> int:
    conversation_id = create_conversation(context)["id"]
    with context.session_factory() as db:
        message = ChatMessage(
            conversation_id=conversation_id,
            role="assistant",
            content="Definition preview.",
        )
        db.add(message)
        db.flush()
        action = ChatAction(
            source_message_id=message.id,
            subject_id="quantity:elbo",
            base_definition=base_definition,
            proposed_definition="A user-friendly grounded definition.",
            knowledge_graph_version=knowledge_document_version(document),
            status=status,
        )
        db.add(action)
        db.commit()
        return action.id


class TestChatModelsAndMigration:
    def test_schema_has_required_foreign_keys_cascades_and_indexes(self):
        conversation_fks = {fk.target_fullname: fk.ondelete for fk in ChatConversation.__table__.foreign_keys}
        message_fks = {fk.target_fullname: fk.ondelete for fk in ChatMessage.__table__.foreign_keys}
        action_fks = {fk.target_fullname: fk.ondelete for fk in ChatAction.__table__.foreign_keys}

        assert conversation_fks == {"papers.id": "CASCADE", "users.id": "CASCADE"}
        assert message_fks == {"chat_conversations.id": "CASCADE"}
        assert action_fks == {"chat_messages.id": "CASCADE"}
        assert "knowledge_graph_version" in ChatAction.__table__.columns
        assert {index.name for index in ChatConversation.__table__.indexes} >= {
            "idx_chat_conversation_paper_user",
        }
        assert {index.name for index in ChatMessage.__table__.indexes} >= {
            "idx_chat_message_conversation_id",
        }

    def test_migration_renders_create_and_drop_sql(self):
        migration = importlib.import_module("backend.alembic.versions.008_create_chat_tables")
        output = io.StringIO()
        context = MigrationContext.configure(
            url="postgresql://",
            opts={"as_sql": True, "output_buffer": output},
        )

        with Operations.context(context):
            migration.upgrade()
            migration.downgrade()

        sql = output.getvalue()
        assert "CREATE TABLE users" in sql
        assert "CREATE TABLE chat_conversations" in sql
        assert "CREATE TABLE chat_messages" in sql
        assert "CREATE TABLE chat_actions" in sql
        assert "idx_chat_conversation_paper_user" in sql
        assert "idx_chat_message_conversation_id" in sql
        assert "DROP TABLE chat_conversations" in sql

    def test_graph_version_migration_renders_add_and_drop_column(self):
        migration = importlib.import_module(
            "backend.alembic.versions.009_add_chat_action_graph_version"
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
        assert "ADD COLUMN knowledge_graph_version" in sql
        assert "DROP COLUMN knowledge_graph_version" in sql


class TestChatConversationApi:
    def test_crud_is_paper_scoped_and_history_is_ordered(self, chat_api):
        conversation = create_conversation(chat_api, "  First discussion  ")
        conversation_id = conversation["id"]
        assert conversation["title"] == "First discussion"
        assert conversation["paper_id"] == "paper-one"

        listed = chat_api.client.get("/api/papers/paper-one/chat/conversations")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()] == [conversation_id]

        renamed = chat_api.client.patch(
            f"/api/papers/paper-one/chat/conversations/{conversation_id}",
            json={"title": "Renamed"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["title"] == "Renamed"

        wrong_paper = chat_api.client.get(
            f"/api/papers/paper-two/chat/conversations/{conversation_id}/messages",
        )
        assert wrong_paper.status_code == 404

        with chat_api.session_factory() as db:
            assistant = ChatMessage(
                conversation_id=conversation_id,
                role="assistant",
                content="second",
            )
            db.add_all([
                assistant,
                ChatMessage(conversation_id=conversation_id, role="user", content="first"),
            ])
            db.flush()
            db.add(ChatAction(
                source_message_id=assistant.id,
                subject_id="subject-1",
                base_definition="Old definition",
                proposed_definition="New definition",
                status="pending",
            ))
            db.commit()
            expected_ids = [
                row.id
                for row in db.query(ChatMessage)
                .filter(ChatMessage.conversation_id == conversation_id)
                .order_by(ChatMessage.id)
            ]

        history = chat_api.client.get(
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
        )
        assert history.status_code == 200
        assert [item["id"] for item in history.json()] == expected_ids
        assistant_response = next(
            item for item in history.json() if item["role"] == "assistant"
        )
        assert assistant_response["pending_action"]["subject_id"] == "subject-1"
        assert assistant_response["pending_action"]["status"] == "pending"

        deleted = chat_api.client.delete(
            f"/api/papers/paper-one/chat/conversations/{conversation_id}",
        )
        assert deleted.status_code == 204
        with chat_api.session_factory() as db:
            assert db.query(ChatConversation).count() == 0
            assert db.query(ChatMessage).count() == 0
            assert db.query(ChatAction).count() == 0

    def test_missing_paper_and_invalid_titles_are_rejected(self, chat_api):
        missing = chat_api.client.post(
            "/api/papers/missing/chat/conversations",
            json={"title": "Discussion"},
        )
        blank = chat_api.client.post(
            "/api/papers/paper-one/chat/conversations",
            json={"title": "   "},
        )

        assert missing.status_code == 404
        assert blank.status_code == 422


class TestChatMessageStream:
    def test_stream_offloads_chat_agent_from_event_loop(
        self,
        chat_api,
        monkeypatch,
    ):
        conversation_id = create_conversation(chat_api)["id"]
        offloaded = []

        async def fake_to_thread(function, **kwargs):
            offloaded.append((function, kwargs))
            return GroundedChatResult(
                content="Offloaded answer.",
                citations=[],
                graph_available=False,
                used_graph=False,
            )

        monkeypatch.setattr(asyncio, "to_thread", fake_to_thread)

        with chat_api.client.stream(
            "POST",
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
            json={"content": "Do not block other requests"},
        ) as response:
            events = parse_sse(response)

        assert events[-1][0] == "final"
        assert offloaded == [(chat_routes.run_chat_agent, {
            "question": "Do not block other requests",
            "context": None,
            "history": [],
            "html_content": None,
            "sections_data": None,
            "knowledge_graph": None,
            "semantic_overrides": {},
        })]

    def test_stream_persists_context_and_emits_persisted_final_message(
        self,
        chat_api,
        monkeypatch,
    ):
        conversation_id = create_conversation(chat_api)["id"]
        monkeypatch.setattr(
            chat_routes,
            "run_chat_agent",
            lambda **_kwargs: GroundedChatResult(
                content="Grounded selection answer.",
                citations=[],
                graph_available=False,
                used_graph=False,
            ),
        )

        with chat_api.client.stream(
            "POST",
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
            json={
                "content": "What does this mean?",
                "context": {
                    "kind": "selection",
                    "data_id": "paragraph-1",
                    "section_id": "section-1",
                    "label": "Selected passage",
                    "quote": " exact selected phrase ",
                },
            },
        ) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            events = parse_sse(response)

        assert [name for name, _ in events] == ["status", "status", "final"]
        assert events[0][1]["type"] == "status"
        final = events[-1][1]
        assert final["type"] == "final"
        assert final["message"]["role"] == "assistant"
        assert final["message"]["citations"] == []
        assert final["pending_action"] is None

        history = chat_api.client.get(
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
        ).json()
        assert [message["role"] for message in history] == ["user", "assistant"]
        assert history[0]["context"] == {
            "kind": "selection",
            "data_id": "paragraph-1",
            "section_id": "section-1",
            "subject_id": None,
            "label": "Selected passage",
            "quote": " exact selected phrase ",
        }
        assert history[1]["id"] == final["message"]["id"]

    def test_stream_emits_sanitized_error_and_keeps_user_message(
        self,
        chat_api,
        monkeypatch,
        caplog,
    ):
        conversation_id = create_conversation(chat_api)["id"]
        caplog.set_level("ERROR", logger="backend.app.api.chat_routes")
        monkeypatch.setattr(
            chat_routes,
            "run_chat_agent",
            lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("provider secret")),
        )

        with chat_api.client.stream(
            "POST",
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
            json={"content": "Persist this question"},
        ) as response:
            events = parse_sse(response)

        assert [name for name, _ in events] == ["status", "status", "error"]
        assert events[-1][1] == {
            "type": "error",
            "message": "The chat response could not be generated.",
        }
        assert all("provider secret" not in json.dumps(payload) for _, payload in events)
        error_record = next(
            record for record in caplog.records
            if record.name == "backend.app.api.chat_routes"
        )
        assert str(conversation_id) in error_record.getMessage()
        assert error_record.exc_info is not None
        assert error_record.exc_info[0] is RuntimeError
        history = chat_api.client.get(
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
        ).json()
        assert [(message["role"], message["content"]) for message in history] == [
            ("user", "Persist this question"),
        ]

    @pytest.mark.parametrize(
        "context",
        [
            {"kind": "selection", "data_id": "p-1"},
            {"kind": "section"},
            {"kind": "entity", "subject_id": ""},
            {"kind": "unknown", "quote": "text"},
        ],
    )
    def test_rejects_invalid_context_contracts_without_persisting(self, chat_api, context):
        conversation_id = create_conversation(chat_api)["id"]

        response = chat_api.client.post(
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
            json={"content": "Question", "context": context},
        )

        assert response.status_code == 422
        with chat_api.session_factory() as db:
            assert db.query(ChatMessage).count() == 0

    def test_stream_persists_only_agent_validated_citations(self, chat_api, monkeypatch):
        conversation_id = create_conversation(chat_api)["id"]
        with chat_api.session_factory() as db:
            paper = db.get(Paper, "paper-one")
            paper.html_content = '<section data-id="s"><p data-id="p-1">Exact evidence.</p></section>'
            paper.sections_data = [{
                "id": "sec-1",
                "title": "Results",
                "content_html": paper.html_content,
            }]
            db.commit()
        captured = {}

        def grounded(**kwargs):
            captured.update(kwargs)
            return GroundedChatResult(
                content="Supported answer.",
                citations=[GroundedCitation(
                    kind="quote",
                    label="Evidence",
                    source_id="p-1",
                    section_id="sec-1",
                    quote="Exact evidence.",
                )],
                graph_available=False,
                used_graph=False,
            )

        monkeypatch.setattr(chat_routes, "run_chat_agent", grounded)
        with chat_api.client.stream(
            "POST",
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
            json={"content": "What is supported?"},
        ) as response:
            events = parse_sse(response)

        assert [name for name, _ in events] == ["status", "status", "final"]
        final = events[-1][1]
        assert final["citations"] == [{
            "kind": "quote",
            "label": "Evidence",
            "source_id": "p-1",
            "section_id": "sec-1",
            "subject_id": None,
            "quote": "Exact evidence.",
        }]
        assert captured["html_content"].startswith("<section")
        assert captured["history"] == []
        with chat_api.session_factory() as db:
            assistant = db.query(ChatMessage).filter(ChatMessage.role == "assistant").one()
            assert assistant.citations == final["citations"]

    def test_stream_passes_existing_conversation_history_as_plain_snapshot(
        self,
        chat_api,
        monkeypatch,
    ):
        conversation_id = create_conversation(chat_api)["id"]
        with chat_api.session_factory() as db:
            db.add_all([
                ChatMessage(
                    conversation_id=conversation_id,
                    role="user",
                    content="Earlier question",
                    citations=[],
                ),
                ChatMessage(
                    conversation_id=conversation_id,
                    role="assistant",
                    content="Earlier answer",
                    citations=[],
                ),
            ])
            db.commit()
        captured = {}

        def grounded(**kwargs):
            captured.update(kwargs)
            return GroundedChatResult(
                content="Follow-up answer.",
                citations=[],
                graph_available=False,
                used_graph=False,
            )

        monkeypatch.setattr(chat_routes, "run_chat_agent", grounded)
        with chat_api.client.stream(
            "POST",
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
            json={"content": "Follow-up question"},
        ) as response:
            events = parse_sse(response)

        assert events[-1][0] == "final"
        assert captured["history"] == [
            {"role": "user", "content": "Earlier question"},
            {"role": "assistant", "content": "Earlier answer"},
        ]

    def test_stream_persists_validated_definition_proposal(self, chat_api, monkeypatch):
        document = install_semantic_document(chat_api)
        conversation_id = create_conversation(chat_api)["id"]
        monkeypatch.setattr(
            chat_routes,
            "run_chat_agent",
            lambda **_kwargs: GroundedChatResult(
                content="I prepared a definition preview.",
                citations=[],
                graph_available=True,
                used_graph=True,
                definition_proposal=DefinitionProposal(
                    subject_id="quantity:elbo",
                    target_text="Evidence lower bound",
                    base_definition="A lower bound on the log evidence.",
                    proposed_definition="A user-friendly grounded definition.",
                    knowledge_graph_version=knowledge_document_version(document),
                ),
            ),
        )

        with chat_api.client.stream(
            "POST",
            f"/api/papers/paper-one/chat/conversations/{conversation_id}/messages",
            json={"content": "Rewrite the ELBO definition."},
        ) as response:
            events = parse_sse(response)

        final = events[-1][1]
        assert final["pending_action"]["subject_id"] == "quantity:elbo"
        assert final["pending_action"]["status"] == "pending"
        with chat_api.session_factory() as db:
            action = db.query(ChatAction).one()
            assert action.source_message_id == final["message"]["id"]
            assert action.knowledge_graph_version == knowledge_document_version(document)


class TestChatDefinitionActions:
    def test_confirm_applies_shared_semantic_override_and_returns_refresh_payload(self, chat_api):
        document = install_semantic_document(chat_api)
        action_id = seed_action(chat_api, document)

        confirmed = chat_api.client.post(
            f"/api/papers/paper-one/chat/actions/{action_id}/confirm",
        )

        assert confirmed.status_code == 200
        payload = confirmed.json()
        assert payload["action"]["status"] == "confirmed"
        assert payload["tooltip"]["entity_id"] == "quantity:elbo"
        assert payload["tooltip"]["content"] == "A user-friendly grounded definition."
        assert payload["tooltip"]["is_user_override"] is True
        assert payload["subject"]["subject"]["stable_id"] == "quantity:elbo"

        repeated = chat_api.client.post(
            f"/api/papers/paper-one/chat/actions/{action_id}/confirm",
        )
        assert repeated.status_code == 200
        assert repeated.json()["tooltip"]["id"] == payload["tooltip"]["id"]

        semantic_edit = chat_api.client.put(
            "/api/papers/paper-one/semantic-notes/quantity:elbo",
            json={"content": "Edited through Semantic Lens."},
        )
        assert semantic_edit.status_code == 200
        assert semantic_edit.json()["id"] == payload["tooltip"]["id"]

    def test_reject_is_idempotent_and_does_not_create_override(self, chat_api):
        document = install_semantic_document(chat_api)
        action_id = seed_action(chat_api, document)

        first = chat_api.client.post(
            f"/api/papers/paper-one/chat/actions/{action_id}/reject",
        )
        repeated = chat_api.client.post(
            f"/api/papers/paper-one/chat/actions/{action_id}/reject",
        )

        assert first.status_code == repeated.status_code == 200
        assert first.json()["status"] == repeated.json()["status"] == "rejected"
        with chat_api.session_factory() as db:
            assert db.query(Tooltip).count() == 0

    def test_confirm_marks_action_stale_when_base_definition_changed(self, chat_api):
        document = install_semantic_document(chat_api)
        action_id = seed_action(chat_api, document)
        with chat_api.session_factory() as db:
            db.add(Tooltip(
                id="existing-note",
                paper_id="paper-one",
                entity_id="quantity:elbo",
                content="A newer reader definition.",
                is_user_override=True,
            ))
            db.commit()

        response = chat_api.client.post(
            f"/api/papers/paper-one/chat/actions/{action_id}/confirm",
        )

        assert response.status_code == 409
        with chat_api.session_factory() as db:
            assert db.get(ChatAction, action_id).status == "stale"
            assert db.get(Tooltip, "existing-note").content == "A newer reader definition."

    def test_confirm_marks_action_stale_when_active_graph_version_changed(self, chat_api):
        document = install_semantic_document(chat_api)
        action_id = seed_action(chat_api, document)
        with chat_api.session_factory() as db:
            paper = db.get(Paper, "paper-one")
            changed = dict(paper.knowledge_graph)
            changed["build"] = {**changed["build"], "pipeline_version": "changed-version"}
            paper.knowledge_graph = changed
            db.commit()

        response = chat_api.client.post(
            f"/api/papers/paper-one/chat/actions/{action_id}/confirm",
        )

        assert response.status_code == 409
        with chat_api.session_factory() as db:
            assert db.get(ChatAction, action_id).status == "stale"
            assert db.query(Tooltip).count() == 0

    def test_terminal_action_cannot_transition_to_opposite_status(self, chat_api):
        document = install_semantic_document(chat_api)
        rejected_id = seed_action(chat_api, document, status="rejected")
        confirmed_id = seed_action(chat_api, document, status="confirmed")

        confirm_rejected = chat_api.client.post(
            f"/api/papers/paper-one/chat/actions/{rejected_id}/confirm",
        )
        reject_confirmed = chat_api.client.post(
            f"/api/papers/paper-one/chat/actions/{confirmed_id}/reject",
        )

        assert confirm_rejected.status_code == 409
        assert reject_confirmed.status_code == 409