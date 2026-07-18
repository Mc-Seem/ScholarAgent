"""Unit tests for cooperative cancellation of knowledge graph builds."""

import pytest

from backend.app.agents import knowledge_graph
from backend.app.agents.knowledge_graph import (
    KnowledgeGraphCancelledError,
    _report_progress,
    build_kg_for_paper,
)


def _base_state(**overrides):
    state = {
        "paper_id": "paper-1",
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [],
        "definition_observations": [],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }
    state.update(overrides)
    return state


def test_report_progress_raises_when_cancel_check_returns_true():
    state = _base_state(cancel_check=lambda: True)

    with pytest.raises(KnowledgeGraphCancelledError):
        _report_progress(state, "symbols", 1, 5)


def test_report_progress_does_not_raise_when_cancel_check_returns_false():
    state = _base_state(cancel_check=lambda: False)

    # Should not raise.
    _report_progress(state, "symbols", 1, 5)


def test_report_progress_still_calls_progress_callback_before_checking_cancel():
    calls = []
    state = _base_state(
        progress_callback=lambda stage, current, total: calls.append((stage, current, total)),
        cancel_check=lambda: False,
    )

    _report_progress(state, "formulas", 2, 4)

    assert calls == [("formulas", 2, 4)]


def test_report_progress_reports_progress_even_when_about_to_cancel():
    # The progress callback should still see the final progress tick before
    # cancellation is raised, so the frontend can show where the build
    # actually stopped.
    calls = []
    state = _base_state(
        progress_callback=lambda stage, current, total: calls.append((stage, current, total)),
        cancel_check=lambda: True,
    )

    with pytest.raises(KnowledgeGraphCancelledError):
        _report_progress(state, "definitions", 3, 3)

    assert calls == [("definitions", 3, 3)]


def test_report_progress_is_backward_compatible_without_cancel_check_key():
    # Existing callers (e.g. tests, older call sites) that never set
    # `cancel_check` must keep working exactly as before.
    state = _base_state()

    _report_progress(state, "theorems", 1, 1)


def test_build_kg_for_paper_threads_cancel_check_into_initial_state(monkeypatch):
    captured = {}

    class FakeApp:
        def invoke(self, state):
            captured["state"] = state
            return {"graph_data": {"nodes": [], "edges": []}, "errors": []}

    class FakeWorkflow:
        def compile(self):
            return FakeApp()

    monkeypatch.setattr(
        knowledge_graph, "create_knowledge_graph_workflow", lambda: FakeWorkflow()
    )

    def cancel_check():
        return False

    build_kg_for_paper("paper-1", cancel_check=cancel_check)

    assert captured["state"]["cancel_check"] is cancel_check


def test_build_kg_for_paper_defaults_cancel_check_to_none(monkeypatch):
    captured = {}

    class FakeApp:
        def invoke(self, state):
            captured["state"] = state
            return {"graph_data": {"nodes": [], "edges": []}, "errors": []}

    class FakeWorkflow:
        def compile(self):
            return FakeApp()

    monkeypatch.setattr(
        knowledge_graph, "create_knowledge_graph_workflow", lambda: FakeWorkflow()
    )

    build_kg_for_paper("paper-1")

    assert captured["state"]["cancel_check"] is None
