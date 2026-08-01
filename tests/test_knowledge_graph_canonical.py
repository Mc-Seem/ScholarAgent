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
        {"id": "eq-display", "latex": "L(q)=\\sum_i E_q[f_i]", "is_display": True, "mathml": "<math data-id='eq-display' />"},
        {"id": "eq-inline", "latex": "x", "is_display": False, "mathml": "<math data-id='eq-inline' />"},
    ]
    sections = [{"id": "sec-method", "title": "Method", "content_html": "<p><math data-id='eq-display'></math></p>"}]

    observations = anchor_equation_observations("paper-1", sections, equations)

    assert len(observations) == 1
    assert observations[0].source.equation_id == "eq-display"
    assert observations[0].source.section_id == "sec-method"
    assert observations[0].kind == "equation"
    assert observations[0].payload["latex"] == "L(q)=\\sum_i E_q[f_i]"
    assert {symbol["symbol"] for symbol in observations[0].payload["symbols"]} >= {"L", "q"}
    assert "i" not in {symbol["symbol"] for symbol in observations[0].payload["symbols"]}


def test_canonicalization_preserves_aliases_evidence_and_demotes_local_symbols():
    observations = [
        _observation("obs-concept-1", "topic", "Evidence lower bound", {"summary": "Variational objective", "aliases": ["ELBO"], "roles": ["study_object"]}),
        _observation("obs-concept-2", "topic", "ELBO", {"summary": "Variational objective", "aliases": ["Evidence lower bound"]}),
        _observation("obs-formula", "equation", "ELBO", {
            "summary": "Variational objective",
            "latex": "L(q)=E_q[f]",
            "equation_id": "eq-elbo",
            "symbols": [
                {"symbol": "q", "meaning": "variational posterior", "scope_id": "sec-1"},
                {"symbol": "L", "meaning": "objective", "scope_id": "sec-1"},
            ],
        }),
    ]

    document = canonicalize_observations("paper-1", observations)

    concepts = [entity for entity in document.objects if entity.kind == "topic"]
    assert len(concepts) == 1
    assert set(concepts[0].aliases) == {"ELBO"}
    assert set(concepts[0].observation_ids) == {"obs-concept-1", "obs-concept-2"}
    assert concepts[0].roles == ["study_object"]
    assert len(document.equations) == 1
    assert not any(entity.kind in {"formula", "symbol"} for entity in document.objects)
    assert {item.symbol for item in document.notation} == {"q", "L"}
    assert len(document.explanations) == 3


def test_recurrent_symbol_is_promoted_only_across_important_formulas():
    observations = [
        _observation("formula-1", "equation", "Objective", {"equation_id": "eq-1", "latex": "L(q)", "summary": "Objective", "symbols": [{"symbol": "q", "meaning": "posterior", "scope_id": "method"}]}),
        _observation("formula-2", "equation", "Gradient", {"equation_id": "eq-2", "latex": "g(q)", "summary": "Gradient", "symbols": [{"symbol": "q", "meaning": "posterior", "scope_id": "method"}]}, section="sec-2"),
    ]

    document = canonicalize_observations("paper-1", observations)

    assert len(document.notation) == 1
    assert document.notation[0].symbol == "q"
    assert {item.stable_id for item in document.equations} == {"equation:" + item.stable_id.split(":", 1)[1] for item in document.equations}


def test_same_symbol_with_different_meaning_or_scope_stays_separate():
    observations = [
        _observation("formula-1", "equation", "SUPG", {"equation_id": "eq-1", "latex": "tau R", "summary": "Stabilization", "symbols": [{"symbol": "tau", "meaning": "stabilization parameter", "scope_id": "supg"}]}),
        _observation("formula-2", "equation", "Lifetime", {"equation_id": "eq-2", "latex": "tau=1/lambda", "summary": "Lifetime", "symbols": [{"symbol": "tau", "meaning": "decay lifetime", "scope_id": "decay"}]}, section="sec-2"),
    ]

    document = canonicalize_observations("paper-1", observations)

    assert len(document.notation) == 2
    assert {item.scope_id for item in document.notation} == {"supg", "decay"}


