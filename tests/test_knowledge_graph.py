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
