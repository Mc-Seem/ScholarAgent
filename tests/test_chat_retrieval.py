"""Focused tests for article chat corpus construction and retrieval gating."""

import json
from pathlib import Path

import pytest

from backend.app.agents.chat_retrieval import build_chat_corpus, retrieve_chat_evidence
from backend.app.agents.knowledge_graph_models import NotationRecord
from backend.app.agents.knowledge_graph_retrieval import build_fixture_document


def test_corpus_maps_data_ids_to_sections_and_preserves_unicode_mathml():
    html = """
    <article>
      <section data-id="section-dom">
        <h2 data-id="heading">Метод π</h2>
        <p data-id="paragraph">The objective is bounded by λ.</p>
        <math data-id="equation"><mrow><mi>λ</mi><mo>≤</mo><mi>π</mi></mrow></math>
      </section>
    </article>
    """
    sections = [{
        "id": "sec-method",
        "title": "Method",
        "content_html": html,
    }]

    corpus = build_chat_corpus(html, sections)
    by_id = {item["id"]: item for item in corpus}

    assert by_id["paragraph"]["section_id"] == "sec-method"
    assert by_id["paragraph"]["section_title"] == "Method"
    assert by_id["equation"]["text"] == "λ ≤ π"
    assert "Метод π" in by_id["heading"]["text"]


def test_corpus_handles_empty_html_and_deduplicates_nested_blocks():
    assert build_chat_corpus("", []) == []
    corpus = build_chat_corpus(
        '<section data-id="s"><p data-id="p">Only one passage.</p></section>',
        [],
    )
    assert [item["id"] for item in corpus] == ["p"]


def test_retrieval_is_passage_first_and_graph_expansion_is_explicit(fixture_document_data):
    document, corpus = fixture_document_data

    passage = retrieve_chat_evidence(
        "What is the ELBO?",
        corpus,
        document=document,
        use_graph=False,
    )
    hybrid = retrieve_chat_evidence(
        "What does the ELBO depend on?",
        corpus,
        document=document,
        use_graph=True,
    )

    assert passage.used_graph is False
    assert passage.graph_available is True
    assert not any(item.kind == "entity" for item in passage.evidence)
    assert hybrid.used_graph is True
    assert hybrid.expansion_depth <= 1
    assert any(item.kind == "entity" for item in hybrid.evidence)
    assert len(hybrid.evidence) <= 12


def test_graph_evidence_supports_notation_subjects(fixture_document_data):
    document, corpus = fixture_document_data
    observation_id = next(
        item.id for item in document.observations if item.source.dom_node_id == "eq-elbo"
    )
    document = document.model_copy(update={
        "notation": [NotationRecord(
            stable_id="notation:q",
            symbol="q",
            meaning="variational posterior",
            scope_id="sec-method",
            evidence_ids=[observation_id],
        )],
    })

    result = retrieve_chat_evidence(
        "What does this notation mean?",
        corpus,
        document=document,
        context={"kind": "entity", "subject_id": "notation:q"},
    )

    assert result.used_graph is True
    assert any(item.subject_id == "notation:q" for item in result.evidence)


def test_entity_context_survives_passage_evidence_budget(fixture_document_data):
    document, corpus = fixture_document_data
    observation_id = next(
        item.id for item in document.observations if item.source.dom_node_id == "eq-elbo"
    )
    document = document.model_copy(update={
        "notation": [NotationRecord(
            stable_id=f"notation:distractor-{index}",
            symbol=f"d_{index}",
            meaning="distractor notation",
            scope_id="sec-method",
            evidence_ids=[observation_id],
        ) for index in range(6)],
    })
    large_corpus = [
        {**item, "text": f"ELBO {item['text']} " + ("evidence " * 500)}
        for item in corpus
    ]

    result = retrieve_chat_evidence(
        "Make this definition more specific",
        large_corpus,
        document=document,
        context={"kind": "entity", "subject_id": "quantity:elbo"},
    )

    assert any(item.subject_id == "quantity:elbo" for item in result.evidence)


def test_graph_request_falls_back_to_passages_without_active_document():
    corpus = [{
        "id": "p-1",
        "text": "A phrase that does not occur in any knowledge graph.",
        "section_id": "sec-1",
        "section_title": "Introduction",
        "kind": "p",
    }]

    result = retrieve_chat_evidence("Explain the phrase", corpus, document=None, use_graph=True)

    assert result.graph_available is False
    assert result.used_graph is False
    assert result.evidence[0].source_id == "p-1"


def test_malformed_canonical_graph_is_treated_as_unavailable():
    corpus = [{
        "id": "p-1",
        "text": "Passage evidence.",
        "section_id": "sec-1",
        "section_title": "Introduction",
        "kind": "p",
    }]

    result = retrieve_chat_evidence(
        "Passage",
        corpus,
        document={"schema_version": "3.0", "objects": "invalid"},
        use_graph=True,
    )

    assert result.graph_available is False
    assert result.used_graph is False


def test_selection_and_section_context_are_included_once_and_bounded():
    corpus = [
        {
            "id": f"p-{index}",
            "text": (
                ("exact selected phrase " if index == 0 else "")
                + ("evidence " * 500)
                + str(index)
            ),
            "section_id": "sec-current" if index < 2 else "sec-other",
            "section_title": "Current" if index < 2 else "Other",
            "kind": "p",
        }
        for index in range(10)
    ]
    context = {
        "kind": "selection",
        "data_id": "p-0",
        "section_id": "sec-current",
        "quote": "exact selected phrase",
    }

    result = retrieve_chat_evidence("evidence", corpus, context=context)

    assert result.evidence[0].text == "exact selected phrase"
    assert sum(item.source_id == "p-0" for item in result.evidence) == 1
    assert sum(len(item.text) for item in result.evidence) <= 12_000


def test_retrieval_includes_adjacent_formulas_from_matching_section():
    corpus = [
        {
            "id": "kto-heading",
            "text": "Kahneman-Tversky Optimization (KTO)",
            "section_id": "sec-kto",
            "section_title": "Kahneman-Tversky Optimization",
            "kind": "h2",
        },
        {
            "id": "kto-intro",
            "text": "The KTO loss is defined as an expectation of the per-sample loss:",
            "section_id": "sec-kto",
            "section_title": "Kahneman-Tversky Optimization",
            "kind": "p",
        },
        {
            "id": "kto-loss",
            "text": "L KTO pi theta pi ref equals E l KTO y w",
            "section_id": "sec-kto",
            "section_title": "Kahneman-Tversky Optimization",
            "kind": "math",
        },
        {
            "id": "kto-per-sample",
            "text": "l KTO y w equals one minus v KTO y w if y desirable",
            "section_id": "sec-kto",
            "section_title": "Kahneman-Tversky Optimization",
            "kind": "math",
        },
        *[
            {
                "id": f"other-{index}",
                "text": f"KTO loss baseline comparison result {index}",
                "section_id": f"sec-other-{index}",
                "section_title": "Experiments",
                "kind": "p",
            }
            for index in range(6)
        ],
    ]

    result = retrieve_chat_evidence("What is the formula for KTO loss?", corpus)

    source_ids = {item.source_id for item in result.evidence}
    assert {"kto-loss", "kto-per-sample"} <= source_ids


@pytest.fixture
def fixture_document_data():
    path = Path(__file__).parent / "fixtures" / "knowledge_graph_baseline.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return build_fixture_document(data), data["retrieval_corpus"]