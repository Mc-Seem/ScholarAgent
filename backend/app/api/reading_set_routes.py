"""CRUD, paper membership, and term-alignment routes for reading sets.

A reading set is an explicit, user-curated group of papers that scopes the
multi-paper features (term alignment, set-level chat). Membership changes are
idempotent where that keeps the client simple: adding a paper twice is a
no-op, while removing a paper that is not a member is a 404.

Term alignment ("Link terms") runs as a background task with SSE progress and
cooperative cancellation, mirroring the knowledge graph build in `api/main.py`.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session, selectinload

from backend.app.database.connection import get_db
from backend.app.database.models import (
    EntityAlignment,
    Paper,
    ReadingSet,
    ReadingSetPaper,
    utcnow,
)


router = APIRouter(prefix="/api/reading-sets", tags=["reading-sets"])

# Alignment build progress tracking, mirroring kg_build_progress in api/main.py.
# Format: {reading_set_id: {stage: str, progress: {...}, ...summary fields}}
alignment_build_progress: Dict[str, Dict[str, Any]] = {}

# Cooperative cancellation flags for in-progress alignment builds.
alignment_cancel_flags: Dict[str, bool] = {}

# Test hook: session factory used by the background alignment task. None means
# the application SessionLocal; tests point it at their SQLite factory because
# background tasks cannot use the request-scoped `get_db` override.
alignment_session_factory = None


class ReadingSetPaperResponse(BaseModel):
    """Paper summary embedded in a reading set, plus its membership timestamp."""

    id: str
    filename: str
    arxiv_id: str | None
    title: str | None
    has_html: bool
    has_knowledge_graph: bool
    added_at: datetime


class ReadingSetResponse(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    papers: list[ReadingSetPaperResponse]


class ReadingSetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=255)


class ReadingSetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=255)


class EntityAlignmentResponse(BaseModel):
    id: str
    reading_set_id: str
    paper_a_id: str
    subject_a_id: str
    label_a: str
    paper_b_id: str
    subject_b_id: str
    label_b: str
    method: str
    score: float
    confidence: str
    status: str
    rationale: str | None
    created_at: datetime


def _reading_set_or_404(db: Session, reading_set_id: str) -> ReadingSet:
    reading_set = (
        db.query(ReadingSet)
        .options(selectinload(ReadingSet.memberships).selectinload(ReadingSetPaper.paper))
        .filter(ReadingSet.id == reading_set_id)
        .first()
    )
    if reading_set is None:
        raise HTTPException(status_code=404, detail="Reading set not found")
    return reading_set


def _paper_or_404(db: Session, paper_id: str) -> Paper:
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _paper_title(paper: Paper) -> str | None:
    metadata = paper.paper_metadata if isinstance(paper.paper_metadata, dict) else {}
    title = metadata.get("title")
    return title if isinstance(title, str) and title.strip() else None


def _membership_response(membership: ReadingSetPaper) -> ReadingSetPaperResponse:
    paper = membership.paper
    return ReadingSetPaperResponse(
        id=paper.id,
        filename=paper.filename,
        arxiv_id=paper.arxiv_id,
        title=_paper_title(paper),
        has_html=paper.html_content is not None,
        has_knowledge_graph=paper.knowledge_graph is not None,
        added_at=membership.added_at,
    )


def _to_response(reading_set: ReadingSet) -> ReadingSetResponse:
    memberships = sorted(
        reading_set.memberships,
        key=lambda membership: (membership.added_at, membership.paper_id),
    )
    return ReadingSetResponse(
        id=reading_set.id,
        name=reading_set.name,
        created_at=reading_set.created_at,
        updated_at=reading_set.updated_at,
        papers=[_membership_response(membership) for membership in memberships],
    )


@router.get("", response_model=list[ReadingSetResponse])
async def list_reading_sets(db: Session = Depends(get_db)):
    reading_sets = (
        db.query(ReadingSet)
        .options(selectinload(ReadingSet.memberships).selectinload(ReadingSetPaper.paper))
        .order_by(ReadingSet.created_at, ReadingSet.id)
        .all()
    )
    return [_to_response(reading_set) for reading_set in reading_sets]


@router.post(
    "",
    response_model=ReadingSetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reading_set(request: ReadingSetCreate, db: Session = Depends(get_db)):
    reading_set = ReadingSet(id=str(uuid.uuid4()), name=request.name)
    db.add(reading_set)
    db.commit()
    db.refresh(reading_set)
    return _to_response(reading_set)


@router.get("/{reading_set_id}", response_model=ReadingSetResponse)
async def get_reading_set(reading_set_id: str, db: Session = Depends(get_db)):
    return _to_response(_reading_set_or_404(db, reading_set_id))


@router.put("/{reading_set_id}", response_model=ReadingSetResponse)
async def rename_reading_set(
    reading_set_id: str,
    request: ReadingSetUpdate,
    db: Session = Depends(get_db),
):
    reading_set = _reading_set_or_404(db, reading_set_id)
    reading_set.name = request.name
    reading_set.updated_at = utcnow()
    db.commit()
    db.refresh(reading_set)
    return _to_response(reading_set)


@router.delete("/{reading_set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reading_set(reading_set_id: str, db: Session = Depends(get_db)):
    reading_set = _reading_set_or_404(db, reading_set_id)
    db.delete(reading_set)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{reading_set_id}/papers/{paper_id}", response_model=ReadingSetResponse)
async def add_paper_to_reading_set(
    reading_set_id: str,
    paper_id: str,
    db: Session = Depends(get_db),
):
    reading_set = _reading_set_or_404(db, reading_set_id)
    paper = _paper_or_404(db, paper_id)
    already_member = any(
        membership.paper_id == paper.id for membership in reading_set.memberships
    )
    if not already_member:
        db.add(ReadingSetPaper(reading_set_id=reading_set.id, paper_id=paper.id))
        reading_set.updated_at = utcnow()
        db.commit()
        db.refresh(reading_set)
    return _to_response(reading_set)


@router.delete("/{reading_set_id}/papers/{paper_id}", response_model=ReadingSetResponse)
async def remove_paper_from_reading_set(
    reading_set_id: str,
    paper_id: str,
    db: Session = Depends(get_db),
):
    reading_set = _reading_set_or_404(db, reading_set_id)
    membership = next(
        (item for item in reading_set.memberships if item.paper_id == paper_id),
        None,
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="Paper is not in this reading set")
    db.delete(membership)
    # Alignments are scoped to the set, so a paper that leaves takes its links
    # in this set with it (links in other sets are untouched).
    (
        db.query(EntityAlignment)
        .filter(
            EntityAlignment.reading_set_id == reading_set.id,
            (EntityAlignment.paper_a_id == paper_id)
            | (EntityAlignment.paper_b_id == paper_id),
        )
        .delete(synchronize_session=False)
    )
    reading_set.updated_at = utcnow()
    db.commit()
    db.refresh(reading_set)
    return _to_response(reading_set)


# =============================================================================
# Term alignment ("Link terms")
# =============================================================================

def _alignment_response(alignment: EntityAlignment) -> EntityAlignmentResponse:
    return EntityAlignmentResponse(
        id=alignment.id,
        reading_set_id=alignment.reading_set_id,
        paper_a_id=alignment.paper_a_id,
        subject_a_id=alignment.subject_a_id,
        label_a=alignment.label_a,
        paper_b_id=alignment.paper_b_id,
        subject_b_id=alignment.subject_b_id,
        label_b=alignment.label_b,
        method=alignment.method,
        score=alignment.score,
        confidence=alignment.confidence,
        status=alignment.status,
        rationale=alignment.rationale,
        created_at=alignment.created_at,
    )


def _run_alignment_build_task(reading_set_id: str) -> None:
    """Background task to link terms across the reading set's papers."""
    from backend.app.agents.paper_alignment import (
        PaperAlignmentCancelledError,
        build_alignments_for_reading_set,
    )

    def progress_callback(stage: str, current: int, total: int) -> None:
        if reading_set_id in alignment_build_progress:
            labels = {
                "load_documents": "Loading knowledge graphs",
                "build_profiles": "Building term profiles",
                "blocking": "Matching terms",
                "adjudication": "Judging ambiguous pairs",
                "persist": "Saving alignments",
            }
            alignment_build_progress[reading_set_id] = {
                "stage": "linking",
                "progress": {
                    "stage": stage,
                    "label": labels.get(stage, stage.replace("_", " ").title()),
                    "current": current,
                    "total": total,
                },
            }

    def cancel_check() -> bool:
        return alignment_cancel_flags.get(reading_set_id, False)

    try:
        summary = build_alignments_for_reading_set(
            reading_set_id,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
            session_factory=alignment_session_factory,
        )
        alignment_build_progress[reading_set_id] = {
            "stage": "complete",
            "progress": {},
            **summary,
        }
    except PaperAlignmentCancelledError:
        alignment_build_progress[reading_set_id] = {"stage": "cancelled", "progress": {}}
    except Exception as error:  # noqa: BLE001 - reported through the SSE stream
        alignment_build_progress[reading_set_id] = {"stage": "error", "error": str(error)}
    finally:
        alignment_cancel_flags.pop(reading_set_id, None)


