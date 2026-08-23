"""Bounded passage-first evidence retrieval for chat over one active paper."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Literal, Mapping, Sequence

from bs4 import BeautifulSoup, Tag

from backend.app.agents.knowledge_graph_models import KnowledgeGraphDocument
from backend.app.agents.knowledge_graph_projection import (
    LegacyKnowledgeGraphError,
    MalformedKnowledgeGraphError,
    parse_document,
)
from backend.app.agents.knowledge_graph_retrieval import hybrid_retrieve, passage_retrieve


PASSAGE_LIMIT = 5
GRAPH_EVIDENCE_LIMIT = 6
TOTAL_EVIDENCE_LIMIT = 12
MAX_EVIDENCE_CHARS = 12_000
MAX_RECORD_CHARS = 3_000
PASSAGE_TAGS = {
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "math", "figure", "table",
    "li", "blockquote", "pre",
}


@dataclass(frozen=True)
class EvidenceRecord:
    handle: str
    kind: Literal["passage", "entity"]
    label: str
    text: str
    source_id: str | None = None
    section_id: str | None = None
    section_title: str | None = None
    subject_id: str | None = None


@dataclass(frozen=True)
class ChatRetrievalResult:
    evidence: list[EvidenceRecord]
    graph_available: bool
    used_graph: bool
    expansion_depth: int


def _normalized_text(element: Tag) -> str:
    return re.sub(r"\s+", " ", element.get_text(" ", strip=True)).strip()


def _section_membership(
    sections_data: Sequence[Mapping[str, Any]] | None,
) -> dict[str, tuple[str, str | None]]:
    membership: dict[str, tuple[str, str | None]] = {}
    for section in sections_data or []:
        section_id = str(section.get("id") or "").strip()
        if not section_id:
            continue
        title_value = section.get("title")
        title = str(title_value).strip() if title_value else None
        soup = BeautifulSoup(str(section.get("content_html") or ""), "html.parser")
        for element in soup.find_all(attrs={"data-id": True}):
            membership[str(element["data-id"])] = (section_id, title)
    return membership


def build_chat_corpus(
    html_content: str | None,
    sections_data: Sequence[Mapping[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Build navigable passage records from compiled HTML without section duplicates."""
    if not html_content:
        return []
    soup = BeautifulSoup(html_content, "html.parser")
    membership = _section_membership(sections_data)
    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for element in soup.find_all(attrs={"data-id": True}):
        if element.name not in PASSAGE_TAGS:
            continue
        source_id = str(element["data-id"])
        if source_id in seen_ids:
            continue
        text = _normalized_text(element)
        if not text:
            continue
        section_id, section_title = membership.get(source_id, (None, None))
        if section_id is None:
            parent_section = element.find_parent("section")
            if parent_section is not None:
                section_id = parent_section.get("data-id") or parent_section.get("id")
                heading = parent_section.find(["h1", "h2", "h3", "h4", "h5", "h6"])
                section_title = _normalized_text(heading) if heading else None
        records.append({
            "id": source_id,
            "text": text,
            "section_id": str(section_id) if section_id else None,
            "section_title": section_title,
            "kind": str(element.name),
        })
        seen_ids.add(source_id)
    return records


def active_knowledge_document(
    value: dict[str, Any] | KnowledgeGraphDocument | None,
) -> KnowledgeGraphDocument | None:
    """Resolve only a valid active canonical document; legacy/malformed data is unavailable."""
    if value is None:
        return None
    try:
        return parse_document(value)
    except (LegacyKnowledgeGraphError, MalformedKnowledgeGraphError, ValueError, TypeError):
        return None