def test_cross_type_name_collision_is_recorded_for_review_without_unsafe_merge():
    observations = [
        _observation("obs-method", "procedure", "SLIME", {
            "summary": "Reference-free preference optimization method.",
        }),
        _observation("obs-concept", "topic", "SLIME", {
            "summary": "The method proposed in this work and its limitations.",
        }),
    ]

    document = canonicalize_observations("paper-1", observations)

    assert {(entity.type, entity.label) for entity in document.entities} == {
        ("topic", "SLIME"),
        ("procedure", "SLIME"),
    }
    assert document.metrics.diagnostics["cross_type_label_collisions"] == [{
        "label": "SLIME",
        "entity_ids": sorted(entity.stable_id for entity in document.entities),
        "types": ["procedure", "topic"],
    }]


def test_canonical_ids_are_identical_when_observation_order_changes():
    observations = [
        _observation("obs-b", "topic", "ELBO", {"summary": "Objective", "aliases": ["Evidence lower bound"]}),
        _observation("obs-a", "topic", "Evidence lower bound", {"summary": "Objective", "aliases": ["ELBO"]}),
    ]

    first = canonicalize_observations("paper-1", observations)
    second = canonicalize_observations("paper-1", reversed(observations))

    assert [entity.stable_id for entity in first.entities] == [entity.stable_id for entity in second.entities]


def test_relation_candidates_resolve_to_canonical_ids_and_keep_evidence():
    observations = [
        _observation("obs-method", "procedure", "Coordinate ascent", {"summary": "Alternating updates"}),
        _observation("obs-concept", "topic", "Evidence lower bound", {
            "summary": "Objective",
            "aliases": ["ELBO"],
        }),
        _observation("obs-relation", "relation", "Coordinate ascent uses ELBO", {
            "type": "uses",
            "source": "Coordinate ascent",
            "target": "ELBO",
            "qualifiers": ["optimization"],
            "summary": "Updates optimize the ELBO.",
        }),
    ]

    document = canonicalize_observations("paper-1", observations)

    assert len(document.relations) == 1
    assert document.relations[0].type == "uses"
    assert document.relations[0].qualifiers == ["optimization"]
    assert document.relations[0].evidence_ids == ["obs-relation"]


def test_repeated_term_occurrences_share_one_explanation_and_stable_subject():
    observations = [_observation("obs-supg", "procedure", "SUPG", {"summary": "A stabilized finite element procedure."})]
    sections = [{
        "id": "sec-1",
        "content_html": "<p data-id='p-1'>SUPG stabilizes transport. SUPG uses tau.</p>",
    }]

    document = canonicalize_observations("paper-1", observations, sections=sections)

    assert len(document.objects) == 1
    assert len(document.explanations) == 1
    assert len(document.occurrences) == 2
    assert {item.subject_id for item in document.occurrences} == {document.objects[0].stable_id}
    assert [(item.start, item.end, item.text) for item in document.occurrences] == [
        (0, 4, "SUPG"),
        (27, 31, "SUPG"),
    ]


def test_occurrence_anchoring_prefers_longer_overlap_and_leaf_dom_node():
    observations = [
        _observation("obs-gradient", "topic", "gradient", {"summary": "A derivative vector."}),
        _observation("obs-descent", "procedure", "gradient descent", {"summary": "An optimization procedure."}),
    ]
    sections = [{
        "id": "sec-1",
        "content_html": "<section data-id='sec-node'><p data-id='p-1'>gradient descent converges.</p></section>",
    }]

    document = canonicalize_observations("paper-1", observations, sections=sections)

    assert [(item.dom_node_id, item.text) for item in document.occurrences] == [
        ("p-1", "gradient descent"),
    ]