@router.post("/{reading_set_id}/alignments/build", status_code=status.HTTP_202_ACCEPTED)
async def build_alignments(
    reading_set_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger term alignment for a reading set (async background task).

    Papers without a built knowledge graph are skipped and reported in the
    completion summary; a set with fewer than two linkable papers completes
    with an empty result instead of failing.
    """
    _reading_set_or_404(db, reading_set_id)

    current = alignment_build_progress.get(reading_set_id)
    if current and current.get("stage") in ("starting", "linking"):
        raise HTTPException(status_code=409, detail="Alignment build already in progress")

    alignment_cancel_flags[reading_set_id] = False
    alignment_build_progress[reading_set_id] = {"stage": "starting", "progress": {}}
    background_tasks.add_task(_run_alignment_build_task, reading_set_id)

    return {"status": "accepted", "message": "Alignment build started in background"}


@router.get("/{reading_set_id}/alignments/build/progress")
async def alignment_build_progress_sse(reading_set_id: str):
    """SSE endpoint for real-time alignment build progress."""
    async def event_generator():
        try:
            yield f"data: {json.dumps({'type': 'connected', 'reading_set_id': reading_set_id})}\n\n"

            last_progress = None
            wait_count = 0
            while True:
                if reading_set_id in alignment_build_progress:
                    wait_count = 0
                    current = alignment_build_progress[reading_set_id]

                    if current != last_progress:
                        yield f"data: {json.dumps(current)}\n\n"
                        last_progress = current.copy()

                    if current.get("stage") in ("complete", "error", "cancelled"):
                        await asyncio.sleep(2)
                        alignment_build_progress.pop(reading_set_id, None)
                        break
                else:
                    wait_count += 1
                    if wait_count > 60:  # 30 s max wait for the task to appear
                        yield f"data: {json.dumps({'stage': 'error', 'error': 'Alignment build not found'})}\n\n"
                        break

                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            # Client disconnected
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{reading_set_id}/alignments/build/cancel")
async def cancel_alignment_build(reading_set_id: str, db: Session = Depends(get_db)):
    """Cooperatively cancel an in-progress alignment build.

    The background task checks the flag between units of work and stops without
    committing partial results.
    """
    _reading_set_or_404(db, reading_set_id)

    current = alignment_build_progress.get(reading_set_id)
    if not current or current.get("stage") not in ("starting", "linking"):
        raise HTTPException(status_code=409, detail="No alignment build is in progress")

    alignment_cancel_flags[reading_set_id] = True

    return {"status": "cancelling"}


@router.get("/{reading_set_id}/alignments", response_model=list[EntityAlignmentResponse])
async def list_alignments(
    reading_set_id: str,
    paper_id: Optional[str] = None,
    subject_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List the set's alignments, optionally narrowed to one paper or subject.

    All statuses are returned (including rejected/stale) so clients can render
    the review actions; reading surfaces are expected to filter on status.
    """
    _reading_set_or_404(db, reading_set_id)

    query = db.query(EntityAlignment).filter(
        EntityAlignment.reading_set_id == reading_set_id,
    )
    if paper_id is not None:
        query = query.filter(
            (EntityAlignment.paper_a_id == paper_id)
            | (EntityAlignment.paper_b_id == paper_id),
        )
    if subject_id is not None:
        query = query.filter(
            (EntityAlignment.subject_a_id == subject_id)
            | (EntityAlignment.subject_b_id == subject_id),
        )
    alignments = query.order_by(EntityAlignment.created_at, EntityAlignment.id).all()
    return [_alignment_response(alignment) for alignment in alignments]


def _alignment_or_404(db: Session, reading_set_id: str, alignment_id: str) -> EntityAlignment:
    alignment = (
        db.query(EntityAlignment)
        .filter(
            EntityAlignment.id == alignment_id,
            EntityAlignment.reading_set_id == reading_set_id,
        )
        .first()
    )
    if alignment is None:
        raise HTTPException(status_code=404, detail="Alignment not found")
    return alignment


@router.post(
    "/{reading_set_id}/alignments/{alignment_id}/confirm",
    response_model=EntityAlignmentResponse,
)
async def confirm_alignment(
    reading_set_id: str,
    alignment_id: str,
    db: Session = Depends(get_db),
):
    alignment = _alignment_or_404(db, reading_set_id, alignment_id)
    alignment.status = "confirmed"
    db.commit()
    db.refresh(alignment)
    return _alignment_response(alignment)


@router.post(
    "/{reading_set_id}/alignments/{alignment_id}/reject",
    response_model=EntityAlignmentResponse,
)
async def reject_alignment(
    reading_set_id: str,
    alignment_id: str,
    db: Session = Depends(get_db),
):
    alignment = _alignment_or_404(db, reading_set_id, alignment_id)
    alignment.status = "rejected"
    db.commit()
    db.refresh(alignment)
    return _alignment_response(alignment)
