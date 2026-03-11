"""Unit tests for knowledge graph assembly helpers."""

from backend.app.agents.knowledge_graph import build_graph, deduplicate_entities


def test_formula_entities_are_deduplicated_and_link_symbols():
    state = {
        "paper_id": "paper-1",
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [
            {
                "symbol": "$x$",
                "latex": "$x$",
                "context": "Input variable",
                "is_definition": True,
                "role_in_formula": None,
                "source_type": "stray_symbol",
                "parent_formula_key": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-1",
            }
        ],
        "formula_observations": [
            {
                "label": "Energy",
                "latex": "$E = mc^2$",
                "summary": "Defines the paper's energy function.",
                "section_id": "sec-1",
                "dom_node_id": "dom-2",
                "source_type": "formula",
                "formula_key": "Energy",
                "symbols": [
                    {
                        "symbol": "$E$",
                        "latex": "$E$",
                        "context": "Energy quantity",
                        "is_definition": True,
                        "role_in_formula": "output",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "Energy",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-2",
                    },
                    {
                        "symbol": "$m$",
                        "latex": "$m$",
                        "context": "Mass term",
                        "is_definition": True,
                        "role_in_formula": "parameter",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "Energy",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-2",
                    },
                ],
            },
            {
                "label": "Energy",
                "latex": "$E = mc^2$",
                "summary": "Duplicate mention of the same formula.",
                "section_id": "sec-2",
                "dom_node_id": "dom-3",
                "source_type": "formula",
                "formula_key": "Energy",
                "symbols": [
                    {
                        "symbol": "$E$",
                        "latex": "$E$",
                        "context": "Energy quantity",
                        "is_definition": False,
                        "role_in_formula": "output",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "Energy",
                        "section_id": "sec-2",
                        "dom_node_id": "dom-3",
                    }
                ],
            },
        ],
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

    deduped = deduplicate_entities(state)
    state.update(deduped)
    result = build_graph(state)

    nodes = result["graph_data"]["nodes"]
    edges = result["graph_data"]["edges"]
    metadata = result["graph_data"]["metadata"]

    formula_nodes = [node for node in nodes if node["type"] == "formula"]
    symbol_nodes = [node for node in nodes if node["type"] == "symbol"]
    has_symbol_edges = [edge for edge in edges if edge["type"] == "has_symbol"]

    assert len(formula_nodes) == 1
    assert formula_nodes[0]["label"] == "Energy"

    assert metadata["formula_count"] == 1
    assert metadata["symbol_count"] == 3
    assert metadata["entity_counts"]["formula"] == 1

    symbol_ids = {node["id"] for node in symbol_nodes}
    assert len(has_symbol_edges) == 2
    assert {edge["target"] for edge in has_symbol_edges}.issubset(symbol_ids)


def test_local_definition_formula_reconciliation_adds_structural_link():
    state = {
        "paper_id": "paper-2",
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [
            {
                "label": "KTO loss",
                "latex": "$L_{KTO} = x - y$",
                "summary": "Defines the KTO loss used for optimization.",
                "section_id": "sec-1",
                "dom_node_id": "dom-formula",
                "source_type": "formula",
                "formula_key": "KTO loss",
                "symbols": [],
            }
        ],
        "definition_observations": [
            {
                "term": "KTO loss",
                "definition_text": "The KTO loss is defined as $L_{KTO} = x - y$ and measures the training objective.",
                "summary": "Objective used to optimize the model.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-def",
            }
        ],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }

    deduped = deduplicate_entities(state)
    state.update(deduped)
    result = build_graph(state)

    definition = state["definitions"][0]
    formula = state["formulas"][0]
    edges = result["graph_data"]["edges"]

    assert definition["attached_formula_ids"] == [formula["id"]]
    assert formula["attached_definition_term"] == "KTO loss"
    assert any(
        edge["type"] == "defines"
        and edge["source"] == "def_kto_loss"
        and edge["target"] == formula["id"]
        for edge in edges
    )


def test_local_symbol_reconciliation_merges_stray_and_formula_symbol():
    state = {
        "paper_id": "paper-3",
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [
            {
                "symbol": "$x$",
                "latex": "$x$",
                "context": "Input embedding",
                "is_definition": True,
                "role_in_formula": None,
                "source_type": "stray_symbol",
                "parent_formula_key": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-symbol",
            }
        ],
        "formula_observations": [
            {
                "label": "Input loss",
                "latex": "$L = f(x)$",
                "summary": "Loss over the input embedding.",
                "section_id": "sec-1",
                "dom_node_id": "dom-formula",
                "source_type": "formula",
                "formula_key": "Input loss",
                "symbols": [
                    {
                        "symbol": "$x$",
                        "latex": "$x$",
                        "context": "Model input",
                        "is_definition": False,
                        "role_in_formula": "input",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "Input loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula",
                    }
                ],
            }
        ],
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

    deduped = deduplicate_entities(state)
    state.update(deduped)

    assert len(state["symbols"]) == 1
    symbol = state["symbols"][0]
    assert symbol["context"] == "Input embedding"
    assert symbol["is_definition"] is True
    assert len(symbol["parent_formula_ids"]) == 1


def test_global_definition_formula_reconciliation_links_across_sections():
    state = {
        "paper_id": "paper-4",
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [
            {
                "label": "KL divergence",
                "latex": "$D_{KL}(P\\|Q) = \\mathbb{E}_P[\\log P - \\log Q]$",
                "summary": "KL divergence objective used in the paper.",
                "section_id": "sec-3",
                "dom_node_id": "dom-formula",
                "source_type": "formula",
                "formula_key": "KL divergence",
                "symbols": [],
            }
        ],
        "definition_observations": [
            {
                "term": "KL divergence",
                "definition_text": "KL divergence is the quantity $D_{KL}(P\\|Q) = \\mathbb{E}_P[\\log P - \\log Q]$ measuring distribution mismatch.",
                "summary": "Measures mismatch between probability distributions.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-def",
            }
        ],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }

    deduped = deduplicate_entities(state)
    state.update(deduped)
    result = build_graph(state)

    definition = state["definitions"][0]
    formula = state["formulas"][0]
    edges = result["graph_data"]["edges"]

    assert formula["attached_definition_term"] == "KL divergence"
    assert definition["attached_formula_ids"] == [formula["id"]]
    assert any(
        edge["type"] == "defines"
        and edge["source"] == "def_kl_divergence"
        and edge["target"] == formula["id"]
        for edge in edges
    )


def test_definitions_merge_when_term_and_math_signature_match():
    state = {
        "paper_id": "paper-5",
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [],
        "definition_observations": [
            {
                "term": "KTO loss",
                "definition_text": "KTO loss is defined as $L_{KTO} = x - y$ for our objective.",
                "summary": "Objective for optimization in training.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-def-1",
            },
            {
                "term": "KTO loss",
                "definition_text": "The KTO loss $L_{KTO} = x - y$ is the optimization target used in our method.",
                "summary": "Optimization target used in the method.",
                "is_formal": True,
                "definition_number": "2.1",
                "section_id": "sec-4",
                "dom_node_id": "dom-def-2",
            },
        ],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }

    deduped = deduplicate_entities(state)
    state.update(deduped)

    assert len(state["definitions"]) == 1
    definition = state["definitions"][0]
    assert definition["term"] == "KTO loss"
    assert definition["is_formal"] is True
    assert definition["definition_number"] == "2.1"
    assert "l_kto=x-y" in definition["math_signatures"]


def test_non_exact_definition_formula_reconciliation_uses_multiple_signals():
    state = {
        "paper_id": "paper-6",
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [
            {
                "label": "KTO objective",
                "latex": "$L_{KTO} = x - y$",
                "summary": "Optimization objective for KTO training.",
                "section_id": "sec-5",
                "dom_node_id": "dom-formula",
                "source_type": "formula",
                "formula_key": "KTO objective",
                "symbols": [],
            }
        ],
        "definition_observations": [
            {
                "term": "KTO loss",
                "definition_text": "The KTO loss is given by $L_{KTO} = x - y$ and is used as the training target.",
                "summary": "Training target used for KTO optimization.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-2",
                "dom_node_id": "dom-def",
            }
        ],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }

    deduped = deduplicate_entities(state)
    state.update(deduped)

    assert len(state["definitions"]) == 1
    assert len(state["formulas"]) == 1
    assert state["formulas"][0]["attached_definition_term"] == "KTO loss"
    assert state["definitions"][0]["attached_formula_ids"] == [state["formulas"][0]["id"]]


def test_non_exact_definition_formula_reconciliation_avoids_near_miss():
    state = {
        "paper_id": "paper-7",
        "sections": [],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [
            {
                "label": "Policy objective",
                "latex": "$J(\\theta) = \\mathbb{E}[r]$",
                "summary": "Optimization objective for the policy.",
                "section_id": "sec-5",
                "dom_node_id": "dom-formula",
                "source_type": "formula",
                "formula_key": "Policy objective",
                "symbols": [],
            }
        ],
        "definition_observations": [
            {
                "term": "Value function",
                "definition_text": "The value function estimates expected return from a state.",
                "summary": "Expected return estimator for states.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-2",
                "dom_node_id": "dom-def",
            }
        ],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }

    deduped = deduplicate_entities(state)
    state.update(deduped)

    assert state["formulas"][0].get("attached_definition_term") is None
    assert state["definitions"][0]["attached_formula_ids"] == []


def test_symbol_inherits_concept_scope_from_attached_formula():
    state = {
        "paper_id": "paper-8",
        "sections": [{"id": "sec-1", "title": "Method Objective"}],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [
            {
                "label": "KTO loss",
                "latex": "$L_{KTO} = x - y$",
                "summary": "Objective for KTO training.",
                "section_id": "sec-1",
                "dom_node_id": "dom-formula",
                "source_type": "formula",
                "formula_key": "KTO loss",
                "symbols": [
                    {
                        "symbol": "$x$",
                        "latex": "$x$",
                        "context": "Preference score input",
                        "is_definition": False,
                        "role_in_formula": "input",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula",
                    },
                    {
                        "symbol": "$y$",
                        "latex": "$y$",
                        "context": "Reference score",
                        "is_definition": False,
                        "role_in_formula": "parameter",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula",
                    },
                ],
            }
        ],
        "definition_observations": [
            {
                "term": "KTO loss",
                "definition_text": "The KTO loss is $L_{KTO} = x - y$.",
                "summary": "Training objective.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-def",
            }
        ],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }

    deduped = deduplicate_entities(state)
    state.update(deduped)

    x_symbol = next(symbol for symbol in state["symbols"] if symbol["latex"] == "$x$")
    assert x_symbol["concept_scope"] == "kto loss"
    assert x_symbol["scope_level"] == "formula_scoped"
    assert x_symbol["normalized_role_in_formula"] == "input"
    assert x_symbol["section_title"] == "Method Objective"
    assert "y" in x_symbol["sibling_symbols"]


def test_symbol_matching_uses_section_title_and_role():
    state = {
        "paper_id": "paper-9",
        "sections": [
            {"id": "sec-1", "title": "Method Objective"},
            {"id": "sec-2", "title": "Objective Details"},
        ],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [
            {
                "label": "KTO loss",
                "latex": "$L_{KTO} = f(x, y)$",
                "summary": "Main training objective.",
                "section_id": "sec-1",
                "dom_node_id": "dom-formula-1",
                "source_type": "formula",
                "formula_key": "KTO loss",
                "symbols": [
                    {
                        "symbol": "$x$",
                        "latex": "$x$",
                        "context": "Preference score input",
                        "is_definition": False,
                        "role_in_formula": "input",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula-1",
                    },
                    {
                        "symbol": "$y$",
                        "latex": "$y$",
                        "context": "Baseline score",
                        "is_definition": False,
                        "role_in_formula": "parameter",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula-1",
                    },
                ],
            },
            {
                "label": "Auxiliary objective",
                "latex": "$J = g(x, y)$",
                "summary": "Additional objective detail.",
                "section_id": "sec-2",
                "dom_node_id": "dom-formula-2",
                "source_type": "formula",
                "formula_key": "Auxiliary objective",
                "symbols": [
                    {
                        "symbol": "$x$",
                        "latex": "$x$",
                        "context": "Input preference signal",
                        "is_definition": False,
                        "role_in_formula": "input",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "Auxiliary objective",
                        "section_id": "sec-2",
                        "dom_node_id": "dom-formula-2",
                    },
                    {
                        "symbol": "$y$",
                        "latex": "$y$",
                        "context": "Reference baseline",
                        "is_definition": False,
                        "role_in_formula": "parameter",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "Auxiliary objective",
                        "section_id": "sec-2",
                        "dom_node_id": "dom-formula-2",
                    },
                ],
            },
        ],
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

    deduped = deduplicate_entities(state)
    state.update(deduped)

    x_symbols = [symbol for symbol in state["symbols"] if symbol["latex"] == "$x$"]
    assert len(x_symbols) == 1


def test_cross_section_symbol_clustering_uses_concept_scope_and_role():
    state = {
        "paper_id": "paper-10",
        "sections": [
            {"id": "sec-1", "title": "Main Objective"},
            {"id": "sec-2", "title": "Objective Analysis"},
        ],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [
            {
                "label": "KTO loss",
                "latex": "$L_{KTO} = f(x, y)$",
                "summary": "Main KTO objective.",
                "section_id": "sec-1",
                "dom_node_id": "dom-formula-1",
                "source_type": "formula",
                "formula_key": "KTO loss",
                "symbols": [
                    {
                        "symbol": "$x$",
                        "latex": "$x$",
                        "context": "Preference score input",
                        "is_definition": False,
                        "role_in_formula": "input",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula-1",
                    },
                    {
                        "symbol": "$y$",
                        "latex": "$y$",
                        "context": "Reference baseline",
                        "is_definition": False,
                        "role_in_formula": "parameter",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula-1",
                    },
                ],
            },
            {
                "label": "KTO objective",
                "latex": "$J_{KTO} = g(x, y)$",
                "summary": "Equivalent objective analysis.",
                "section_id": "sec-2",
                "dom_node_id": "dom-formula-2",
                "source_type": "formula",
                "formula_key": "KTO objective",
                "symbols": [
                    {
                        "symbol": "$x$",
                        "latex": "$x$",
                        "context": "Input preference signal",
                        "is_definition": False,
                        "role_in_formula": "input",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO objective",
                        "section_id": "sec-2",
                        "dom_node_id": "dom-formula-2",
                    },
                    {
                        "symbol": "$y$",
                        "latex": "$y$",
                        "context": "Reference baseline term",
                        "is_definition": False,
                        "role_in_formula": "parameter",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO objective",
                        "section_id": "sec-2",
                        "dom_node_id": "dom-formula-2",
                    },
                ],
            },
        ],
        "definition_observations": [
            {
                "term": "KTO loss",
                "definition_text": "KTO loss is the main objective used for training.",
                "summary": "Main objective for KTO training.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-def-1",
            },
            {
                "term": "KTO objective",
                "definition_text": "KTO objective refers to the same KTO loss analyzed later.",
                "summary": "Later analysis of the same KTO training objective.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-2",
                "dom_node_id": "dom-def-2",
            },
        ],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }

    deduped = deduplicate_entities(state)
    state.update(deduped)

    x_symbols = [symbol for symbol in state["symbols"] if symbol["latex"] == "$x$"]
    assert len(x_symbols) == 1
    x_symbol = x_symbols[0]
    assert len(x_symbol["parent_formula_ids"]) == 2
    assert x_symbol["concept_scope"] == "kto loss"


def test_cross_section_symbol_clustering_avoids_same_glyph_different_role():
    state = {
        "paper_id": "paper-11",
        "sections": [
            {"id": "sec-1", "title": "Main Objective"},
            {"id": "sec-2", "title": "State Value Analysis"},
        ],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [],
        "formula_observations": [
            {
                "label": "KTO loss",
                "latex": "$L_{KTO} = f(x, y)$",
                "summary": "Main KTO objective.",
                "section_id": "sec-1",
                "dom_node_id": "dom-formula-1",
                "source_type": "formula",
                "formula_key": "KTO loss",
                "symbols": [
                    {
                        "symbol": "$x$",
                        "latex": "$x$",
                        "context": "Preference score input",
                        "is_definition": False,
                        "role_in_formula": "input",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula-1",
                    },
                    {
                        "symbol": "$y$",
                        "latex": "$y$",
                        "context": "Reference baseline",
                        "is_definition": False,
                        "role_in_formula": "parameter",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "KTO loss",
                        "section_id": "sec-1",
                        "dom_node_id": "dom-formula-1",
                    },
                ],
            },
            {
                "label": "Value function",
                "latex": "$V(x) = h(x)$",
                "summary": "State-value estimator.",
                "section_id": "sec-2",
                "dom_node_id": "dom-formula-2",
                "source_type": "formula",
                "formula_key": "Value function",
                "symbols": [
                    {
                        "symbol": "$x$",
                        "latex": "$x$",
                        "context": "State variable",
                        "is_definition": False,
                        "role_in_formula": "state",
                        "source_type": "formula_symbol",
                        "parent_formula_key": "Value function",
                        "section_id": "sec-2",
                        "dom_node_id": "dom-formula-2",
                    }
                ],
            },
        ],
        "definition_observations": [
            {
                "term": "KTO loss",
                "definition_text": "KTO loss is the main training objective.",
                "summary": "Main objective for KTO training.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-def-1",
            },
            {
                "term": "Value function",
                "definition_text": "Value function estimates expected return for a state.",
                "summary": "Expected return estimator for states.",
                "is_formal": False,
                "definition_number": None,
                "section_id": "sec-2",
                "dom_node_id": "dom-def-2",
            },
        ],
        "theorem_observations": [],
        "symbols": [],
        "formulas": [],
        "definitions": [],
        "theorems": [],
        "relationships": [],
        "graph_data": {},
        "errors": [],
    }

    deduped = deduplicate_entities(state)
    state.update(deduped)

    x_symbols = [symbol for symbol in state["symbols"] if symbol["latex"] == "$x$"]
    assert len(x_symbols) == 2


def test_symbol_adjudication_hook_merges_ambiguous_bucket():
    state = {
        "paper_id": "paper-12",
        "sections": [
            {"id": "sec-1", "title": "Main Objective"},
            {"id": "sec-2", "title": "Objective Discussion"},
        ],
        "equations": [],
        "citations": [],
        "latex_source": None,
        "symbol_observations": [
            {
                "symbol": "$x$",
                "latex": "$x$",
                "context": "Preference signal",
                "is_definition": True,
                "role_in_formula": None,
                "source_type": "stray_symbol",
                "parent_formula_key": None,
                "section_id": "sec-1",
                "dom_node_id": "dom-symbol-1",
                "scope_level": "paper_level",
                "section_title": "Main Objective",
            },
            {
                "symbol": "$x$",
                "latex": "$x$",
                "context": "Reward-side signal",
                "is_definition": False,
                "role_in_formula": None,
                "source_type": "stray_symbol",
                "parent_formula_key": None,
                "section_id": "sec-2",
                "dom_node_id": "dom-symbol-2",
                "scope_level": "paper_level",
                "section_title": "Objective Discussion",
            },
        ],
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

    def fake_resolver(bucket):
        ids = sorted(symbol["id"] for symbol in bucket)
        return [ids]

    deduped = deduplicate_entities(state, symbol_bucket_resolver=fake_resolver)
    state.update(deduped)

    assert len(state["symbols"]) == 1
    assert state["symbols"][0]["is_definition"] is True
