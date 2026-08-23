"""Shared persistence and definition rules for semantic-note overrides."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from backend.app.agents.knowledge_graph_models import KnowledgeGraphDocument
from backend.app.database.models import Paper, Tooltip, utcnow


class SemanticNotePaperNotFound(LookupError):
    pass


class EmptySemanticNote(ValueError):
    pass


@dataclass(frozen=True)
class SemanticDefinition:
    subject_id: str
    label: str
    canonical_definition: str


def semantic_definition(
    document: KnowledgeGraphDocument,
    subject_id: str,
) -> SemanticDefinition | None:
    explanation = next(
        (
            item
            for item in document.explanations
            if item.subject_id == subject_id and item.expertise == "intermediate"
        ),
        None,
    )
    semantic_object = next(
        (item for item in document.objects if item.stable_id == subject_id),
        None,
    )
    notation = next(
        (item for item in document.notation if item.stable_id == subject_id),
        None,
    )
    if semantic_object is None and notation is None:
        return None
    canonical = explanation.base_content if explanation else (
        notation.meaning if notation is not None else None
    )
    if not canonical:
        return None
    return SemanticDefinition(
        subject_id=subject_id,
        label=semantic_object.label if semantic_object is not None else notation.symbol,
        canonical_definition=canonical.strip(),
    )


def semantic_note(
    db: Session,
    paper_id: str,
    subject_id: str,
) -> Tooltip | None:
    return (
        db.query(Tooltip)
        .filter(
            Tooltip.paper_id == paper_id,
            Tooltip.entity_id == subject_id,
            Tooltip.is_user_override.is_(True),
        )
        .order_by(Tooltip.created_at)
        .first()
    )


def effective_definition(
    db: Session,
    paper_id: str,
    definition: SemanticDefinition,
) -> str:
    note = semantic_note(db, paper_id, definition.subject_id)
    return note.content.strip() if note is not None else definition.canonical_definition


def upsert_semantic_note_record(
    db: Session,
    *,
    paper_id: str,
    subject_id: str,
    content: str,
    target_text: str | None = None,
) -> Tooltip:
    """Apply the one-note-per-subject rule without committing the transaction."""
    if db.get(Paper, paper_id) is None:
        raise SemanticNotePaperNotFound(paper_id)
    normalized_content = content.strip()
    if not normalized_content:
        raise EmptySemanticNote(subject_id)

    existing = (
        db.query(Tooltip)
        .filter(Tooltip.paper_id == paper_id, Tooltip.entity_id == subject_id)
        .order_by(Tooltip.created_at)
        .first()
    )
    now = utcnow()
    if existing is not None:
        existing.content = normalized_content
        existing.is_user_override = True
        if target_text is not None:
            existing.target_text = target_text
        existing.updated_at = now
        db.flush()
        return existing

    created = Tooltip(
        id=str(uuid.uuid4()),
        paper_id=paper_id,
        entity_id=subject_id,
        target_text=target_text,
        content=normalized_content,
        is_user_override=True,
        created_at=now,
        updated_at=now,
    )
    db.add(created)
    db.flush()
    return created