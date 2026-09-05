"""Reference suggestions for a reading set from its members' bibliographies.

Pipeline: collect_candidate_references -> fetch_arxiv_metadata -> LLM ranking.

Candidate arXiv ids are extracted from each member paper's `citations_data`,
deduplicated across papers (version-insensitive), and capped preferring the
references cited by multiple member papers. Titles and abstracts come from one
batched arXiv API call; a single structured-output LLM call then ranks every
candidate's relevance to the set. An LLM failure degrades gracefully: the
candidates are still returned, marked "medium" / "Ranking unavailable".
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Literal, Tuple

import httpx
from pydantic import BaseModel, Field

from backend.app.api.citation_routes import extract_arxiv_id_from_text
from backend.app.database.models import Paper

ARXIV_API_URL = "https://export.arxiv.org/api/query"
ARXIV_API_TIMEOUT = 30.0

# Prompt size bounds: candidate abstracts are truncated before ranking.
ABSTRACT_PROMPT_CHARS = 1500

_ATOM_NS = "{http://www.w3.org/2005/Atom}"

Relevance = Literal["high", "medium", "low"]

# Sort order for the final suggestion list (high -> medium -> low).
_RELEVANCE_ORDER = {"high": 0, "medium": 1, "low": 2}


class ReferenceRanking(BaseModel):
    """LLM judgement for one candidate reference."""

    arxiv_id: str
    relevance: Relevance
    reason: str = Field(description="One short sentence; shown in the import picker.")


class ReferenceRankingBatch(BaseModel):
    """Structured output wrapper: one ranking per candidate."""

    rankings: List[ReferenceRanking]


@dataclass
class ReferenceCandidate:
    """One referenced arXiv paper that is not yet in the reading set."""

    arxiv_id: str  # normalized: lowercase, version suffix stripped
    cited_by_paper_ids: List[str] = field(default_factory=list)
    title: str = ""
    abstract: str = ""
    relevance: str = "medium"
    reason: str = ""


@dataclass
class ReferenceSuggestionResult:
    """Ranked suggestions plus the member papers that contributed nothing."""

    suggestions: List[ReferenceCandidate]
    skipped_papers: List[Dict[str, str]]


# Ranker contract: called once with the member paper summaries and the resolved
# candidates; returns rankings for those candidates. Tests inject a fake.
Ranker = Callable[[List[str], List[ReferenceCandidate]], List[ReferenceRanking]]


def normalize_arxiv_id(value: str) -> str:
    """Version-insensitive arXiv id for comparisons (2401.12345v2 -> 2401.12345)."""
    return re.sub(r"v[0-9]+$", "", value.strip().lower())


def collect_candidate_references(
    db_papers: List[Paper],
    max_candidates: int = 25,
) -> Tuple[List[ReferenceCandidate], List[Dict[str, str]]]:
    """Extract deduplicated arXiv reference candidates from member bibliographies.

    References matching a member paper's own arxiv_id are excluded. When the
    cap bites, candidates cited by more member papers win (stable order
    otherwise). Papers without citations_data are reported as skipped.
    """
    member_arxiv_ids = {
        normalize_arxiv_id(paper.arxiv_id)
        for paper in db_papers
        if isinstance(paper.arxiv_id, str) and paper.arxiv_id.strip()
    }

    candidates: Dict[str, ReferenceCandidate] = {}
    skipped: List[Dict[str, str]] = []
    for paper in db_papers:
        citations = paper.citations_data if isinstance(paper.citations_data, list) else []
        if not citations:
            skipped.append({"paper_id": paper.id, "reason": "no_citations"})
            continue
        for entry in citations:
            if not isinstance(entry, dict):
                continue
            text = entry.get("text")
            if not isinstance(text, str):
                continue
            arxiv_id = extract_arxiv_id_from_text(text)
            if not arxiv_id:
                continue
            normalized = normalize_arxiv_id(arxiv_id)
            if normalized in member_arxiv_ids:
                continue
            candidate = candidates.setdefault(
                normalized, ReferenceCandidate(arxiv_id=normalized)
            )
            if paper.id not in candidate.cited_by_paper_ids:
                candidate.cited_by_paper_ids.append(paper.id)

    # Stable sort: multi-cited candidates first, insertion order within ties.
    ordered = sorted(
        candidates.values(),
        key=lambda candidate: -len(candidate.cited_by_paper_ids),
    )
    return ordered[:max_candidates], skipped


def fetch_arxiv_metadata(arxiv_ids: List[str]) -> Dict[str, Dict[str, str]]:
    """Batch-fetch title + abstract for the given ids from the arXiv API.

    Mirrors the Atom parsing in `get_arxiv_metadata` (api/main.py). Entries the
    API does not return (withdrawn/malformed ids) are silently absent from the
    result; network and parse errors propagate to the caller.
    """
    if not arxiv_ids:
        return {}
    with httpx.Client(follow_redirects=True, timeout=ARXIV_API_TIMEOUT) as client:
        response = client.get(ARXIV_API_URL, params={"id_list": ",".join(arxiv_ids)})
        response.raise_for_status()
    root = ET.fromstring(response.text)

    metadata: Dict[str, Dict[str, str]] = {}
    for entry in root.findall(f"{_ATOM_NS}entry"):
        entry_id = entry.findtext(f"{_ATOM_NS}id") or ""
        match = re.search(r"([0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?", entry_id)
        if not match:
            continue
        title = " ".join((entry.findtext(f"{_ATOM_NS}title") or "").split())
        summary = " ".join((entry.findtext(f"{_ATOM_NS}summary") or "").split())
        if not title:
            continue
        metadata[normalize_arxiv_id(match.group(1))] = {
            "title": title,
            "abstract": summary,
        }
    return metadata


def _member_summaries(db_papers: List[Paper]) -> List[str]:
    """One prompt line per member paper: title (falling back to filename) + abstract."""
    summaries: List[str] = []
    for paper in db_papers:
        metadata = paper.paper_metadata if isinstance(paper.paper_metadata, dict) else {}
        title = metadata.get("title")
        abstract = metadata.get("abstract")
        line = title if isinstance(title, str) and title.strip() else paper.filename
        if isinstance(abstract, str) and abstract.strip():
            line = f"{line} — {abstract[:ABSTRACT_PROMPT_CHARS]}"
        summaries.append(line)
    return summaries


def _default_ranker(
    member_summaries: List[str],
    candidates: List[ReferenceCandidate],
) -> List[ReferenceRanking]:
    """Rank all candidates with a single structured-output LLM call."""
    from backend.app.agents.utils import run_with_retry
    from backend.app.utils.llm_factory import get_llm, get_structured_llm

    member_lines = [f"- {summary}" for summary in member_summaries]
    candidate_lines = []
    for index, candidate in enumerate(candidates, start=1):
        candidate_lines.append(
            f"{index}. arxiv_id: {candidate.arxiv_id}\n"
            f"   title: {candidate.title}\n"
            f"   abstract: {candidate.abstract[:ABSTRACT_PROMPT_CHARS]}"
        )
    prompt = (
        "You curate a reading set of academic papers. Rank how relevant each "
        "candidate reference below is to the reading set as a whole.\n"
        "Return one ranking per candidate, echoing the given arxiv_id exactly, "
        'with relevance "high", "medium", or "low" and a one-sentence reason.\n\n'
        "Reading set papers:\n" + "\n".join(member_lines) + "\n\n"
        "Candidate references:\n" + "\n".join(candidate_lines)
    )

    llm = get_llm("kg_extraction", max_tokens=4096, temperature=0.0)
    structured = get_structured_llm(llm, ReferenceRankingBatch)
    result = run_with_retry(structured.invoke, func_args=(prompt,))
    return result.rankings if isinstance(result, ReferenceRankingBatch) else []


def suggest_references(
    db_papers: List[Paper],
    max_candidates: int = 25,
    *,
    ranker: Ranker | None = None,
) -> ReferenceSuggestionResult:
    """Suggest referenced arXiv papers to import into a reading set.

    Args:
        db_papers: The set's member papers (with citations_data/paper_metadata).
        max_candidates: Cap on how many candidate references are considered.
        ranker: Optional replacement for the LLM relevance ranker (tests).

    Returns:
        Ranked suggestions (high -> medium -> low, then citing-paper count
        descending) and the member papers skipped for having no citations.
    """
    candidates, skipped = collect_candidate_references(db_papers, max_candidates)
    if not candidates:
        return ReferenceSuggestionResult(suggestions=[], skipped_papers=skipped)

    metadata = fetch_arxiv_metadata([candidate.arxiv_id for candidate in candidates])
    resolved: List[ReferenceCandidate] = []
    for candidate in candidates:
        entry = metadata.get(candidate.arxiv_id)
        if entry is None:
            continue  # tolerate ids the arXiv API did not return
        candidate.title = entry["title"]
        candidate.abstract = entry["abstract"]
        resolved.append(candidate)
    if not resolved:
        return ReferenceSuggestionResult(suggestions=[], skipped_papers=skipped)

    rank = ranker or _default_ranker
    try:
        rankings = rank(_member_summaries(db_papers), resolved)
    except Exception:  # noqa: BLE001 - ranking is best-effort, never fatal
        rankings = []
    rankings_by_id = {
        normalize_arxiv_id(ranking.arxiv_id): ranking for ranking in rankings
    }
    for candidate in resolved:
        ranking = rankings_by_id.get(candidate.arxiv_id)
        if ranking is not None:
            candidate.relevance = ranking.relevance
            candidate.reason = ranking.reason
        else:
            candidate.relevance = "medium"
            candidate.reason = "Ranking unavailable"

    resolved.sort(
        key=lambda candidate: (
            _RELEVANCE_ORDER.get(candidate.relevance, 1),
            -len(candidate.cited_by_paper_ids),
        )
    )
    return ReferenceSuggestionResult(suggestions=resolved, skipped_papers=skipped)