def test_coordinated_section_extraction_keeps_only_exactly_supported_candidates(monkeypatch):
    class FakePrompt:
        def __or__(self, other):
            return other

    class FakeStructuredModel:
        def invoke(self, _args):
            return None

    response = knowledge_graph_module.SectionKnowledgeExtractionOutput(entities=[
        knowledge_graph_module.SectionEntityCandidate(
            kind="procedure",
            label="Coordinate ascent",
            summary="Alternates variational factor updates.",
            aliases=["CAVI"],
            source_quote="We introduce coordinate ascent for variational inference.",
            contribution=0.9,
        ),
        knowledge_graph_module.SectionEntityCandidate(
            kind="topic",
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
    assert observation.kind == "procedure"
    assert observation.source.dom_node_id == "p-method"
    assert observation.source.char_start == 0
    assert result["errors"] == ["Discarded unsupported topic 'Invented concept' in section sec-method"]


def test_equation_analysis_is_batched_and_reports_one_named_stage(monkeypatch):
    class FakePrompt:
        def __or__(self, other):
            return other

    class EquationFakeStructuredModel:
        def invoke(self, _args):
            return None

    response = knowledge_graph_module.EquationAnalysisOutput(equations=[
        knowledge_graph_module.EquationAnalysisCandidate(
            equation_id="eq-supg",
            summary="Adds residual-based streamline stabilization.",
            notation=[
                knowledge_graph_module.EquationNotationCandidate(
                    symbol="\\tau",
                    meaning="SUPG stabilization parameter",
                    scope_id="supg",
                    units="s",
                    constraints=["positive"],
                    object_labels=["SUPG"],
                ),
                knowledge_graph_module.EquationNotationCandidate(
                    symbol="i",
                    meaning="dummy index",
                ),
            ],
            object_labels=["SUPG"],
        ),
        knowledge_graph_module.EquationAnalysisCandidate(
            equation_id="invented-equation",
            summary="Unsupported.",
        ),
    ])
    monkeypatch.setattr(knowledge_graph_module, "get_llm", lambda _workflow: object())
    monkeypatch.setattr(
        knowledge_graph_module,
        "get_structured_llm",
        lambda _llm, _model: EquationFakeStructuredModel(),
    )
    monkeypatch.setattr(
        knowledge_graph_module.ChatPromptTemplate,
        "from_messages",
        lambda _messages: FakePrompt(),
    )
    monkeypatch.setattr(knowledge_graph_module, "run_with_retry", lambda **_kwargs: response)
    progress = []
    state = {
        "paper_id": "paper-1",
        "sections": [{
            "id": "sec-method",
            "title": "Method",
            "content_html": "<p>SUPG uses a positive stabilization parameter.</p><math data-id='eq-supg'></math>",
        }],
        "equations": [{
            "id": "eq-supg",
            "latex": "u = \\tau R + i",
            "is_display": True,
            "mathml": "<math data-id='eq-supg' />",
        }],
        "llm_profile": {},
        "progress_callback": lambda stage, current, total: progress.append((stage, current, total)),
        "errors": [],
    }

    result = knowledge_graph_module.anchor_equations(state)
    observation = SourceObservation.model_validate(result["source_observations"][0])

    assert progress == [
        ("equation_analysis", 0, 1),
        ("equation_analysis", 1, 1),
    ]
    assert observation.payload["summary"] == "Adds residual-based streamline stabilization."
    assert "paper_role" not in observation.payload
    assert observation.payload["symbols"] == [{
        "symbol": "\\tau",
        "meaning": "SUPG stabilization parameter",
        "scope_id": "supg",
        "units": "s",
        "constraints": ["positive"],
        "object_labels": ["SUPG"],
    }]


def test_equation_analysis_prompt_requests_a_short_identifying_summary():
    prompt = knowledge_graph_module.EQUATION_ANALYSIS_SYSTEM_PROMPT

    assert "noun phrase" in prompt
    assert "at most 8 words" in prompt
    assert "Do not start it with verbs" in prompt