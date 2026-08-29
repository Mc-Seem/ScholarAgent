"""Lazy citation resolution: citation context in paper A -> fragment in paper B.

One structured LLM call per (citation, target paper) pair. The input is the
paragraph context around the in-text `<cite>` in A plus bounded candidates
from B (section titles with their first sentences and top knowledge-graph
subjects with their anchors). The output is validated against B's real HTML:
an anchor the document does not contain degrades to `target_kind='none'`
rather than highlighting a guess.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Literal

from bs4 import BeautifulSoup
from pydantic import BaseModel

# Bounded prompt size: how many citing paragraphs from A and candidates from B
# a single resolution call may include.
MAX_CONTEXT_PARAGRAPHS = 3
MAX_SECTION_CANDIDATES = 30
MAX_SUBJECT_CANDIDATES = 25
FIRST_SENTENCE_CHARS = 240


class CitationResolution(BaseModel):
    target_kind: Literal['section', 'passage', 'none']
    section_id: str | None = None
    dom_node_id: str | None = None
    quote: str | None = None       # exact substring for flash-highlight
    confidence: Literal['high', 'medium', 'low'] = 'low'


# Resolver contract: called with the assembled prompt, returns the raw
# (not yet validated) resolution. Tests inject a fake instead of the LLM.
Resolver = Callable[[str], CitationResolution]


def extract_citation_context(html: str, cite_key: str) -> str:
    """Collect the paragraphs of A that cite `cite_key` (via `#bib.<key>` anchors)."""
    if not html:
        return ""
    soup = BeautifulSoup(html, 'html.parser')
    fragment = f"#bib.{cite_key}"
    paragraphs: List[str] = []
    seen: set[str] = set()
    for anchor in soup.find_all('a', href=fragment):
        container = anchor.find_parent(['p', 'li', 'div', 'figcaption', 'td'])
        text = (container or anchor).get_text(separator=' ', strip=True)
        if text and text not in seen:
            seen.add(text)
            paragraphs.append(text)
        if len(paragraphs) >= MAX_CONTEXT_PARAGRAPHS:
            break
    return "\n\n".join(paragraphs)


def _first_sentence(content_html: str) -> str:
    text = BeautifulSoup(content_html or "", 'html.parser').get_text(separator=' ', strip=True)
    match = re.search(r"^.*?[.!?](?:\s|$)", text)
    sentence = match.group(0).strip() if match else text
    return sentence[:FIRST_SENTENCE_CHARS]


def build_target_candidates(target_paper: Any) -> Dict[str, List[Dict[str, str]]]:
    """Bounded candidate anchors from B: sections and top KG subjects."""
    sections: List[Dict[str, str]] = []
    for section in (target_paper.sections_data or [])[:MAX_SECTION_CANDIDATES]:
        if not isinstance(section, dict) or not section.get('id'):
            continue
        sections.append({
            'section_id': str(section['id']),
            'title': str(section.get('title') or ''),
            'first_sentence': _first_sentence(section.get('content_html') or ''),
        })

    subjects: List[Dict[str, str]] = []
    document = target_paper.knowledge_graph if isinstance(target_paper.knowledge_graph, dict) else {}
    anchors: Dict[str, Dict[str, str]] = {}
    for occurrence in document.get('occurrences', []) or []:
        if not isinstance(occurrence, dict):
            continue
        subject_id = occurrence.get('subject_id')
        dom_node_id = occurrence.get('dom_node_id')
        if isinstance(subject_id, str) and isinstance(dom_node_id, str) and subject_id not in anchors:
            anchors[subject_id] = {
                'dom_node_id': dom_node_id,
                'section_id': str(occurrence.get('scope_id') or ''),
            }
    for entity in (document.get('objects', document.get('entities', [])) or [])[:MAX_SUBJECT_CANDIDATES]:
        if not isinstance(entity, dict):
            continue
        subject_id = entity.get('stable_id')
        label = entity.get('label')
        if not (isinstance(subject_id, str) and isinstance(label, str) and label):
            continue
        anchor = anchors.get(subject_id, {})
        subjects.append({
            'label': label,
            'kind': str(entity.get('kind') or entity.get('type') or 'topic'),
            'dom_node_id': anchor.get('dom_node_id', ''),
            'section_id': anchor.get('section_id', ''),
        })

    return {'sections': sections, 'subjects': subjects}


def build_resolution_prompt(
    citation_context: str,
    bib_text: str,
    candidates: Dict[str, List[Dict[str, str]]],
) -> str:
    """Assemble the single structured-output prompt for one resolution."""
    section_lines = [
        f"- section_id={section['section_id']}: \"{section['title']}\""
        + (f" — {section['first_sentence']}" if section['first_sentence'] else "")
        for section in candidates['sections']
    ]
    subject_lines = [
        f"- \"{subject['label']}\" (kind: {subject['kind']}"
        + (f", dom_node_id={subject['dom_node_id']}" if subject['dom_node_id'] else "")
        + (f", section_id={subject['section_id']}" if subject['section_id'] else "")
        + ")"
        for subject in candidates['subjects']
    ]
    return (
        "A reader clicked a citation in paper A that references paper B. "
        "Decide which part of paper B the citing text actually refers to.\n"
        "Prefer `target_kind='section'` with one of the listed section_ids. Use "
        "`target_kind='passage'` only when a listed dom_node_id clearly matches, "
        "and include an exact short quote from that passage if you can. When "
        "nothing in paper B clearly matches, return `target_kind='none'` — a "
        "wrong anchor is worse than no anchor.\n"
        "Only use section_ids and dom_node_ids listed below; never invent them.\n\n"
        f"Bibliography entry in paper A:\n{bib_text}\n\n"
        f"Citing context in paper A:\n{citation_context or '(no citing paragraph found)'}\n\n"
        "Paper B sections:\n" + ("\n".join(section_lines) or "(none)") + "\n\n"
        "Paper B key subjects:\n" + ("\n".join(subject_lines) or "(none)")
    )


def _default_resolver(prompt: str) -> CitationResolution:
    """Resolve with a single structured-output LLM call."""
    from backend.app.agents.utils import run_with_retry
    from backend.app.utils.llm_factory import get_llm, get_structured_llm

    llm = get_llm("kg_extraction", max_tokens=1024, temperature=0.0)
    structured = get_structured_llm(llm, CitationResolution)
    result = run_with_retry(structured.invoke, func_args=(prompt,))
    if isinstance(result, CitationResolution):
        return result
    return CitationResolution(target_kind='none', confidence='low')


def validate_resolution(resolution: CitationResolution, target_paper: Any) -> CitationResolution:
    """Ground the LLM answer in B's real document; unknown anchors become 'none'."""
    none = CitationResolution(target_kind='none', confidence=resolution.confidence)
    if resolution.target_kind == 'none':
        return none

    html = target_paper.html_content or ""
    soup = BeautifulSoup(html, 'html.parser')

    if resolution.target_kind == 'section':
        section_id = resolution.section_id
        known_ids = {
            str(section.get('id'))
            for section in (target_paper.sections_data or [])
            if isinstance(section, dict) and section.get('id')
        }
        if not section_id or (section_id not in known_ids
                              and soup.find(attrs={'data-id': section_id}) is None):
            return none
        return CitationResolution(
            target_kind='section',
            section_id=section_id,
            dom_node_id=resolution.dom_node_id if _node_exists(soup, resolution.dom_node_id) else None,
            quote=None,
            confidence=resolution.confidence,
        )

    # passage: the DOM node must exist; the quote must be a real substring of it.
    node = soup.find(attrs={'data-id': resolution.dom_node_id}) if resolution.dom_node_id else None
    if node is None:
        return none
    quote = resolution.quote
    if quote and quote not in node.get_text():
        quote = None
    return CitationResolution(
        target_kind='passage',
        section_id=resolution.section_id,
        dom_node_id=resolution.dom_node_id,
        quote=quote,
        confidence=resolution.confidence,
    )


def _node_exists(soup: BeautifulSoup, dom_node_id: str | None) -> bool:
    return bool(dom_node_id) and soup.find(attrs={'data-id': dom_node_id}) is not None


def resolve_citation(
    source_paper: Any,
    cite_key: str,
    bib_text: str,
    target_paper: Any,
    *,
    resolver: Resolver | None = None,
) -> CitationResolution:
    """Resolve one citation of A against B and validate the returned anchor."""
    citation_context = extract_citation_context(source_paper.html_content or "", cite_key)
    candidates = build_target_candidates(target_paper)
    prompt = build_resolution_prompt(citation_context, bib_text, candidates)
    resolution = (resolver or _default_resolver)(prompt)
    return validate_resolution(resolution, target_paper)
