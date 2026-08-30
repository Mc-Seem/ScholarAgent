"""Term alignment between the knowledge graphs of a reading set's papers.

LangGraph pipeline: load_member_documents -> build_profiles ->
deterministic_blocking -> llm_adjudicate_ambiguous -> persist_alignments.

Candidates are blocked deterministically on normalized labels, aliases, and
math signatures. A shared name is evidence, not proof: only keys that are
unique on both sides with an identical subject kind become deterministic
matches. Every other bucket is small and goes to a single structured-output
LLM call that returns same/different with confidence and rationale.

Persistence keeps user decisions: `confirmed`/`rejected` rows survive a
re-build, rows pointing at stable_ids that no longer exist are marked
`stale`, and `auto` rows are replaced wholesale. Everything is committed in
one transaction so a cancelled build leaves no partial writes.
"""

from __future__ import annotations

import os
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from itertools import combinations, product
from typing import Any, Callable, Dict, List, Literal, NotRequired, Tuple, TypedDict

from langgraph.graph import StateGraph, END
from pydantic import BaseModel, Field

# Bounded LLM usage: buckets larger than this are truncated (most prominent
# subjects first, by profile order), and adjudication stops entirely once the
# total pair budget is reached.
MAX_BUCKET_PAIRS = int(os.getenv("SCHOLAR_ALIGNMENT_MAX_BUCKET_PAIRS", "6"))
MAX_LLM_PAIRS = int(os.getenv("SCHOLAR_ALIGNMENT_MAX_LLM_PAIRS", "40"))

Confidence = Literal["high", "medium", "low"]


class AlignmentVerdict(BaseModel):
    """LLM judgement for one candidate subject pair."""

    subject_a_id: str
    subject_b_id: str
    same: bool
    confidence: Confidence
    rationale: str = Field(description="One short sentence; shown in the Semantic Lens.")


class AlignmentVerdictBatch(BaseModel):
    """Structured output wrapper: one verdict per requested pair."""

    verdicts: List[AlignmentVerdict]


class PaperAlignmentCancelledError(Exception):
    """Raised cooperatively when an alignment build is cancelled mid-flight."""


@dataclass
class SubjectProfile:
    """Blocking view of one KG subject (canonical entity or notation)."""

    paper_id: str
    subject_id: str
    kind: str
    label: str
    aliases: List[str] = field(default_factory=list)
    summary: str | None = None
    # normalized key -> True when the key came from the primary label/symbol
    keys: Dict[str, bool] = field(default_factory=dict)


@dataclass
class AlignmentCandidate:
    """One proposed link, already in canonical pair orientation."""

    paper_a_id: str
    subject_a_id: str
    label_a: str
    paper_b_id: str
    subject_b_id: str
    label_b: str
    method: str
    score: float
    confidence: str
    rationale: str


# Adjudicator contract: called once per ambiguous bucket with the candidate
# pairs and the profiles they reference; returns verdicts for those pairs.
Adjudicator = Callable[
    [List[Tuple[SubjectProfile, SubjectProfile]]],
    List[AlignmentVerdict],
]


class AlignmentState(TypedDict):
    reading_set_id: str
    session_factory: Any
    member_paper_ids: List[str]
    documents: Dict[str, Dict[str, Any]]
    skipped_papers: List[Dict[str, str]]
    profiles: Dict[str, List[SubjectProfile]]
    deterministic_matches: List[AlignmentCandidate]
    ambiguous_buckets: List[List[Tuple[SubjectProfile, SubjectProfile]]]
    llm_matches: List[AlignmentCandidate]
    summary: Dict[str, Any]
    adjudicator: NotRequired[Adjudicator | None]
    progress_callback: NotRequired[Any]
    cancel_check: NotRequired[Any]


def _report(state: AlignmentState, stage: str, current: int, total: int) -> None:
    """Report progress and observe cooperative cancellation (single choke point)."""
    if state.get("progress_callback"):
        state["progress_callback"](stage, current, total)
    cancel_check = state.get("cancel_check")
    if cancel_check and cancel_check():
        raise PaperAlignmentCancelledError(
            f"Alignment build for reading set {state['reading_set_id']} was cancelled "
            f"during stage '{stage}' ({current}/{total})."
        )


# =============================================================================
# Normalization
# =============================================================================

_WORD_SEPARATORS = re.compile(r"[\s\-_/]+")
_PUNCTUATION = re.compile(r"[^\w\s]")
_MATH_NOISE = re.compile(r"(\\left|\\right|[{}\s$])")


