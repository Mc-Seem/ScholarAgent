from backend.app.agents.knowledge_graph_canonical import (
    anchor_equation_observations,
    canonicalize_observations,
    stable_identifier,
)
from backend.app.agents.knowledge_graph_models import SourceObservation, SourceReference
from backend.app.agents import knowledge_graph as knowledge_graph_module


def _observation(observation_id, kind, label, payload, section="sec-1"):
    return SourceObservation(
        id=observation_id,
        kind=kind,
        label=label,
        payload=payload,
        confidence=0.9,
        source=SourceReference(
            paper_id="paper-1",
            section_id=section,
            dom_node_id=f"dom-{observation_id}",
            quote=payload.get("summary", label),
        ),
    )


def test_stable_identifier_ignores_extraction_order_and_presentation_noise():
    first = stable_identifier("formula", "ELBO", math_signature="\\mathcal{L} = x", scope="paper-1")
    second = stable_identifier("formula", "ELBO", math_signature=" \\mathcal L=x ", scope="paper-1")

    assert first == second


def test_equations_are_anchored_to_compiler_ids_and_sections():
    equations = [
        {"id": "eq-display", "latex": "L(q)=E_q[f]", "is_display": True, "mathml": "<math data-id='eq-display' />"},
        {"id": "eq-inline", "latex": "x", "is_display": False, "mathml": "<math data-id='eq-inline' />"},
    ]
    sections = [{"id": "sec-method", "title": "Method", "content_html": "<p><math data-id='eq-display'></math></p>"}]

    observations = anchor_equation_observations("paper-1", sections, equations)

    assert len(observations) == 1
    assert observations[0].source.equation_id == "eq-display"
    assert observations[0].source.section_id == "sec-method"
    assert observations[0].payload["latex"] == "L(q)=E_q[f]"
    assert {symbol["symbol"] for symbol in observations[0].payload["symbols"]} >= {"L", "q"}


def test_canonicalization_preserves_aliases_evidence_and_demotes_local_symbols():
    observations = [
        _observation("obs-concept-1", "concept", "Evidence lower bound", {"summary": "Variational objective", "aliases": ["ELBO"]}),
        _observation("obs-concept-2", "concept", "ELBO", {"summary": "Variational objective", "aliases": ["Evidence lower bound"]}),
        _observation("obs-formula", "formula", "ELBO", {
            "summary": "Variational objective",
            "latex": "L(q)=E_q[f]",
            "symbols": [
                {"symbol": "q", "role": "variational posterior", "explicitly_defined": False},
                {"symbol": "L", "role": "objective", "explicitly_defined": True},
            ],
        }),
    ]

    document = canonicalize_observations("paper-1", observations)

    concepts = [entity for entity in document.entities if entity.type == "concept"]
    symbols = [entity for entity in document.entities if entity.type == "symbol"]
    formula = next(entity for entity in document.entities if entity.type == "formula")
    assert len(concepts) == 1
    assert set(concepts[0].aliases) == {"ELBO"}
    assert set(concepts[0].observation_ids) == {"obs-concept-1", "obs-concept-2"}
    assert [entity.label for entity in symbols] == ["L"]
    symbol_facet = next(facet for facet in formula.facets if facet.kind == "symbols")
    assert {symbol["symbol"] for symbol in symbol_facet.payload["items"]} == {"q", "L"}


def test_recurrent_symbol_is_promoted_only_across_important_formulas():
    observations = [
        _observation("formula-1", "formula", "Objective", {"latex": "L(q)", "summary": "Objective", "symbols": [{"symbol": "q", "role": "posterior"}]}),
        _observation("formula-2", "formula", "Gradient", {"latex": "g(q)", "summary": "Gradient", "symbols": [{"symbol": "q", "role": "posterior"}]}, section="sec-2"),
    ]

    document = canonicalize_observations("paper-1", observations)

    assert [entity.label for entity in document.entities if entity.type == "symbol"] == ["q"]


