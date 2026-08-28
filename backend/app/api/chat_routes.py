"""Paper-scoped persistence and wire contracts for grounded chat."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.orm import Session

from backend.app.agents.chat_agent import run_chat_agent
from backend.app.agents.chat_retrieval import (
    active_knowledge_document,
    knowledge_document_version,
    known_surface_forms,
)
from backend.app.agents.knowledge_graph_canonical import (
    SEMANTIC_KINDS,
    canonicalize_observations,
    normalized_surface_form,
    stable_identifier,
)
from backend.app.agents.knowledge_graph_models import SourceObservation, SourceReference
from backend.app.api.semantic_routes import SubjectDetailResponse, subject_details
from backend.app.compiler.ai_html_injection import inject_validated_occurrences
from backend.app.compiler.html_injection import validate_html_integrity
from backend.app.database.connection import get_db
from backend.app.database.models import (
    ChatAction,
    ChatConversation,
    ChatMessage,
    Paper,
    Tooltip,
    User,
    utcnow,
)
from backend.app.semantic_notes import (
    effective_definition,
    semantic_definition,
    semantic_note,
    upsert_semantic_note_record,
)


CURRENT_USER_ID = 1
HISTORY_QUERY_LIMIT = 8

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/papers/{paper_id}/chat", tags=["chat"])


class ChatContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["selection", "section", "entity"]
    data_id: str | None = Field(default=None, min_length=1, max_length=256)
    section_id: str | None = Field(default=None, min_length=1, max_length=256)
    subject_id: str | None = Field(default=None, min_length=1, max_length=128)
    label: str | None = Field(default=None, min_length=1, max_length=512)
    quote: str | None = Field(default=None, min_length=1, max_length=10_000)

    @model_validator(mode="after")
    def validate_kind_fields(self):
        if self.label is not None and not self.label.strip():
            raise ValueError("Context label cannot be blank.")
        if self.kind == "selection" and (
            not self.data_id
            or not self.data_id.strip()
            or not self.quote
            or not self.quote.strip()
        ):
            raise ValueError("Selection context requires data_id and quote.")
        if self.kind == "section" and (not self.section_id or not self.section_id.strip()):
            raise ValueError("Section context requires section_id.")
        if self.kind == "entity" and (not self.subject_id or not self.subject_id.strip()):
            raise ValueError("Entity context requires subject_id.")
        return self


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["quote", "section", "entity"]
    label: str = Field(min_length=1, max_length=512)
    source_id: str | None = Field(default=None, min_length=1, max_length=256)
    section_id: str | None = Field(default=None, min_length=1, max_length=256)
    subject_id: str | None = Field(default=None, min_length=1, max_length=128)
    quote: str | None = Field(default=None, min_length=1, max_length=10_000)

    @model_validator(mode="after")
    def validate_kind_fields(self):
        if not self.label.strip():
            raise ValueError("Citation label cannot be blank.")
        if self.kind == "quote" and (
            not self.source_id
            or not self.source_id.strip()
            or not self.quote
            or not self.quote.strip()
        ):
            raise ValueError("Quote citations require source_id and quote.")
        if self.kind == "section" and (not self.section_id or not self.section_id.strip()):
            raise ValueError("Section citations require section_id.")
        if self.kind == "entity" and (not self.subject_id or not self.subject_id.strip()):
            raise ValueError("Entity citations require subject_id.")
        return self


class PendingActionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_message_id: int
    action_type: Literal["redefine", "add_entity", "annotate_entity"]
    subject_id: str | None
    base_definition: str | None
    proposed_definition: str
    payload: dict[str, Any] | None
    knowledge_graph_version: str | None
    status: Literal["pending", "confirmed", "rejected", "stale"]
    created_at: datetime
    updated_at: datetime


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    role: Literal["user", "assistant"]
    content: str
    context: ChatContext | None = Field(default=None, validation_alias="context_snapshot")
    citations: list[Citation] = Field(default_factory=list)
    pending_action: PendingActionResponse | None = Field(default=None, validation_alias="action")
    created_at: datetime


class ChatConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    paper_id: str
    title: str
    created_at: datetime
    updated_at: datetime


class ChatConversationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(default="New conversation", min_length=1, max_length=255)


class ChatConversationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)


class ChatMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=20_000)
    context: ChatContext | None = None

    @model_validator(mode="after")
    def validate_content(self):
        if not self.content.strip():
            raise ValueError("Message content cannot be blank.")
        return self


class ChatStatusEvent(BaseModel):
    type: Literal["status"] = "status"
    stage: Literal["retrieval", "answer"]
    message: str


class ChatFinalEvent(BaseModel):
    type: Literal["final"] = "final"
    message: ChatMessageResponse
    citations: list[Citation] = Field(default_factory=list)
    pending_action: PendingActionResponse | None = None


class ChatErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str


class SemanticNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    paper_id: str
    dom_node_id: str | None
    entity_id: str | None
    user_id: str
    target_text: str | None
    content: str
    is_user_override: bool
    is_pinned: bool
    display_order: int | None
    created_at: datetime
    updated_at: datetime


class ChatActionConfirmationResponse(BaseModel):
    action: PendingActionResponse
    tooltip: SemanticNoteResponse | None = None
    subject: SubjectDetailResponse


def _paper_or_404(db: Session, paper_id: str) -> Paper:
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _conversation_or_404(db: Session, paper_id: str, conversation_id: int) -> ChatConversation:
    conversation = (
        db.query(ChatConversation)
        .filter(
            ChatConversation.id == conversation_id,
            ChatConversation.paper_id == paper_id,
            ChatConversation.user_id == CURRENT_USER_ID,
        )
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def _action_or_404(db: Session, paper_id: str, action_id: int) -> ChatAction:
    action = (
        db.query(ChatAction)
        .join(ChatMessage, ChatAction.source_message_id == ChatMessage.id)
        .join(ChatConversation, ChatMessage.conversation_id == ChatConversation.id)
        .filter(
            ChatAction.id == action_id,
            ChatConversation.paper_id == paper_id,
            ChatConversation.user_id == CURRENT_USER_ID,
        )
        .with_for_update()
        .first()
    )
    if action is None:
        raise HTTPException(status_code=404, detail="Chat action not found")
    return action


def _ensure_current_user(db: Session) -> None:
    if db.get(User, CURRENT_USER_ID) is None:
        db.add(User(id=CURRENT_USER_ID))
        db.flush()


def _sse(event: str, payload: BaseModel) -> str:
    data = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False)
    return f"event: {event}\ndata: {data}\n\n"


def _grounded_assistant_message(conversation_id: int, result) -> ChatMessage:
    return ChatMessage(
        conversation_id=conversation_id,
        role="assistant",
        content=result.content,
        citations=[citation.model_dump(mode="json") for citation in result.citations],
    )


def _semantic_overrides(db: Session, paper_id: str) -> dict[str, str]:
    notes = (
        db.query(Tooltip)
        .filter(
            Tooltip.paper_id == paper_id,
            Tooltip.entity_id.is_not(None),
            Tooltip.is_user_override.is_(True),
        )
        .order_by(Tooltip.created_at)
        .all()
    )
    return {note.entity_id: note.content for note in notes if note.entity_id}


def _confirmation_response(
    db: Session,
    paper_id: str,
    action: ChatAction,
) -> ChatActionConfirmationResponse:
    if not action.subject_id:
        raise HTTPException(status_code=409, detail="Confirmed action has no semantic subject")
    tooltip = semantic_note(db, paper_id, action.subject_id)
    if action.action_type == "redefine" and tooltip is None:
        raise HTTPException(status_code=409, detail="Confirmed semantic note is unavailable")
    return ChatActionConfirmationResponse(
        action=PendingActionResponse.model_validate(action),
        tooltip=SemanticNoteResponse.model_validate(tooltip) if tooltip is not None else None,
        subject=subject_details(
            paper_id=paper_id,
            subject_id=action.subject_id,
            occurrence_limit=100,
            db=db,
        ),
    )


def _stale_action(db: Session, action: ChatAction, message: str) -> HTTPException:
    action.status = "stale"
    action.updated_at = utcnow()
    db.commit()
    return HTTPException(
        status_code=409,
        detail={"code": "stale_action", "message": message},
    )


def _inject_subject_anchors(paper: Paper, occurrences: list[dict[str, Any]]) -> None:
    """Anchor validated occurrences into the paper HTML, refusing corrupted output."""
    if not paper.html_content or not occurrences:
        return
    injection = inject_validated_occurrences(paper.html_content, occurrences)
    is_valid, validation_error = validate_html_integrity(paper.html_content, injection.html)
    if not is_valid:
        raise HTTPException(status_code=500, detail=f"HTML validation failed: {validation_error}")
    paper.html_content = injection.html


def _confirm_entity_annotation(
    db: Session,
    paper: Paper,
    action: ChatAction,
) -> ChatActionConfirmationResponse:
    """Anchor the stored occurrences of an already known subject into the HTML.

    The knowledge graph itself is untouched: the occurrences were validated when
    the document was built, so confirming injects exactly the anchors the
    ``/tooltips/apply`` flow would, just for one subject the reader asked about.
    """
    document = active_knowledge_document(paper.knowledge_graph)
    stale = (
        document is None
        or not action.subject_id
        or action.knowledge_graph_version != knowledge_document_version(document)
        or all(item.stable_id != action.subject_id for item in document.entities)
    )
    if stale:
        raise _stale_action(db, action, "The knowledge graph changed since this proposal was created.")
    occurrences = [
        item.model_dump(mode="json")
        for item in document.occurrences
        if item.subject_id == action.subject_id and item.dom_node_id
    ]
    if not occurrences:
        raise _stale_action(db, action, "The entity no longer has anchorable occurrences.")

    _inject_subject_anchors(paper, occurrences)
    action.status = "confirmed"
    action.updated_at = utcnow()
    db.commit()
    db.refresh(action)
    return _confirmation_response(db, paper.id, action)


def _confirm_entity_addition(
    db: Session,
    paper: Paper,
    action: ChatAction,
) -> ChatActionConfirmationResponse:
    """Append one confirmed observation and rebuild the graph deterministically.

    Canonicalization, occurrence anchoring, and validation reuse the exact code
    the extraction pipeline runs, so a chat confirmation can never persist a
    document shape the rest of the reader does not understand.
    """
    document = active_knowledge_document(paper.knowledge_graph)
    payload = action.payload if isinstance(action.payload, dict) else {}
    label = str(payload.get("label") or "").strip()
    kind = str(payload.get("kind") or "")
    stale = (
        document is None
        or not label
        or kind not in SEMANTIC_KINDS
        or action.knowledge_graph_version != knowledge_document_version(document)
        or normalized_surface_form(label) in known_surface_forms(document)
    )
    if stale:
        raise _stale_action(db, action, "The knowledge graph changed since this proposal was created.")
    if not paper.sections_data:
        raise HTTPException(
            status_code=409,
            detail="Paper has no compiled sections. Recompile it before adding entities.",
        )

    try:
        source = SourceReference(
            paper_id=paper.id,
            section_id=str(payload["section_id"]) if payload.get("section_id") else None,
            section_title=str(payload["section_title"]) if payload.get("section_title") else None,
            dom_node_id=str(payload["dom_node_id"]) if payload.get("dom_node_id") else None,
            quote=str(payload.get("quote") or label),
        )
        observation = SourceObservation(
            id=stable_identifier(
                f"observation-{kind}",
                label,
                scope=f"{paper.id}|chat-action-{action.id}",
            ),
            kind=kind,
            label=label,
            payload={"summary": action.proposed_definition},
            confidence=1.0,
            source=source,
        )
    except ValueError:
        raise _stale_action(db, action, "The entity proposal is no longer usable.")

    refreshed = canonicalize_observations(
        paper.id,
        [*document.observations, observation],
        models=document.build.models,
        sections=paper.sections_data,
    )
    subject = next(
        (item for item in refreshed.objects if observation.id in item.evidence_ids),
        None,
    )
    if subject is None:
        raise HTTPException(status_code=500, detail="The proposed entity could not be canonicalized")

    _inject_subject_anchors(paper, [
        item.model_dump(mode="json")
        for item in refreshed.occurrences
        if item.subject_id == subject.stable_id and item.dom_node_id
    ])
    paper.knowledge_graph = refreshed.model_dump(mode="json")
    action.subject_id = subject.stable_id
    action.status = "confirmed"
    action.updated_at = utcnow()
    db.commit()
    db.refresh(action)
    return _confirmation_response(db, paper.id, action)


@router.get("/conversations", response_model=list[ChatConversationResponse])
async def list_conversations(paper_id: str, db: Session = Depends(get_db)):
    _paper_or_404(db, paper_id)
    return (
        db.query(ChatConversation)
        .filter(
            ChatConversation.paper_id == paper_id,
            ChatConversation.user_id == CURRENT_USER_ID,
        )
        .order_by(ChatConversation.updated_at.desc(), ChatConversation.id.desc())
        .all()
    )


@router.post(
    "/conversations",
    response_model=ChatConversationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    paper_id: str,
    request: ChatConversationCreate,
    db: Session = Depends(get_db),
):
    _paper_or_404(db, paper_id)
    _ensure_current_user(db)
    conversation = ChatConversation(
        paper_id=paper_id,
        user_id=CURRENT_USER_ID,
        title=request.title,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ChatConversationResponse,
)
async def rename_conversation(
    paper_id: str,
    conversation_id: int,
    request: ChatConversationUpdate,
    db: Session = Depends(get_db),
):
    _paper_or_404(db, paper_id)
    conversation = _conversation_or_404(db, paper_id, conversation_id)
    conversation.title = request.title
    conversation.updated_at = utcnow()
    db.commit()
    db.refresh(conversation)
    return conversation


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_conversation(
    paper_id: str,
    conversation_id: int,
    db: Session = Depends(get_db),
):
    _paper_or_404(db, paper_id)
    conversation = _conversation_or_404(db, paper_id, conversation_id)
    db.delete(conversation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[ChatMessageResponse],
)
async def list_messages(
    paper_id: str,
    conversation_id: int,
    db: Session = Depends(get_db),
):
    _paper_or_404(db, paper_id)
    _conversation_or_404(db, paper_id, conversation_id)
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.id)
        .all()
    )


@router.post(
    "/actions/{action_id}/confirm",
    response_model=ChatActionConfirmationResponse,
)
async def confirm_action(
    paper_id: str,
    action_id: int,
    db: Session = Depends(get_db),
):
    paper = _paper_or_404(db, paper_id)
    action = _action_or_404(db, paper_id, action_id)
    if action.status == "confirmed":
        return _confirmation_response(db, paper_id, action)
    if action.status != "pending":
        raise HTTPException(status_code=409, detail=f"Chat action is {action.status}")
    if action.action_type == "add_entity":
        return _confirm_entity_addition(db, paper, action)
    if action.action_type == "annotate_entity":
        return _confirm_entity_annotation(db, paper, action)

    document = active_knowledge_document(paper.knowledge_graph)
    definition = semantic_definition(document, action.subject_id) if document is not None else None
    stale = (
        document is None
        or definition is None
        or action.knowledge_graph_version != knowledge_document_version(document)
        or effective_definition(db, paper_id, definition) != action.base_definition
    )
    if stale:
        raise _stale_action(db, action, "The semantic definition changed.")

    tooltip = upsert_semantic_note_record(
        db,
        paper_id=paper_id,
        subject_id=action.subject_id,
        content=action.proposed_definition,
        target_text=definition.label,
    )
    action.status = "confirmed"
    action.updated_at = utcnow()
    db.commit()
    db.refresh(action)
    db.refresh(tooltip)
    return _confirmation_response(db, paper_id, action)


@router.post(
    "/actions/{action_id}/reject",
    response_model=PendingActionResponse,
)
async def reject_action(
    paper_id: str,
    action_id: int,
    db: Session = Depends(get_db),
):
    _paper_or_404(db, paper_id)
    action = _action_or_404(db, paper_id, action_id)
    if action.status == "rejected":
        return action
    if action.status != "pending":
        raise HTTPException(status_code=409, detail=f"Chat action is {action.status}")
    action.status = "rejected"
    action.updated_at = utcnow()
    db.commit()
    db.refresh(action)
    return action


@router.post("/conversations/{conversation_id}/messages")
async def stream_message(
    paper_id: str,
    conversation_id: int,
    request: ChatMessageCreate,
    db: Session = Depends(get_db),
):
    paper = _paper_or_404(db, paper_id)
    conversation = _conversation_or_404(db, paper_id, conversation_id)
    history_rows = list(reversed(
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation.id)
        .order_by(ChatMessage.id.desc())
        .limit(HISTORY_QUERY_LIMIT)
        .all()
    ))
    history = [
        {"role": message.role, "content": message.content}
        for message in history_rows
    ]
    article_snapshot = {
        "html_content": paper.html_content,
        "sections_data": paper.sections_data,
        "knowledge_graph": paper.knowledge_graph,
        "semantic_overrides": _semantic_overrides(db, paper_id),
    }
    user_message = ChatMessage(
        conversation_id=conversation.id,
        role="user",
        content=request.content,
        context_snapshot=request.context.model_dump(mode="json") if request.context else None,
        citations=[],
    )
    conversation.updated_at = utcnow()
    db.add(user_message)
    db.commit()

    async def generate_events():
        yield _sse(
            "status",
            ChatStatusEvent(stage="retrieval", message="Preparing article evidence."),
        )
        yield _sse(
            "status",
            ChatStatusEvent(stage="answer", message="Preparing grounded answer."),
        )
        try:
            result = await asyncio.to_thread(
                run_chat_agent,
                question=request.content,
                context=request.context,
                history=history,
                **article_snapshot,
            )
            assistant_message = _grounded_assistant_message(conversation.id, result)
            conversation.updated_at = utcnow()
            db.add(assistant_message)
            db.flush()
            if result.definition_proposal is not None:
                proposal = result.definition_proposal
                assistant_message.action = ChatAction(
                    action_type="redefine",
                    subject_id=proposal.subject_id,
                    base_definition=proposal.base_definition,
                    proposed_definition=proposal.proposed_definition,
                    knowledge_graph_version=proposal.knowledge_graph_version,
                    status="pending",
                )
            elif result.entity_proposal is not None:
                entity_proposal = result.entity_proposal
                assistant_message.action = ChatAction(
                    action_type="add_entity",
                    subject_id=None,
                    base_definition=None,
                    proposed_definition=entity_proposal.definition,
                    payload={
                        "label": entity_proposal.label,
                        "kind": entity_proposal.kind,
                        "quote": entity_proposal.quote,
                        "dom_node_id": entity_proposal.dom_node_id,
                        "section_id": entity_proposal.section_id,
                        "section_title": entity_proposal.section_title,
                    },
                    knowledge_graph_version=entity_proposal.knowledge_graph_version,
                    status="pending",
                )
            elif result.annotation_proposal is not None:
                annotation_proposal = result.annotation_proposal
                assistant_message.action = ChatAction(
                    action_type="annotate_entity",
                    subject_id=annotation_proposal.subject_id,
                    base_definition=None,
                    proposed_definition=annotation_proposal.definition,
                    payload={
                        "label": annotation_proposal.label,
                        "occurrence_count": annotation_proposal.occurrence_count,
                    },
                    knowledge_graph_version=annotation_proposal.knowledge_graph_version,
                    status="pending",
                )
            db.commit()
            db.refresh(assistant_message)
            response = ChatMessageResponse.model_validate(assistant_message)
            yield _sse(
                "final",
                ChatFinalEvent(
                    message=response,
                    citations=response.citations,
                    pending_action=response.pending_action,
                ),
            )
        except Exception:
            db.rollback()
            logger.exception(
                "Chat response generation failed for paper %s, conversation %s",
                paper_id,
                conversation_id,
            )
            yield _sse(
                "error",
                ChatErrorEvent(message="The chat response could not be generated."),
            )

    return StreamingResponse(
        generate_events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )