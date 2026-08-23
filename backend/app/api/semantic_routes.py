"""Bounded reader projections over the versioned paper semantic document."""

from __future__ import annotations

from typing import Any, Literal

from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from backend.app.agents.knowledge_graph_models import (
    EntityFacet,
    EquationRecord,
    KnowledgeGraphDocument,
    NotationRecord,
    SemanticExplanation,
    SemanticOccurrence,
    SourceObservation,
)
from backend.app.agents.knowledge_graph_projection import (
    LegacyKnowledgeGraphError,
    MalformedKnowledgeGraphError,
    parse_document,
)
from backend.app.database.connection import get_db
from backend.app.database.models import Paper


router = APIRouter(prefix="/api/papers/{paper_id}/semantic", tags=["semantic"])


class SemanticResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SemanticSubject(SemanticResponseModel):
    stable_id: str
    kind: str
    label: str
    aliases: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    facets: list[EntityFacet] = Field(default_factory=list)
    units: str | None = None
    constraints: list[str] = Field(default_factory=list)
    object_ids: list[str] = Field(default_factory=list)


class AnnotationItem(SemanticResponseModel):
    occurrence: SemanticOccurrence
    subject: SemanticSubject
    explanation: SemanticExplanation | None = None


class SectionAnnotationsResponse(SemanticResponseModel):
    schema_version: str
    section_id: str
    items: list[AnnotationItem]
    total: int
    offset: int
    limit: int


class DefinedSubjectDetails(SemanticResponseModel):
    subject: SemanticSubject
    explanation: SemanticExplanation | None = None
    occurrences: list[SemanticOccurrence]
    evidence: list[SourceObservation]
    occurrence_total: int


class EquationDetailResponse(SemanticResponseModel):
    schema_version: str
    equation: EquationRecord
    notation: list[NotationRecord]
    objects: list[SemanticSubject]
    evidence: list[SourceObservation]
    defined_subject: DefinedSubjectDetails | None = None


class SubjectDetailResponse(DefinedSubjectDetails):
    schema_version: str
    defining_equation: EquationDetailResponse | None = None


class GlossaryResult(SemanticResponseModel):
    subject_id: str
    kind: Literal["object", "notation"]
    label: str
    aliases: list[str] = Field(default_factory=list)
    explanation: str
    evidence_ids: list[str]


class GlossaryResponse(SemanticResponseModel):
    schema_version: str
    results: list[GlossaryResult]
    total: int
    offset: int
    limit: int


def _paper_document(paper_id: str, db: Session) -> tuple[Paper, KnowledgeGraphDocument]:
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    if not paper.knowledge_graph:
        raise HTTPException(status_code=404, detail="Semantic document not built")
    try:
        return paper, parse_document(paper.knowledge_graph)
    except LegacyKnowledgeGraphError as error:
        raise HTTPException(
            status_code=409,
            detail={"code": "rebuild_required", "message": str(error)},
        ) from error
    except MalformedKnowledgeGraphError as error:
        raise HTTPException(
            status_code=500,
            detail={"code": "malformed_semantic_document", "message": str(error)},
        ) from error


def _document(paper_id: str, db: Session) -> KnowledgeGraphDocument:
    return _paper_document(paper_id, db)[1]


def _source_order(
    sections_data: Any,
) -> tuple[dict[str, int], dict[tuple[str, str], int]]:
    section_positions: dict[str, int] = {}
    node_positions: dict[tuple[str, str], int] = {}
    if not isinstance(sections_data, list):
        return section_positions, node_positions

    for section_position, section in enumerate(sections_data):
        if not isinstance(section, dict) or not section.get("id"):
            continue
        section_id = str(section["id"])
        section_positions.setdefault(section_id, section_position)
        soup = BeautifulSoup(str(section.get("content_html") or ""), "html.parser")
        for node_position, element in enumerate(soup.find_all(attrs={"data-id": True})):
            node_id = str(element.get("data-id"))
            node_positions.setdefault((section_id, node_id), node_position)
    return section_positions, node_positions