def test_cross_type_name_collision_is_recorded_for_review_without_unsafe_merge():
    observations = [
        _observation("obs-method", "method", "SLIME", {
            "summary": "Reference-free preference optimization method.",
        }),
        _observation("obs-concept", "concept", "SLIME", {
            "summary": "The method proposed in this work and its limitations.",
        }),
    ]

    document = canonicalize_observations("paper-1", observations)

    assert {(entity.type, entity.label) for entity in document.entities} == {
        ("concept", "SLIME"),
        ("method", "SLIME"),
    }
    assert document.metrics.diagnostics["cross_type_label_collisions"] == [{
        "label": "SLIME",
        "entity_ids": sorted(entity.stable_id for entity in document.entities),
        "types": ["concept", "method"],
    }]


def test_canonical_ids_are_identical_when_observation_order_changes():
    observations = [
        _observation("obs-b", "concept", "ELBO", {"summary": "Objective", "aliases": ["Evidence lower bound"]}),
        _observation("obs-a", "concept", "Evidence lower bound", {"summary": "Objective", "aliases": ["ELBO"]}),
    ]

    first = canonicalize_observations("paper-1", observations)
    second = canonicalize_observations("paper-1", reversed(observations))

    assert [entity.stable_id for entity in first.entities] == [entity.stable_id for entity in second.entities]


def test_relation_candidates_resolve_to_canonical_ids_and_keep_evidence():
    observations = [
        _observation("obs-method", "method", "Coordinate ascent", {"summary": "Alternating updates"}),
        _observation("obs-concept", "concept", "Evidence lower bound", {
            "summary": "Objective",
            "aliases": ["ELBO"],
        }),
        _observation("obs-relation", "relation", "Coordinate ascent uses ELBO", {
            "type": "uses",
            "source": "Coordinate ascent",
            "target": "ELBO",
            "summary": "Updates optimize the ELBO.",
        }),
    ]

    document = canonicalize_observations("paper-1", observations)

    assert len(document.relations) == 1
    assert document.relations[0].type == "uses"
    assert document.relations[0].evidence_ids == ["obs-relation"]


def test_coordinated_section_extraction_keeps_only_exactly_supported_candidates(monkeypatch):
    class FakePrompt:
        def __or__(self, other):
            return other

    class FakeStructuredModel:
        def invoke(self, _args):
            return None

    response = knowledge_graph_module.SectionKnowledgeExtractionOutput(entities=[
        knowledge_graph_module.SectionEntityCandidate(
            kind="method",
            label="Coordinate ascent",
            summary="Alternates variational factor updates.",
            aliases=["CAVI"],
            source_quote="We introduce coordinate ascent for variational inference.",
            contribution=0.9,
        ),
        knowledge_graph_module.SectionEntityCandidate(
            kind="concept",
            label="Invented concept",
            summary="Not supported by the paper.",
            source_quote="This quote is absent.",
        ),
    ])
    monkeypatch.setattr(knowledge_graph_module, "get_llm", lambda _workflow: object())
    monkeypatch.setattr(
        knowledge_graph_module,
        "get_structured_llm",
        lambda _llm, _model: FakeStructuredModel(),
    )
    monkeypatch.setattr(
        knowledge_graph_module.ChatPromptTemplate,
        "from_messages",
        lambda _messages: FakePrompt(),
    )
    monkeypatch.setattr(knowledge_graph_module, "run_with_retry", lambda **_kwargs: response)
    monkeypatch.setenv("KG_WORKERS", "1")
    state = {
        "paper_id": "paper-1",
        "sections": [{
            "id": "sec-method",
            "title": "Method",
            "content_html": (
                "<p data-id='p-method'>We introduce coordinate ascent for variational inference. "
                "The method alternates variational factor updates.</p>"
            ),
        }],
        "llm_profile": {},
        "errors": [],
    }

    result = knowledge_graph_module.extract_section_observations(state)

    assert len(result["source_observations"]) == 1
    observation = SourceObservation.model_validate(result["source_observations"][0])
    assert observation.kind == "method"
    assert observation.source.dom_node_id == "p-method"
    assert observation.source.char_start == 0
    assert result["errors"] == ["Discarded unsupported concept 'Invented concept' in section sec-method"]