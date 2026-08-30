"""Bibliography card and lazy cached citation resolution routes.

A click on `[N]` in paper A asks for the citation card: the bibliography text
plus the library paper it matches (by arXiv id first, then by normalized
title — a false match is worse than no match). "Show referenced fragment"
then resolves the citing context against paper B with one LLM call, cached in
`citation_links` and invalidated when B's HTML changes.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
import uuid
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from backend.app.agents.citation_resolver import Resolver, resolve_citation
from backend.app.database.connection import get_db
from backend.app.database.models import CitationLink, Paper, utcnow


router = APIRouter(prefix="/api/papers", tags=["citations"])

# Test hook: replaces the LLM-backed resolver. None means the real single
# structured LLM call in `citation_resolver`.
citation_resolver_override: Resolver | None = None

# Titles shorter than this (normalized) never fuzzy-match: generic short
# titles produce false positives, and a false match is worse than no match.
MIN_TITLE_MATCH_LENGTH = 12
TITLE_FUZZY_THRESHOLD = 0.95

_ARXIV_ID_PATTERN = re.compile(
    r"arxiv[:\s/]*([0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?",
    re.IGNORECASE,
)


class MatchedPaperSummary(BaseModel):
    id: str
    title: str | None
    filename: str


class CitationCardResponse(BaseModel):
    cite_key: str
    bib_text: str
    dom_node_id: str | None
    arxiv_id: str | None
    matched_paper: MatchedPaperSummary | None
    has_cached_resolution: bool


class CitationResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    target_paper_id: str


class CitationResolutionResponse(BaseModel):
    paper_id: str
    cite_key: str
    target_paper_id: str
    target_kind: str
    target_section_id: str | None
    target_dom_node_id: str | None
    quote: str | None
    confidence: str
    resolved_at: datetime
    cached: bool


def _paper_or_404(db: Session, paper_id: str) -> Paper:
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _citation_or_404(paper: Paper, cite_key: str) -> Dict[str, Any]:
    citations = paper.citations_data if isinstance(paper.citations_data, list) else []
    if not citations:
        raise HTTPException(status_code=404, detail="Paper has no extracted citations")
    for entry in citations:
        if isinstance(entry, dict) and entry.get("key") == cite_key:
            return entry
    raise HTTPException(status_code=404, detail="Citation not found")


def extract_arxiv_id_from_text(text: str) -> Optional[str]:
    """Pull a new-style arXiv id (2401.12345) out of free bibliography text."""
    match = _ARXIV_ID_PATTERN.search(text)
    return match.group(1) if match else None


def _normalize_arxiv_id(value: str) -> str:
    return re.sub(r"v[0-9]+$", "", value.strip().lower())


_TITLE_NOISE = re.compile(r"[^\w\s]")
_TITLE_SPACES = re.compile(r"\s+")


def normalize_title(text: str) -> str:
    value = unicodedata.normalize("NFKC", text).casefold()
    value = _TITLE_NOISE.sub(" ", value)
    return _TITLE_SPACES.sub(" ", value).strip()


def match_paper_by_title(bib_text: str, papers: list[Paper]) -> Optional[Paper]:
    """Match a library paper whose normalized title appears in the bib text.

    Exact containment after normalization, with a conservative fuzzy fallback
    over the bib text's sentence-sized chunks. Ambiguity (two candidates)
    yields no match.
    """
    normalized_bib = normalize_title(bib_text)
    if not normalized_bib:
        return None

    chunks = [normalize_title(chunk) for chunk in re.split(r"[.;]", bib_text)]
    matches: list[Paper] = []
    for paper in papers:
        metadata = paper.paper_metadata if isinstance(paper.paper_metadata, dict) else {}
        title = metadata.get("title")
        if not isinstance(title, str):
            continue
        normalized_title = normalize_title(title)
        if len(normalized_title) < MIN_TITLE_MATCH_LENGTH:
            continue
        if normalized_title in normalized_bib:
            matches.append(paper)
            continue
        if any(
            chunk and SequenceMatcher(None, normalized_title, chunk).ratio() >= TITLE_FUZZY_THRESHOLD
            for chunk in chunks
        ):
            matches.append(paper)
    return matches[0] if len(matches) == 1 else None


def _match_library_paper(
    db: Session,
    source_paper: Paper,
    bib_text: str,
    arxiv_id: Optional[str],
) -> Optional[Paper]:
    if arxiv_id:
        normalized = _normalize_arxiv_id(arxiv_id)
        for paper in db.query(Paper).filter(Paper.arxiv_id.isnot(None)).all():
            if paper.id != source_paper.id and _normalize_arxiv_id(paper.arxiv_id) == normalized:
                return paper
    candidates = [
        paper for paper in db.query(Paper).all()
        if paper.id != source_paper.id
    ]
    return match_paper_by_title(bib_text, candidates)


def _html_version(paper: Paper) -> str:
    return hashlib.sha256((paper.html_content or "").encode("utf-8")).hexdigest()


def _link_response(link: CitationLink, cached: bool) -> CitationResolutionResponse:
    return CitationResolutionResponse(
        paper_id=link.paper_id,
        cite_key=link.cite_key,
        target_paper_id=link.target_paper_id,
        target_kind=link.target_kind,
        target_section_id=link.target_section_id,
        target_dom_node_id=link.target_dom_node_id,
        quote=link.quote,
        confidence=link.confidence,
        resolved_at=link.resolved_at,
        cached=cached,
    )


@router.get("/{paper_id}/citations/{cite_key}/card", response_model=CitationCardResponse)
async def get_citation_card(paper_id: str, cite_key: str, db: Session = Depends(get_db)):
    """Bibliography text for one citation plus its library match, if any."""
    paper = _paper_or_404(db, paper_id)
    entry = _citation_or_404(paper, cite_key)
    bib_text = str(entry.get("text") or "")

    arxiv_id = extract_arxiv_id_from_text(bib_text)
    matched = _match_library_paper(db, paper, bib_text, arxiv_id)

    has_cached_resolution = False
    if matched is not None:
        has_cached_resolution = (
            db.query(CitationLink)
            .filter(
                CitationLink.paper_id == paper.id,
                CitationLink.cite_key == cite_key,
                CitationLink.target_paper_id == matched.id,
            )
            .first()
        ) is not None

    matched_summary = None
    if matched is not None:
        metadata = matched.paper_metadata if isinstance(matched.paper_metadata, dict) else {}
        title = metadata.get("title")
        matched_summary = MatchedPaperSummary(
            id=matched.id,
            title=title if isinstance(title, str) and title.strip() else None,
            filename=matched.filename,
        )

    return CitationCardResponse(
        cite_key=cite_key,
        bib_text=bib_text,
        dom_node_id=entry.get("dom_node_id"),
        arxiv_id=arxiv_id,
        matched_paper=matched_summary,
        has_cached_resolution=has_cached_resolution,
    )


@router.post(
    "/{paper_id}/citations/{cite_key}/resolve",
    response_model=CitationResolutionResponse,
)
async def resolve_citation_target(
    paper_id: str,
    cite_key: str,
    request: CitationResolveRequest,
    db: Session = Depends(get_db),
):
    """Resolve where in the target paper this citation points (cached).

    A cached row is only valid while the target paper's HTML is unchanged;
    a stale row is dropped and re-resolved with one LLM call.
    """
    paper = _paper_or_404(db, paper_id)
    entry = _citation_or_404(paper, cite_key)
    target = db.query(Paper).filter(Paper.id == request.target_paper_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Target paper not found")
    if not target.html_content:
        raise HTTPException(status_code=409, detail="Target paper has not been compiled yet")

    current_version = _html_version(target)
    cached = (
        db.query(CitationLink)
        .filter(
            CitationLink.paper_id == paper.id,
            CitationLink.cite_key == cite_key,
            CitationLink.target_paper_id == target.id,
        )
        .first()
    )
    if cached is not None:
        if cached.target_html_version == current_version:
            return _link_response(cached, cached=True)
        # The target paper was recompiled since this row was written.
        db.delete(cached)
        db.flush()

    resolution = resolve_citation(
        paper,
        cite_key,
        str(entry.get("text") or ""),
        target,
        resolver=citation_resolver_override,
    )

    link = CitationLink(
        id=str(uuid.uuid4()),
        paper_id=paper.id,
        cite_key=cite_key,
        target_paper_id=target.id,
        target_kind=resolution.target_kind,
        target_section_id=resolution.section_id,
        target_dom_node_id=resolution.dom_node_id,
        quote=resolution.quote,
        confidence=resolution.confidence,
        target_html_version=current_version,
        resolved_at=utcnow(),
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _link_response(link, cached=False)