def _subject_index(document: KnowledgeGraphDocument) -> dict[str, SemanticSubject]:
    subjects = {
        item.stable_id: SemanticSubject(
            stable_id=item.stable_id,
            kind=item.kind,
            label=item.label,
            aliases=item.aliases,
            roles=item.roles,
            facets=item.facets,
        )
        for item in document.objects
    }
    subjects.update({
        item.stable_id: SemanticSubject(
            stable_id=item.stable_id,
            kind="notation",
            label=item.symbol,
            units=item.units,
            constraints=item.constraints,
            object_ids=item.object_ids,
        )
        for item in document.notation
    })
    return subjects


def _explanation_index(document: KnowledgeGraphDocument) -> dict[str, SemanticExplanation]:
    return {
        item.subject_id: item
        for item in document.explanations
        if item.expertise == "intermediate"
    }


def _evidence(
    document: KnowledgeGraphDocument,
    evidence_ids: list[str],
    source_order: tuple[dict[str, int], dict[tuple[str, str], int]] | None = None,
) -> list[SourceObservation]:
    observation_index = {item.id: item for item in document.observations}
    evidence = [observation_index[item_id] for item_id in evidence_ids if item_id in observation_index]
    if source_order is None:
        return evidence

    section_positions, node_positions = source_order
    unknown_section = max(section_positions.values(), default=-1) + 1

    def position(indexed: tuple[int, SourceObservation]) -> tuple[int, int, int, int]:
        original_position, item = indexed
        source = item.source
        section_position = section_positions.get(source.section_id or "", unknown_section)
        node_position = node_positions.get(
            (source.section_id or "", source.dom_node_id or ""),
            1_000_000,
        )
        return (
            section_position,
            node_position,
            source.char_start if source.char_start is not None else 0,
            original_position,
        )

    return [item for _, item in sorted(enumerate(evidence), key=position)]


def _defined_subject_details(
    document: KnowledgeGraphDocument,
    subject_id: str,
    *,
    occurrence_limit: int,
    source_order: tuple[dict[str, int], dict[tuple[str, str], int]] | None = None,
) -> DefinedSubjectDetails:
    subjects = _subject_index(document)
    explanations = _explanation_index(document)
    semantic_object = next(
        (item for item in document.objects if item.stable_id == subject_id), None
    )
    notation = next((item for item in document.notation if item.stable_id == subject_id), None)
    evidence_ids = semantic_object.observation_ids if semantic_object else notation.evidence_ids
    occurrences = sorted(
        (item for item in document.occurrences if item.subject_id == subject_id),
        key=lambda item: (item.dom_node_id or item.equation_id or "", item.start),
    )
    return DefinedSubjectDetails(
        subject=subjects[subject_id],
        explanation=explanations.get(subject_id),
        occurrences=occurrences[:occurrence_limit],
        occurrence_total=len(occurrences),
        evidence=_evidence(document, evidence_ids, source_order),
    )


def _equation_details(
    document: KnowledgeGraphDocument,
    equation: EquationRecord,
    *,
    include_defined_subject: bool,
    source_order: tuple[dict[str, int], dict[tuple[str, str], int]] | None = None,
) -> EquationDetailResponse:
    notation_index = {item.stable_id: item for item in document.notation}
    subject_index = _subject_index(document)
    defined_subject = None
    if include_defined_subject and equation.defined_object_id:
        defined_subject = _defined_subject_details(
            document,
            equation.defined_object_id,
            occurrence_limit=100,
            source_order=source_order,
        )
    return EquationDetailResponse(
        schema_version=document.schema_version,
        equation=equation,
        notation=[notation_index[item_id] for item_id in equation.notation_ids],
        objects=[subject_index[item_id] for item_id in equation.object_ids],
        evidence=_evidence(document, equation.evidence_ids, source_order),
        defined_subject=defined_subject,
    )


