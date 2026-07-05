# Knowledge Graph Scaffold Reference

A concise reference for the LangGraph-based knowledge graph extraction pipeline.

## Architecture Overview

```
┌─────────────────────────┐
│     load_paper_data     │  ← Load pre-extracted sections from DB
└────────────┬────────────┘
             │
             ├──────────────────┬──────────────────┐
             ▼                  ▼                  ▼
┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
│  extract_symbols   │ │extract_definitions │ │  extract_theorems  │
│      (LLM)         │ │       (LLM)        │ │       (LLM)        │
└─────────┬──────────┘ └─────────┬──────────┘ └─────────┬──────────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │  extract_dependencies   │  ← Needs all entities
                    │         (LLM)           │
                    └────────────┬────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │      build_graph        │  ← Pure logic, no LLM
                    └────────────┬────────────┘
                                 ▼
                           graph_data
```

**Key Features:**
- Stages 1-3 run **in parallel** (symbols, definitions, theorems)
- Stage 4 (dependencies) waits for all entities to complete
- Real-time progress via SSE

---

## State Schema

```python
class GraphState(TypedDict):
    paper_id: str

    # Pre-extracted (from Phase 0 compile-time)
    sections: List[Dict]
    equations: List[Dict]
    citations: List[Dict]
    latex_source: Optional[str]

    # Agent-extracted (use Annotated for parallel updates)
    symbols: Annotated[List[Dict], operator.add]
    definitions: Annotated[List[Dict], operator.add]
    theorems: Annotated[List[Dict], operator.add]

    # Sequential stages
    relationships: List[Dict]
    graph_data: Dict
    errors: Annotated[List[str], operator.add]

    # Optional
    progress_callback: NotRequired[Any]
```

**Note:** `Annotated[..., operator.add]` enables LangGraph to merge concurrent list updates.

---

## Pydantic Output Schemas

### Symbol

```python
class Symbol(BaseModel):
    symbol: str       # e.g., "α_t"
    latex: str        # e.g., "$\\alpha_t$" (dollar-wrapped for rendering)
    context: str      # Brief explanation (1 sentence)
    is_definition: bool
```

### Definition

```python
class Definition(BaseModel):
    term: str
    definition_text: str  # Use $...$ for math
    is_formal: bool
    definition_number: Optional[str]  # e.g., "Definition 3.2"
```

### Theorem

```python
class Theorem(BaseModel):
    type: str         # theorem/lemma/corollary/proposition
    number: str       # e.g., "3.2"
    name: Optional[str]
    statement: str    # Use $...$ for math
```

### Relationship

```python
class Relationship(BaseModel):
    from_entity: str
    to_entity: str
    relationship_type: str  # uses/depends_on/defines/mentions
    evidence_text: str
```

---

## Workflow Definition

```python
workflow = StateGraph(GraphState)

# Add nodes
workflow.add_node("load_data", load_paper_data)
workflow.add_node("extract_symbols", extract_symbols)
workflow.add_node("extract_definitions", extract_definitions)
workflow.add_node("extract_theorems", extract_theorems)
workflow.add_node("extract_dependencies", extract_dependencies)
workflow.add_node("build_graph", build_graph)

# Parallel extraction (fan-out from load_data)
workflow.add_edge("load_data", "extract_symbols")
workflow.add_edge("load_data", "extract_definitions")
workflow.add_edge("load_data", "extract_theorems")

# Fan-in to dependencies (waits for all three)
workflow.add_edge("extract_symbols", "extract_dependencies")
workflow.add_edge("extract_definitions", "extract_dependencies")
workflow.add_edge("extract_theorems", "extract_dependencies")

# Sequential finish
workflow.add_edge("extract_dependencies", "build_graph")
workflow.add_edge("build_graph", END)
```

---

## Node Output Format

Each extraction function returns **only the keys it updates** (critical for parallelism):

```python
# Correct (parallel-safe)
def extract_symbols(state: GraphState):
    symbols = [...]  # extraction logic
    return {"symbols": symbols, "errors": state.get("errors", [])}

# Wrong (causes concurrent update error)
def extract_symbols(state: GraphState):
    state["symbols"] = [...]
    return state  # Returns all keys including paper_id
```

---

## Graph Output Structure

```json
{
  "nodes": [
    {
      "id": "symbol_alpha_t",
      "type": "symbol",
      "label": "α_t",
      "latex": "$\\alpha_t$",
      "context": "Noise scaling parameter",
      "dom_node_id": "abc123",
      "section_id": "abc123"
    },
    {
      "id": "def_diffusion_process",
      "type": "definition",
      "label": "Diffusion Process",
      "definition": "A stochastic process...",
      "dom_node_id": "def456"
    },
    {
      "id": "thm_3.2",
      "type": "theorem",
      "label": "Theorem 3.2",
      "statement": "The reverse process converges...",
      "dom_node_id": "thm789"
    }
  ],
  "edges": [
    {
      "id": "thm_3.2_uses_def_diffusion_process",
      "source": "thm_3.2",
      "target": "def_diffusion_process",
      "type": "uses"
    }
  ],
  "metadata": {
    "paper_id": "...",
    "node_count": 42,
    "edge_count": 15,
    "symbol_count": 20,
    "definition_count": 12,
    "theorem_count": 10
  }
}
```

---

## Progress Tracking

### Backend (callback)

```python
def progress_callback(stage: str, current: int, total: int):
    """Called after each section is processed."""
    # stage: "symbols" | "definitions" | "theorems" | "dependencies"
```

### SSE Event Format

```json
{
  "stage": "extracting",
  "progress": {
    "symbols": {"current": 2, "total": 5},
    "definitions": {"current": 1, "total": 5},
    "theorems": {"current": 3, "total": 5},
    "dependencies": {"current": 0, "total": 5}
  }
}
```

### Completion

```json
{
  "stage": "complete",
  "node_count": 42,
  "edge_count": 15
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KG_MAX_SECTIONS` | `5` | Limit sections processed (0 = all) |
| `KG_DEBUG` | unset | Show verbose content previews |
| `ANTHROPIC_API_KEY` | required | Claude API key |

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/app/agents/knowledge_graph.py` | LangGraph pipeline, extraction agents |
| `backend/app/api/main.py` | SSE endpoint, build endpoint |
| `backend/app/compiler/latexml_compiler.py` | Section extraction (Phase 0) |
| `frontend/components/reader/KnowledgeGraphView.tsx` | Graph visualization |
| `frontend/components/reader/KnowledgeGraphProgress.tsx` | Progress UI |
| `frontend/components/reader/GraphNode.tsx` | Custom node renderer |

---

## Extending the Pipeline

### Adding a New Entity Type

1. Create Pydantic model in `knowledge_graph.py`
2. Add extraction function with progress reporting
3. Update `GraphState` with new field (use `Annotated` if parallel)
4. Add node to workflow, connect edges appropriately
5. Update `build_graph` to convert entities to nodes
6. Update frontend `GraphNode` with styling for new type

### Modifying Prompts

Prompts are defined as module-level constants:
- `SYMBOL_SYSTEM_PROMPT` / `SYMBOL_USER_PROMPT`
- `DEFINITION_SYSTEM_PROMPT` / `DEFINITION_USER_PROMPT`
- `THEOREM_SYSTEM_PROMPT` / `THEOREM_USER_PROMPT`
- `DEPENDENCY_SYSTEM_PROMPT` / `DEPENDENCY_USER_PROMPT`

**Important:** Escape curly braces in examples: `$\\mathbb{{R}}$` not `$\\mathbb{R}$`