def normalize_term(text: str) -> str:
    """Normalize a label/alias for blocking: casefold, strip punctuation, singularize."""
    value = unicodedata.normalize("NFKC", text).casefold()
    value = _WORD_SEPARATORS.sub(" ", value)
    value = _PUNCTUATION.sub("", value).strip()
    words = [
        word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word
        for word in value.split()
    ]
    return " ".join(words)


def normalize_math(text: str) -> str:
    """Normalize a math signature: drop layout-only LaTeX noise, keep structure."""
    value = unicodedata.normalize("NFKC", text)
    return _MATH_NOISE.sub("", value)


def _subject_keys(label: str, aliases: List[str], kind: str) -> Dict[str, bool]:
    keys: Dict[str, bool] = {}
    normalizer = normalize_math if kind == "notation" else normalize_term
    primary = normalizer(label)
    if primary:
        keys[primary] = True
    for alias in aliases:
        key = normalizer(alias)
        if key and key not in keys:
            keys[key] = False
    return keys


# =============================================================================
# Pipeline nodes
# =============================================================================

def _default_session_factory():
    from backend.app.database.connection import SessionLocal

    return SessionLocal()


def _open_session(state: AlignmentState):
    factory = state.get("session_factory")
    return factory() if factory else _default_session_factory()


def load_member_documents(state: AlignmentState) -> AlignmentState:
    """Load raw KG documents for every member paper; skip papers without a KG."""
    from backend.app.database.models import Paper, ReadingSet

    db = _open_session(state)
    try:
        reading_set = db.query(ReadingSet).filter(ReadingSet.id == state["reading_set_id"]).first()
        if reading_set is None:
            raise ValueError(f"Reading set {state['reading_set_id']} not found")

        memberships = sorted(reading_set.memberships, key=lambda item: item.paper_id)
        total = max(len(memberships), 1)
        _report(state, "load_documents", 0, total)

        documents: Dict[str, Dict[str, Any]] = {}
        skipped: List[Dict[str, str]] = []
        member_paper_ids: List[str] = []
        for index, membership in enumerate(memberships, start=1):
            paper = db.query(Paper).filter(Paper.id == membership.paper_id).first()
            if paper is None:
                continue
            member_paper_ids.append(paper.id)
            if isinstance(paper.knowledge_graph, dict):
                documents[paper.id] = paper.knowledge_graph
            else:
                skipped.append({
                    "paper_id": paper.id,
                    "filename": paper.filename,
                    "reason": "no_knowledge_graph",
                })
            _report(state, "load_documents", index, total)

        state["member_paper_ids"] = member_paper_ids
        state["documents"] = documents
        state["skipped_papers"] = skipped
        return state
    finally:
        db.close()


def _document_profiles(paper_id: str, document: Dict[str, Any]) -> List[SubjectProfile]:
    summaries: Dict[str, str] = {}
    for explanation in document.get("explanations", []):
        if not isinstance(explanation, dict):
            continue
        subject_id = explanation.get("subject_id")
        content = explanation.get("base_content")
        if isinstance(subject_id, str) and isinstance(content, str) and subject_id not in summaries:
            summaries[subject_id] = content[:280]

    profiles: List[SubjectProfile] = []
    for entity in document.get("objects", document.get("entities", [])) or []:
        if not isinstance(entity, dict):
            continue
        subject_id = entity.get("stable_id")
        label = entity.get("label")
        if not (isinstance(subject_id, str) and isinstance(label, str) and label):
            continue
        kind = entity.get("kind") or entity.get("type") or "topic"
        aliases = [alias for alias in entity.get("aliases", []) if isinstance(alias, str)]
        profiles.append(SubjectProfile(
            paper_id=paper_id,
            subject_id=subject_id,
            kind=str(kind),
            label=label,
            aliases=aliases,
            summary=summaries.get(subject_id),
            keys=_subject_keys(label, aliases, str(kind)),
        ))
    for notation in document.get("notation", []) or []:
        if not isinstance(notation, dict):
            continue
        subject_id = notation.get("stable_id")
        symbol = notation.get("symbol")
        if not (isinstance(subject_id, str) and isinstance(symbol, str) and symbol):
            continue
        meaning = notation.get("meaning")
        profiles.append(SubjectProfile(
            paper_id=paper_id,
            subject_id=subject_id,
            kind="notation",
            label=symbol,
            aliases=[],
            summary=meaning if isinstance(meaning, str) else None,
            keys=_subject_keys(symbol, [], "notation"),
        ))
    return profiles