def knowledge_document_version(document: KnowledgeGraphDocument) -> str:
    """Return a deterministic snapshot id for stale chat-action detection."""
    payload = json.dumps(
        document.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _context_value(context: Any, field: str) -> Any:
    if context is None:
        return None
    if isinstance(context, Mapping):
        return context.get(field)
    return getattr(context, field, None)


def _passage_record(source: Mapping[str, Any], *, text: str | None = None) -> EvidenceRecord:
    section_title = source.get("section_title")
    return EvidenceRecord(
        handle=f"passage:{source['id']}",
        kind="passage",
        label=str(section_title or source.get("id")),
        text=str(text if text is not None else source["text"]),
        source_id=str(source["id"]),
        section_id=str(source["section_id"]) if source.get("section_id") else None,
        section_title=str(section_title) if section_title else None,
    )


def _graph_records(
    document: KnowledgeGraphDocument,
    source_ids: set[str],
    requested_subject_id: str | None = None,
) -> list[EvidenceRecord]:
    observation_by_id = {item.id: item for item in document.observations}
    entity_by_id = {item.stable_id: item for item in document.entities}
    selected_ids: list[str] = (
        [requested_subject_id]
        if requested_subject_id in entity_by_id
        else []
    )
    for entity in document.entities:
        if any(
            observation_by_id[evidence_id].source.dom_node_id in source_ids
            for evidence_id in entity.evidence_ids
            if evidence_id in observation_by_id
        ):
            if entity.stable_id not in selected_ids:
                selected_ids.append(entity.stable_id)
    seed_ids = set(selected_ids)
    relation_text: dict[str, list[str]] = {entity_id: [] for entity_id in selected_ids}
    for relation in document.relations:
        if relation.source_id not in seed_ids and relation.target_id not in seed_ids:
            continue
        for entity_id in (relation.source_id, relation.target_id):
            if entity_id not in selected_ids and len(selected_ids) < GRAPH_EVIDENCE_LIMIT:
                selected_ids.append(entity_id)
                relation_text[entity_id] = []
        source = entity_by_id.get(relation.source_id)
        target = entity_by_id.get(relation.target_id)
        if source and target:
            description = f"{source.label} {relation.type.replace('_', ' ')} {target.label}."
            relation_text.setdefault(source.stable_id, []).append(description)
            relation_text.setdefault(target.stable_id, []).append(description)

    records = []
    notation_items = sorted(
        document.notation,
        key=lambda item: item.stable_id != requested_subject_id,
    )
    for notation in notation_items:
        observations = [
            observation_by_id[evidence_id]
            for evidence_id in notation.evidence_ids
            if evidence_id in observation_by_id
        ]
        if notation.stable_id != requested_subject_id and not any(
            item.source.dom_node_id in source_ids for item in observations
        ):
            continue
        quotes = list(dict.fromkeys(item.source.quote for item in observations))
        records.append(EvidenceRecord(
            handle=f"entity:{notation.stable_id}",
            kind="entity",
            label=notation.symbol,
            text=" ".join([notation.meaning, *quotes])[:MAX_RECORD_CHARS],
            source_id=next((item.source.dom_node_id for item in observations if item.source.dom_node_id), None),
            section_id=next((item.source.section_id for item in observations if item.source.section_id), None),
            section_title=next((item.source.section_title for item in observations if item.source.section_title), None),
            subject_id=notation.stable_id,
        ))
        if len(records) >= GRAPH_EVIDENCE_LIMIT:
            return records
    for entity_id in selected_ids[:GRAPH_EVIDENCE_LIMIT]:
        if len(records) >= GRAPH_EVIDENCE_LIMIT:
            break
        entity = entity_by_id.get(entity_id)
        if entity is None:
            continue
        observations = [
            observation_by_id[evidence_id]
            for evidence_id in entity.evidence_ids
            if evidence_id in observation_by_id
        ]
        quotes = list(dict.fromkeys(item.source.quote for item in observations))
        content = " ".join([*relation_text.get(entity_id, []), *quotes]).strip()
        records.append(EvidenceRecord(
            handle=f"entity:{entity.stable_id}",
            kind="entity",
            label=entity.label,
            text=content[:MAX_RECORD_CHARS],
            source_id=next((item.source.dom_node_id for item in observations if item.source.dom_node_id), None),
            section_id=next((item.source.section_id for item in observations if item.source.section_id), None),
            section_title=next((item.source.section_title for item in observations if item.source.section_title), None),
            subject_id=entity.stable_id,
        ))
    return records


def _bounded(records: list[EvidenceRecord]) -> list[EvidenceRecord]:
    bounded: list[EvidenceRecord] = []
    remaining = MAX_EVIDENCE_CHARS
    seen_handles: set[str] = set()
    for record in records:
        if record.handle in seen_handles or len(bounded) >= TOTAL_EVIDENCE_LIMIT or remaining <= 0:
            continue
        text = record.text[:min(MAX_RECORD_CHARS, remaining)]
        if not text:
            continue
        bounded.append(EvidenceRecord(**{**record.__dict__, "text": text}))
        seen_handles.add(record.handle)
        remaining -= len(text)
    return bounded


def retrieve_chat_evidence(
    query: str,
    corpus: list[dict[str, Any]],
    *,
    document: dict[str, Any] | KnowledgeGraphDocument | None = None,
    use_graph: bool = False,
    context: Any = None,
) -> ChatRetrievalResult:
    """Retrieve passages always, adding at most one graph hop only when gated on."""
    parsed_document = active_knowledge_document(document)
    graph_requested = use_graph or _context_value(context, "kind") == "entity"
    graph_enabled = graph_requested and parsed_document is not None
    requested_subject_id = _context_value(context, "subject_id")
    effective_query = query
    if graph_enabled and requested_subject_id and parsed_document is not None:
        subject = next(
            (item for item in parsed_document.entities if item.stable_id == requested_subject_id),
            None,
        )
        if subject is not None:
            effective_query = f"{query} {subject.label} {' '.join(subject.aliases)}"
        else:
            notation = next(
                (item for item in parsed_document.notation if item.stable_id == requested_subject_id),
                None,
            )
            if notation is not None:
                effective_query = f"{query} {notation.symbol} {notation.meaning}"
    source_by_id = {str(item["id"]): item for item in corpus}
    ordered: list[EvidenceRecord] = []

    context_kind = _context_value(context, "kind")
    context_source_id = _context_value(context, "data_id")
    if context_kind == "selection" and context_source_id and _context_value(context, "quote"):
        source = source_by_id.get(str(context_source_id))
        quote = str(_context_value(context, "quote"))
        if source is not None and quote in str(source["text"]):
            ordered.append(_passage_record(source, text=quote))

    context_section_id = _context_value(context, "section_id")
    if context_kind == "section" and context_section_id:
        for source in corpus:
            if source.get("section_id") == context_section_id:
                ordered.append(_passage_record(source))
                if len(ordered) >= 2:
                    break

    expansion_depth = 0
    selected_source_ids: list[str] = []
    if corpus:
        if graph_enabled:
            retrieval = hybrid_retrieve(
                effective_query,
                corpus,
                parsed_document,
                source_limit=PASSAGE_LIMIT,
                entity_budget=GRAPH_EVIDENCE_LIMIT,
            )
            expansion_depth = retrieval.expansion_depth
        else:
            retrieval = passage_retrieve(effective_query, corpus, limit=PASSAGE_LIMIT)
        selected_source_ids = retrieval.source_ids
        for source_id in selected_source_ids:
            source = source_by_id.get(source_id)
            if source is not None:
                ordered.append(_passage_record(source))

    if graph_enabled and parsed_document is not None:
        ordered.extend(_graph_records(
            parsed_document,
            set(selected_source_ids),
            str(requested_subject_id) if requested_subject_id else None,
        ))

    return ChatRetrievalResult(
        evidence=_bounded(ordered),
        graph_available=parsed_document is not None,
        used_graph=graph_enabled,
        expansion_depth=expansion_depth,
    )