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


def test_anchoring_skips_offsets_that_point_inside_a_formula():
    """An anchor inside <math> rewrites the TeX source the reader renders.

    LaTeXML stores the source of every formula in an ``<annotation>`` child, so
    plain-text matching finds ``KTO`` inside ``\\mathcal{L}_{KTO}``. Wrapping it
    truncated the formula in the reader.
    """
    html = (
        "<p data-id='p-1'>The objective <math data-id='m-1'>"
        "<annotation encoding='application/x-tex'>\\mathcal{L}_{KTO}</annotation>"
        "</math> is used.</p>"
    )
    result = ai_html_injection.inject_validated_occurrences(html, [{
        "stable_id": "occ-1", "subject_id": "artifact:kto", "dom_node_id": "m-1",
        "start": 14, "end": 17, "text": "KTO", "scope_id": "sec-1",
    }])

    assert result.anchored == 0
    assert result.skipped == ["occ-1: node m-1 is a formula"]
    assert "\\mathcal{L}_{KTO}" in result.html


def test_an_anchor_left_inside_a_formula_is_removed():
    """Earlier builds produced such anchors, and only unwrapping undoes them."""
    html = (
        "<p data-id='p-1'>See <math data-id='m-1'>"
        "<annotation encoding='application/x-tex'>\\mathcal{L}_{"
        "<span class=\"kg-entity\" data-occurrence-id=\"old\" data-subject-id=\"artifact:kto\">KTO</span>"
        "}</annotation></math>.</p>"
    )

    result = ai_html_injection.inject_validated_occurrences(html, [])

    assert result.repaired == 1
    assert "\\mathcal{L}_{KTO}" in result.html
    assert "kg-entity" not in result.html


def test_offsets_survive_anchors_added_by_an_earlier_apply():
    """Applying drafts one batch at a time must not shift the remaining anchors.

    Offsets are measured over the paper's full text, so anchored words have to
    keep counting; excluding them made every later occurrence in the same node
    look like moved text.
    """
    html = "<p data-id='p-1'>DPO and KTO differ.</p>"
    first = ai_html_injection.inject_validated_occurrences(html, [{
        "stable_id": "occ-1", "subject_id": "artifact:dpo", "dom_node_id": "p-1",
        "start": 0, "end": 3, "text": "DPO", "scope_id": "sec-1",
    }])

    second = ai_html_injection.inject_validated_occurrences(first.html, [{
        "stable_id": "occ-2", "subject_id": "artifact:kto", "dom_node_id": "p-1",
        "start": 8, "end": 11, "text": "KTO", "scope_id": "sec-1",
    }])

    assert second.anchored == 1
    assert second.skipped == []
    assert [element.get_text() for element in _entities(second.html)] == ["DPO", "KTO"]


def test_a_range_already_claimed_by_another_subject_is_reported():
    html = "<p data-id='p-1'>Kahneman-Tversky Optimization matters.</p>"
    first = ai_html_injection.inject_validated_occurrences(html, [{
        "stable_id": "occ-1", "subject_id": "procedure:kto", "dom_node_id": "p-1",
        "start": 0, "end": 29, "text": "Kahneman-Tversky Optimization", "scope_id": "sec-1",
    }])

    second = ai_html_injection.inject_validated_occurrences(first.html, [{
        "stable_id": "occ-2", "subject_id": "topic:optimization", "dom_node_id": "p-1",
        "start": 17, "end": 29, "text": "Optimization", "scope_id": "sec-1",
    }])

    assert second.anchored == 0
    assert second.skipped == ["occ-2: already annotated for another subject"]


def _entities(html):
    from bs4 import BeautifulSoup

    return BeautifulSoup(html, "html.parser").select("span.kg-entity")