def build_profiles(state: AlignmentState) -> AlignmentState:
    """Convert each KG document into blocking profiles (labels/aliases/math signatures)."""
    documents = state["documents"]
    total = max(len(documents), 1)
    _report(state, "build_profiles", 0, total)

    profiles: Dict[str, List[SubjectProfile]] = {}
    for index, (paper_id, document) in enumerate(sorted(documents.items()), start=1):
        profiles[paper_id] = _document_profiles(paper_id, document)
        _report(state, "build_profiles", index, total)

    state["profiles"] = profiles
    return state


def _pair_id(a: SubjectProfile, b: SubjectProfile) -> Tuple[str, str, str, str]:
    """Canonical identity of a candidate pair (paper_a_id < paper_b_id)."""
    if a.paper_id > b.paper_id:
        a, b = b, a
    return (a.paper_id, a.subject_id, b.paper_id, b.subject_id)


def _oriented(a: SubjectProfile, b: SubjectProfile) -> Tuple[SubjectProfile, SubjectProfile]:
    return (a, b) if a.paper_id < b.paper_id else (b, a)


def deterministic_blocking(state: AlignmentState) -> AlignmentState:
    """Block candidate pairs on shared keys; split unambiguous vs ambiguous."""
    profiles = state["profiles"]
    paper_ids = sorted(profiles)
    paper_pairs = list(combinations(paper_ids, 2))
    total = max(len(paper_pairs), 1)
    _report(state, "blocking", 0, total)

    deterministic: Dict[Tuple[str, str, str, str], AlignmentCandidate] = {}
    ambiguous: Dict[Tuple[str, str, str, str], Tuple[SubjectProfile, SubjectProfile]] = {}

    for index, (paper_a, paper_b) in enumerate(paper_pairs, start=1):
        keyed_a: Dict[str, List[SubjectProfile]] = {}
        keyed_b: Dict[str, List[SubjectProfile]] = {}
        for profile in profiles[paper_a]:
            for key in profile.keys:
                keyed_a.setdefault(key, []).append(profile)
        for profile in profiles[paper_b]:
            for key in profile.keys:
                keyed_b.setdefault(key, []).append(profile)

        for key, side_a in keyed_a.items():
            side_b = keyed_b.get(key)
            if not side_b:
                continue
            if len(side_a) == 1 and len(side_b) == 1 and side_a[0].kind == side_b[0].kind:
                first, second = _oriented(side_a[0], side_b[0])
                exact = side_a[0].keys.get(key, False) and side_b[0].keys.get(key, False)
                candidate = AlignmentCandidate(
                    paper_a_id=first.paper_id,
                    subject_a_id=first.subject_id,
                    label_a=first.label,
                    paper_b_id=second.paper_id,
                    subject_b_id=second.subject_id,
                    label_b=second.label,
                    method="deterministic",
                    score=1.0 if exact else 0.9,
                    confidence="high",
                    rationale=(
                        f'Unique {"label" if exact else "alias"} match on "{key}" '
                        f"with the same kind ({side_a[0].kind})."
                    ),
                )
                pair = _pair_id(side_a[0], side_b[0])
                existing = deterministic.get(pair)
                if existing is None or candidate.score > existing.score:
                    deterministic[pair] = candidate
            else:
                for profile_a, profile_b in product(side_a, side_b):
                    pair = _pair_id(profile_a, profile_b)
                    ambiguous.setdefault(pair, _oriented(profile_a, profile_b))
        _report(state, "blocking", index, total)

    # A pair proven deterministically never needs adjudication, even if another
    # (alias) key also produced it inside an ambiguous bucket.
    pending = {
        pair: subjects
        for pair, subjects in ambiguous.items()
        if pair not in deterministic
    }

    # Bucket ambiguous pairs by paper pair so each LLM call has one coherent
    # context, then apply the bounded budgets.
    buckets: Dict[Tuple[str, str], List[Tuple[SubjectProfile, SubjectProfile]]] = {}
    for pair in sorted(pending):
        first, second = pending[pair]
        bucket = buckets.setdefault((first.paper_id, second.paper_id), [])
        if len(bucket) < MAX_BUCKET_PAIRS:
            bucket.append((first, second))

    budget = MAX_LLM_PAIRS
    bounded: List[List[Tuple[SubjectProfile, SubjectProfile]]] = []
    for key in sorted(buckets):
        bucket = buckets[key][:budget]
        if bucket:
            bounded.append(bucket)
            budget -= len(bucket)
        if budget <= 0:
            break

    state["deterministic_matches"] = [deterministic[pair] for pair in sorted(deterministic)]
    state["ambiguous_buckets"] = bounded
    return state


