from backend.app.compiler import ai_html_injection


class _FakePrompt:
    def __or__(self, _other):
        return _FakeChain()


class _FakeChain:
    def invoke(self, _args):
        return ai_html_injection.SectionInjectionOutput(injections=[], reasoning="none")


def test_process_sections_reports_each_completed_work_item(monkeypatch):
    monkeypatch.setattr(
        ai_html_injection.ChatPromptTemplate,
        "from_messages",
        lambda _messages: _FakePrompt(),
    )
    monkeypatch.setattr(ai_html_injection, "get_llm", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(ai_html_injection, "get_structured_llm", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(ai_html_injection, "_get_worker_count", lambda: 1)
    monkeypatch.setattr(
        ai_html_injection,
        "filter_processable_sections",
        lambda sections: sections,
    )

    progress = []
    state = {
        "html_content": '<section data-id="sec"><p>Text</p></section>',
        "sections_data": [{"id": "sec", "title": "Section", "content_html": "<p>Text</p>"}],
        "suggestions": [],
        "entities": [
            {"label": f"term-{index}", "entity_id": f"entity-{index}", "entity_type": "definition"}
            for index in range(11)
        ],
        "current_html": '<section data-id="sec"><p>Text</p></section>',
        "sections_processed": 0,
        "sections_total": 1,
        "modified_html": "",
        "injection_count": 0,
        "errors": [],
        "progress_callback": lambda current, total: progress.append((current, total)),
    }

    ai_html_injection.process_sections(state)

    assert progress == [(1, 2), (2, 2)]


def test_validated_occurrences_are_injected_without_llm_and_are_idempotent(monkeypatch):
    monkeypatch.setattr(
        ai_html_injection,
        "get_llm",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("LLM must not be called")),
    )
    html = "<article><p data-id='p-1'>SUPG stabilizes transport. SUPG uses tau.</p></article>"
    occurrences = [
        {"stable_id": "occ-1", "subject_id": "procedure:supg", "dom_node_id": "p-1", "start": 0, "end": 4, "text": "SUPG", "scope_id": "sec-1"},
        {"stable_id": "occ-2", "subject_id": "procedure:supg", "dom_node_id": "p-1", "start": 27, "end": 31, "text": "SUPG", "scope_id": "sec-1"},
    ]

    injected = ai_html_injection.inject_validated_occurrences(html, occurrences)
    reinjected = ai_html_injection.inject_validated_occurrences(injected.html, occurrences)

    assert injected.anchored == 2
    assert reinjected.anchored == 0
    assert injected.html == reinjected.html
    assert injected.html.count('class="kg-entity"') == 2
    assert 'data-occurrence-id="occ-1"' in injected.html
    assert 'data-subject-id="procedure:supg"' in injected.html


def test_occurrence_split_by_inline_markup_is_still_anchored():
    """LaTeXML breaks acronym expansions into separate inline tags.

    ``SLIME (Stabilized Likelihood Implicit Margin Enforcement)`` arrives with
    each highlighted initial in its own element, so an anchor that must live in a
    single text node would drop exactly the paper's central term.
    """
    html = (
        "<p data-id='p-1'>We propose ("
        "<span class='ltx_text'>S</span>tabilized "
        "<span class='ltx_text'>L</span>ikelihood).</p>"
    )
    result = ai_html_injection.inject_validated_occurrences(html, [{
        "stable_id": "occ-1",
        "subject_id": "artifact:slime",
        "dom_node_id": "p-1",
        "start": 12,
        "end": 33,
        "text": "Stabilized Likelihood",
        "scope_id": "sec-1",
    }])

    assert result.anchored == 1
    assert result.skipped == []
    parts = _entities(result.html)
    assert len(parts) == 4
    assert "".join(element.get_text() for element in parts) == "Stabilized Likelihood"
    assert [element.get("data-occurrence-part") for element in parts] == [
        "first", "inner", "inner", "last",
    ]


def test_stale_occurrence_is_skipped_without_losing_the_others():
    """One anchor pointing at moved text must not cost the reader every anchor."""
    html = "<p data-id='p-1'>SUPG stabilizes transport.</p><p data-id='p-2'>Gone.</p>"
    result = ai_html_injection.inject_validated_occurrences(html, [
        {"stable_id": "occ-1", "subject_id": "procedure:supg", "dom_node_id": "p-1",
         "start": 0, "end": 4, "text": "SUPG", "scope_id": "sec-1"},
        {"stable_id": "occ-2", "subject_id": "topic:expected", "dom_node_id": "p-2",
         "start": 0, "end": 8, "text": "Expected", "scope_id": "sec-1"},
        {"stable_id": "occ-3", "subject_id": "topic:expected", "dom_node_id": "p-404",
         "start": 0, "end": 8, "text": "Expected", "scope_id": "sec-1"},
    ])

    assert result.anchored == 1
    assert 'data-occurrence-id="occ-1"' in result.html
    assert [reason.split(": ", 1)[0] for reason in result.skipped] == ["occ-2", "occ-3"]
    assert "text moved" in result.skipped[0]
    assert "no longer in the HTML" in result.skipped[1]


def _entities(html):
    from bs4 import BeautifulSoup

    return BeautifulSoup(html, "html.parser").select("span.kg-entity")