@router.get(
    "/sections/{section_id}/annotations",
    response_model=SectionAnnotationsResponse,
)
def section_annotations(
    paper_id: str,
    section_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
) -> SectionAnnotationsResponse:
    document = _document(paper_id, db)
    subjects = _subject_index(document)
    explanations = _explanation_index(document)
    occurrences = [
        item
        for item in document.occurrences
        if item.subject_id in subjects
        and item.dom_node_id is not None
        and item.scope_id == section_id
    ]
    occurrences.sort(key=lambda item: (
        item.dom_node_id or item.equation_id or "",
        item.start,
        item.stable_id,
    ))
    page = occurrences[offset:offset + limit]
    return SectionAnnotationsResponse(
        schema_version=document.schema_version,
        section_id=section_id,
        items=[
            AnnotationItem(
                occurrence=item,
                subject=subjects[item.subject_id],
                explanation=explanations.get(item.subject_id),
            )
            for item in page
        ],
        total=len(occurrences),
        offset=offset,
        limit=limit,
    )


@router.get("/subjects/{subject_id}", response_model=SubjectDetailResponse)
def subject_details(
    paper_id: str,
    subject_id: str,
    occurrence_limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
) -> SubjectDetailResponse:
    paper, document = _paper_document(paper_id, db)
    source_order = _source_order(paper.sections_data)
    subjects = _subject_index(document)
    if subject_id not in subjects:
        raise HTTPException(status_code=404, detail="Semantic subject not found")
    details = _defined_subject_details(
        document,
        subject_id,
        occurrence_limit=occurrence_limit,
        source_order=source_order,
    )
    defining_equation = next(
        (
            item
            for item in document.equations
            if item.defined_object_id == subject_id
        ),
        None,
    )
    return SubjectDetailResponse(
        schema_version=document.schema_version,
        **details.model_dump(),
        defining_equation=(
            _equation_details(
                document,
                defining_equation,
                include_defined_subject=False,
                source_order=source_order,
            )
            if defining_equation
            else None
        ),
    )


@router.get("/equations/{equation_id}", response_model=EquationDetailResponse)
def equation_details(
    paper_id: str,
    equation_id: str,
    db: Session = Depends(get_db),
) -> EquationDetailResponse:
    paper, document = _paper_document(paper_id, db)
    source_order = _source_order(paper.sections_data)
    equation = next(
        (item for item in document.equations if item.equation_id == equation_id), None
    )
    if equation is None:
        raise HTTPException(status_code=404, detail="Equation not found")
    return _equation_details(
        document,
        equation,
        include_defined_subject=True,
        source_order=source_order,
    )


@router.get("/glossary", response_model=GlossaryResponse)
def glossary(
    paper_id: str,
    query: str = Query(default="", max_length=200),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=50),
    db: Session = Depends(get_db),
) -> GlossaryResponse:
    document = _document(paper_id, db)
    explanations = _explanation_index(document)
    rows: list[GlossaryResult] = []
    for item in document.objects:
        explanation = explanations.get(item.stable_id)
        rows.append(GlossaryResult(
            subject_id=item.stable_id,
            kind="object",
            label=item.label,
            aliases=item.aliases,
            explanation=explanation.base_content if explanation else item.label,
            evidence_ids=item.observation_ids,
        ))
    for item in document.notation:
        explanation = explanations.get(item.stable_id)
        rows.append(GlossaryResult(
            subject_id=item.stable_id,
            kind="notation",
            label=item.symbol,
            explanation=explanation.base_content if explanation else item.meaning,
            evidence_ids=item.evidence_ids,
        ))

    normalized_query = " ".join(query.casefold().split())

    def rank(row: GlossaryResult) -> tuple[int, str, str]:
        values = [row.label, *row.aliases]
        normalized_values = [" ".join(value.casefold().split()) for value in values]
        if not normalized_query:
            score = 0
        elif normalized_query in normalized_values:
            score = 0
        elif any(value.startswith(normalized_query) for value in normalized_values):
            score = 1
        elif any(normalized_query in value for value in normalized_values):
            score = 2
        elif normalized_query in row.explanation.casefold():
            score = 3
        else:
            score = 4
        return score, row.label.casefold(), row.subject_id

    ranked = sorted(rows, key=rank)
    if normalized_query:
        ranked = [row for row in ranked if rank(row)[0] < 4]
    return GlossaryResponse(
        schema_version=document.schema_version,
        results=ranked[offset:offset + limit],
        total=len(ranked),
        offset=offset,
        limit=limit,
    )