def _profile_description(profile: SubjectProfile) -> str:
    parts = [f'"{profile.label}" (kind: {profile.kind}, id: {profile.subject_id})']
    if profile.aliases:
        parts.append(f"aliases: {', '.join(profile.aliases[:5])}")
    if profile.summary:
        parts.append(f"definition: {profile.summary}")
    return "; ".join(parts)


def _default_adjudicator(pairs: List[Tuple[SubjectProfile, SubjectProfile]]) -> List[AlignmentVerdict]:
    """Judge one ambiguous bucket with a single structured-output LLM call."""
    from backend.app.agents.utils import run_with_retry
    from backend.app.utils.llm_factory import get_llm, get_structured_llm

    lines = []
    for index, (profile_a, profile_b) in enumerate(pairs, start=1):
        lines.append(
            f"{index}. Paper A subject: {_profile_description(profile_a)}\n"
            f"   Paper B subject: {_profile_description(profile_b)}"
        )
    prompt = (
        "You align terminology between two academic papers. For every candidate "
        "pair below, decide whether the two subjects denote the same concept.\n"
        "A shared name is evidence, not proof: prefer `same=false` with low "
        "confidence when definitions conflict or context is insufficient.\n"
        "Return one verdict per pair, echoing the given subject ids exactly, "
        "with a one-sentence rationale.\n\n"
        "Candidate pairs:\n" + "\n".join(lines)
    )

    llm = get_llm("kg_extraction", max_tokens=2048, temperature=0.0)
    structured = get_structured_llm(llm, AlignmentVerdictBatch)
    result = run_with_retry(structured.invoke, func_args=(prompt,))
    return result.verdicts if isinstance(result, AlignmentVerdictBatch) else []


def llm_adjudicate_ambiguous(state: AlignmentState) -> AlignmentState:
    """Resolve the bounded ambiguous buckets through the (mockable) adjudicator."""
    buckets = state["ambiguous_buckets"]
    total = max(len(buckets), 1)
    _report(state, "adjudication", 0, total)

    adjudicator = state.get("adjudicator") or _default_adjudicator
    matches: List[AlignmentCandidate] = []
    for index, bucket in enumerate(buckets, start=1):
        requested = {
            (first.subject_id, second.subject_id): (first, second)
            for first, second in bucket
        }
        for verdict in adjudicator(bucket):
            pair = requested.get((verdict.subject_a_id, verdict.subject_b_id))
            if pair is None or not verdict.same:
                continue
            first, second = pair
            matches.append(AlignmentCandidate(
                paper_a_id=first.paper_id,
                subject_a_id=first.subject_id,
                label_a=first.label,
                paper_b_id=second.paper_id,
                subject_b_id=second.subject_id,
                label_b=second.label,
                method="llm",
                score={"high": 0.9, "medium": 0.6, "low": 0.3}.get(verdict.confidence, 0.3),
                confidence=verdict.confidence,
                rationale=verdict.rationale,
            ))
        _report(state, "adjudication", index, total)

    state["llm_matches"] = matches
    return state


