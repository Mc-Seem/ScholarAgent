import pytest

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
    reinjected = ai_html_injection.inject_validated_occurrences(injected, occurrences)

    assert injected == reinjected
    assert injected.count('class="kg-entity"') == 2
    assert 'data-occurrence-id="occ-1"' in injected
    assert 'data-subject-id="procedure:supg"' in injected


def test_validated_occurrence_rejects_changed_source_text():
    with pytest.raises(ValueError, match="text mismatch"):
        ai_html_injection.inject_validated_occurrences(
            "<p data-id='p-1'>Changed text</p>",
            [{
                "stable_id": "occ-1",
                "subject_id": "topic:expected",
                "dom_node_id": "p-1",
                "start": 0,
                "end": 8,
                "text": "Expected",
                "scope_id": "sec-1",
            }],
        )