def persist_alignments(state: AlignmentState) -> AlignmentState:
    """Replace auto rows, keep confirmed/rejected, and mark vanished subjects stale."""
    from backend.app.database.models import EntityAlignment, utcnow

    known_subjects: Dict[str, set[str]] = {
        paper_id: {profile.subject_id for profile in profiles}
        for paper_id, profiles in state["profiles"].items()
    }
    member_ids = set(state["member_paper_ids"])

    candidates = state["deterministic_matches"] + state["llm_matches"]
    _report(state, "persist", 0, max(len(candidates), 1))

    db = _open_session(state)
    try:
        existing = (
            db.query(EntityAlignment)
            .filter(EntityAlignment.reading_set_id == state["reading_set_id"])
            .all()
        )
        preserved_keys: set[Tuple[str, str, str, str]] = set()
        stale_count = 0
        for row in existing:
            key = (row.paper_a_id, row.subject_a_id, row.paper_b_id, row.subject_b_id)
            if row.status not in ("confirmed", "rejected"):
                db.delete(row)
                continue
            if row.paper_a_id not in member_ids or row.paper_b_id not in member_ids:
                db.delete(row)
                continue
            preserved_keys.add(key)
            subjects_a = known_subjects.get(row.paper_a_id)
            subjects_b = known_subjects.get(row.paper_b_id)
            vanished = (
                subjects_a is not None and row.subject_a_id not in subjects_a
            ) or (
                subjects_b is not None and row.subject_b_id not in subjects_b
            )
            if vanished:
                row.status = "stale"
                stale_count += 1

        # Flush deletions first: replacement rows reuse the same unique pair key.
        db.flush()

        created = 0
        for index, candidate in enumerate(candidates, start=1):
            key = (
                candidate.paper_a_id,
                candidate.subject_a_id,
                candidate.paper_b_id,
                candidate.subject_b_id,
            )
            if key in preserved_keys:
                continue
            db.add(EntityAlignment(
                id=str(uuid.uuid4()),
                reading_set_id=state["reading_set_id"],
                paper_a_id=candidate.paper_a_id,
                subject_a_id=candidate.subject_a_id,
                label_a=candidate.label_a,
                paper_b_id=candidate.paper_b_id,
                subject_b_id=candidate.subject_b_id,
                label_b=candidate.label_b,
                method=candidate.method,
                score=candidate.score,
                confidence=candidate.confidence,
                status="auto",
                rationale=candidate.rationale,
                created_at=utcnow(),
            ))
            created += 1
            # Cancellation before the single commit leaves the table untouched.
            _report(state, "persist", index, max(len(candidates), 1))

        db.commit()

        state["summary"] = {
            "alignment_count": created + len(preserved_keys),
            "created_count": created,
            "deterministic_count": sum(
                1 for candidate in candidates if candidate.method == "deterministic"
            ),
            "llm_count": sum(1 for candidate in candidates if candidate.method == "llm"),
            "stale_count": stale_count,
            "skipped_papers": state["skipped_papers"],
        }
        return state
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# =============================================================================
# LangGraph Workflow
# =============================================================================

def create_alignment_workflow() -> StateGraph:
    """Create the reading-set term alignment workflow."""
    workflow = StateGraph(AlignmentState)

    workflow.add_node("load_member_documents", load_member_documents)
    workflow.add_node("build_profiles", build_profiles)
    workflow.add_node("deterministic_blocking", deterministic_blocking)
    workflow.add_node("llm_adjudicate_ambiguous", llm_adjudicate_ambiguous)
    workflow.add_node("persist_alignments", persist_alignments)

    workflow.set_entry_point("load_member_documents")
    workflow.add_edge("load_member_documents", "build_profiles")
    workflow.add_edge("build_profiles", "deterministic_blocking")
    workflow.add_edge("deterministic_blocking", "llm_adjudicate_ambiguous")
    workflow.add_edge("llm_adjudicate_ambiguous", "persist_alignments")
    workflow.add_edge("persist_alignments", END)

    return workflow


def build_alignments_for_reading_set(
    reading_set_id: str,
    *,
    progress_callback=None,
    cancel_check=None,
    adjudicator: Adjudicator | None = None,
    session_factory=None,
) -> Dict[str, Any]:
    """Build entity alignments for a reading set.

    Args:
        reading_set_id: The reading set to link.
        progress_callback: Optional callback function(stage, current, total).
        cancel_check: Optional zero-arg callable returning True once the caller
            wants the build stopped cooperatively; raises
            PaperAlignmentCancelledError from within the running stage.
        adjudicator: Optional replacement for the LLM bucket judge (tests).
        session_factory: Optional SQLAlchemy session factory (tests); defaults
            to the application SessionLocal.

    Returns:
        Summary dict with alignment counts and skipped papers.
    """
    workflow = create_alignment_workflow()
    app = workflow.compile()

    initial_state: AlignmentState = {
        "reading_set_id": reading_set_id,
        "session_factory": session_factory,
        "member_paper_ids": [],
        "documents": {},
        "skipped_papers": [],
        "profiles": {},
        "deterministic_matches": [],
        "ambiguous_buckets": [],
        "llm_matches": [],
        "summary": {},
        "adjudicator": adjudicator,
        "progress_callback": progress_callback,
        "cancel_check": cancel_check,
    }

    result = app.invoke(initial_state)
    return result["summary"]
