# Backend Architecture

## Module Structure

```
backend/
├── app/
│   ├── api/main.py           # FastAPI paper/KG/tooltip endpoints
│   ├── api/semantic_routes.py # Bounded semantic reader projections
│   ├── api/settings_routes.py # Draft-aware LLM settings endpoints
│   ├── agents/               # LangGraph pipelines
│   │   ├── knowledge_graph.py    # Coordinated section extraction workflow
│   │   ├── knowledge_graph_models.py # Versioned canonical contracts
│   │   ├── knowledge_graph_canonical.py # Equation anchoring and stable canonicalization
│   │   ├── knowledge_graph_projection.py # Bounded ranking/search/subgraphs
│   │   ├── knowledge_graph_retrieval.py # Offline passage/hybrid evaluation
│   │   ├── tooltip_suggestion.py # Explanation-subject expertise filtering
│   │   └── utils.py              # Shared utilities (retry, strip_html)
│   ├── compiler/
│   │   ├── latexml_compiler.py   # LaTeX → HTML via Docker
│   │   ├── html_injection.py     # Inject <span> tags for tooltips
│   │   └── ai_html_injection.py  # Deterministic occurrence injection + legacy fallback
│   ├── utils/
│   │   ├── crypto.py             # Fernet encryption for stored API keys
│   │   ├── llm_factory.py        # Runtime and transient LangChain builders
│   │   └── llm_settings.py       # Provider catalog, URL/model normalization
│   └── database/
│       ├── models.py             # SQLAlchemy models
│       └── connection.py         # DB session management
├── alembic/                  # Database migrations
└── alembic.ini
```

## Key Models

### Paper
```python
class Paper(Base):
    id: str                    # SHA256 of uploaded file
    filename: str
    html_content: Text         # Compiled HTML with data-id attributes
    knowledge_graph: JSON      # Versioned schema-v3 semantic document
    sections_data: JSON        # Extracted at compile time
    equations_data: JSON
    # ...
```

### Tooltip
```python
class Tooltip(Base):
    id: str
    paper_id: str

    # DUAL MODE - only one should be set:
    entity_id: str | None      # Glossary entry (applies to ALL occurrences)
    dom_node_id: str | None    # Paragraph comment (applies to ONE block)

    content: Text              # The tooltip text
    target_text: str | None    # The term being defined
    is_user_override: bool     # Reader wording, not an applied AI draft
```

### LLMConfig

`LLMConfig` stores one active provider connection, an optional Fernet-encrypted
database key, and independent model IDs for `kg_extraction`, `html_injection`,
and `tooltip_suggestion`. No schema migration is needed for the native settings
UI because all three model keys already live in the JSON `models` column.

Runtime resolution is centralized in `utils/llm_settings.py` and
`utils/llm_factory.py`: explicit workflow model, then a provider-compatible
legacy value, then that provider's recommendation. OpenAI, Ollama, and custom
connections never inherit an Anthropic model fallback; custom connections with
no explicit or compatible legacy model fail clearly.

## Knowledge Graph Pipeline

```
LangGraph StateGraph:

load_paper_data → extract_section_observations
                → anchor_equations + analysis
                → canonicalize → anchor occurrences
```

The semantic stage extracts universal objects (`topic`, `claim`, `procedure`, `artifact`, `quantity`) with separate roles/facets. Equation analysis runs after it so the bounded call can choose an exact object observation when, and only when, one equation directly defines that object. The link is singular and optional; equations that merely use or contribute to an object stay unlinked, and conflicting assignments are all discarded rather than resolved by extraction order. `_run_kg_build_task()` validates the complete schema-v3 document before replacing `Paper.knowledge_graph`.

### Canonical Document

```text
KnowledgeGraphDocument
  schema_version
  build { pipeline_version, prompt_versions, models, created_at }
  observations[] { id, kind, label, payload, confidence, source }
  objects[] { stable_id, kind, label, aliases, roles, facets, signals, evidence_ids }
  relations[] { stable_id, type, source_id, target_id, qualifiers, evidence_ids, confidence }
  equations[] { equation_id, latex, summary, notation_ids, object_ids, defined_object_id?, evidence_ids }
  notation[] { symbol, meaning, scope_id, units, constraints, object_ids, evidence_ids }
  explanations[] { subject_id, base_content, expertise, evidence_ids }
  occurrences[] { subject_id, dom_node_id/equation_id, start, end, text, scope_id, local_override_id }
  metrics
```

### Occurrence Tracking

Evidence remains immutable source observations. Rendering uses separate exact occurrences, so repeated mentions share one explanation without one LLM call per mention:
```python
{
    "dom_node_id": "p_456",
    "start": 45,
    "end": 48,
    "text": "SUPG",
    "scope_id": "sec_3_2"
}
```

## API Endpoints

### Papers
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/papers/upload` | Upload + compile |
| GET | `/api/papers/{id}` | Get paper + HTML |
| POST | `/api/papers/{id}/compile` | Recompile |
| DELETE | `/api/papers/{id}` | Delete paper |

### Knowledge Graph
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/papers/{id}/knowledge-graph/build` | Start asynchronous canonical build |
| GET | `/api/papers/{id}/knowledge-graph/build/progress` | Build progress SSE |
| POST | `/api/papers/{id}/knowledge-graph/cancel` | Cooperatively cancel a build |
| GET | `/api/papers/{id}/knowledge-graph/overview` | Ranked bounded overview (hard cap 30) |
| GET | `/api/papers/{id}/knowledge-graph/subgraph` | One-hop or source-focused bounded projection |
| GET | `/api/papers/{id}/knowledge-graph/search` | Canonical entity search without layout expansion |
| GET | `/api/papers/{id}/knowledge-graph` | Complete versioned export/debug document |
| POST | `/api/papers/{id}/knowledge-graph/reanchor` | Recompute occurrences from stored observations, no LLM |
| DELETE | `/api/papers/{id}/knowledge-graph` | Delete for rebuilding |

### Semantic Reader
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/papers/{id}/semantic/sections/{section}/annotations` | Bounded exact DOM anchors |
| GET | `/api/papers/{id}/semantic/subjects/{subject}` | Explanation, occurrences, evidence, and optional defining equation with notation |
| GET | `/api/papers/{id}/semantic/equations/{equation}` | Equation, notation, evidence, and optional defined-subject details |
| GET | `/api/papers/{id}/semantic/glossary` | Bounded object/notation search without graph insertion |

Subject and equation evidence is returned in reading order, reconstructed from
the compiled `sections_data` section sequence, each section's `data-id` DOM
sequence, and the source `char_start`. The order of `evidence_ids` is not a UI
order: parallel extraction and canonical merging may arrange those IDs
arbitrarily.

### Tooltips
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/papers/{id}/tooltips` | List all |
| POST | `/api/papers/{id}/tooltips` | Create (comment) |
| PUT | `/api/papers/{id}/tooltips/{tid}` | Update |
| DELETE | `/api/papers/{id}/tooltips/{tid}` | Delete |
| POST | `/api/papers/{id}/tooltips/suggest` | AI suggestions |
| POST | `/api/papers/{id}/tooltips/apply` | Apply (inject spans) |
| PUT | `/api/papers/{id}/semantic-notes/{subject}` | Upsert the reader's wording for one subject |
| DELETE | `/api/papers/{id}/semantic-notes/{subject}` | Drop it so the agent's text shows again |

Semantic notes are `Tooltip` rows keyed by `entity_id`, where the subject is an
object, a notation entry, or an equation record. Only rows with
`is_user_override=true` replace the graph explanation in Semantic Lens; applying
an AI draft creates the same entity annotation with the flag false, so a later
graph rebuild cannot mislabel the previous generated text as a reader edit.
`POST /tooltips` cannot serve notes: it anchors to a DOM node and never sets
`entity_id`. The delete route is
deliberately not `DELETE /tooltips/{tid}` either, because that route also strips
the injected `span.kg-entity` anchors for the entity; restoring a wording must
not un-highlight the term in the paper.

`POST /tooltips/suggest` returns occurrences in the schema-v3 anchor shape
(`stable_id`, `subject_id`, `dom_node_id`/`equation_id`, `start`, `end`, `text`,
`scope_id`). Its `entity_types` filter validates against object kinds plus
`notation`; the pre-rework code read a `nodes` key that schema-v3 does not have,
so any non-empty filter returned 400.
The expertise-filter prompt likewise demonstrates real schema-v3 IDs
(`entity:<hash>` and `notation:<hash>`), rather than legacy formula/theorem IDs.
Suggestions are persisted in `tooltip_suggestions`; the unused
`Paper.tooltip_suggestions_cache` column and its write-only endpoint assignment
were removed by migration `007`.

### LLM Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/llm` | Normalized active snapshot, mask, and credential source |
| PUT | `/api/settings/llm` | Transactionally save provider, endpoint, key intent, and three models |
| POST | `/api/settings/llm/models` | Discover models with an unsaved connection draft |
| POST | `/api/settings/llm/test` | Test exactly one unsaved workflow/model without DB mutation |

API keys for discovery and tests are accepted only in JSON bodies. An empty key
preserves a database credential only when normalized provider and effective
endpoint are unchanged. Changing the connection never transfers a stored key;
explicit clear removes only the database value and cannot remove an environment
variable. Discovery can fall back to the built-in editable catalog with a
recoverable warning, while Test performs at most one model invocation.

## HTML Injection

When tooltips are applied, `<span>` tags are injected:

```html
<!-- Before -->
<p data-id="p_123">The parameter α_t controls noise.</p>

<!-- After -->
<p data-id="p_123">The parameter <span class="kg-entity"
   data-occurrence-id="occurrence_123"
   data-subject-id="notation_alpha_t">α_t</span> controls noise.</p>
```

### What Text Can Be Anchored

`backend/app/compiler/occurrence_text.py` holds the single rule, because the graph
builder writes offsets and the injector resolves them much later.

* Every element carrying `data-id` is a candidate anchor host, not only those without
  annotated descendants. LaTeXML gives each `<math>` its own `data-id`, so the earlier
  "childless nodes only" rule dropped every paragraph containing an inline formula --
  most of the prose in a technical paper. On one real paper this cost 199 anchors out of
  312, and an acronym like `KTO` appeared nowhere in the reader.
* Math is never anchored. LaTeXML keeps a formula's TeX in an `<annotation>` child, so
  matching plain text found `KTO` inside `\mathcal{L}_{KTO}` and wrapping it rewrote the
  formula. Anchors left inside math by earlier builds are unwrapped on the next apply and
  counted in `OccurrenceInjectionResult.repaired`.
* A nested `data-id` node's text is excluded from its parent's offsets: it is a separate
  anchor host, and counting it twice would let both claim the same words.
* Text already inside `span.kg-entity` still counts toward offsets. Anchoring splits one
  text node into three without changing the concatenation, so applying drafts in batches
  keeps the remaining offsets valid; overlap is detected from the DOM instead.
* Labels and aliases are augmented only with conservative productive singular/plural
  forms. A generated form is skipped if multiple subjects generate it or if another
  subject declares it explicitly, preserving deterministic identity without an LLM.

### Re-anchoring Without a Rebuild

Anchoring is deterministic and observations are persisted in the document, so
`POST /knowledge-graph/reanchor` recanonicalizes from `observations` plus
`sections_data` and rewrites occurrences with no model call. It answers 409 for a legacy
schema or a paper without compiled sections. Theia exposes it as
`Re-anchor Terms in Paper` in the library context menu, without a confirmation dialog.

### Deterministic Occurrence Injection

Validated occurrences are injected directly from exact DOM offsets. The active apply path does not ask an LLM to rediscover each mention. The old LangGraph injection workflow remains dormant as a fallback/reference until coverage has been measured on a cross-domain corpus; current local evidence is one paper and is not sufficient justification to delete it.

`/tooltips/apply` resolves the anchors itself, from `Paper.knowledge_graph`, keyed by
subject id. Stored drafts (`tooltip_suggestions`) hold only label, type and text, so a
client has no positions to send; requiring them in the request produced notes with zero
highlighted occurrences. Requests may still carry occurrences explicitly, which wins over
the graph.

`inject_validated_occurrences` returns `OccurrenceInjectionResult(html, anchored, skipped, repaired)`,
so `spans_injected` reports what the reader will actually see. An occurrence that crosses
inline markup is wrapped piecewise: LaTeXML renders acronym expansions and emphasis as nested
tags, so one term becomes several adjacent spans sharing `data-occurrence-id`, each marked
`data-occurrence-part="first|inner|last"` for styling. Occurrences whose text moved, whose node
disappeared, or whose range another subject already annotated are reported in `skipped`
instead of aborting the whole apply. Injection is idempotent per `stable_id`, and entities
that already carry a note are still anchored — only duplicate `Tooltip` rows are skipped, so
a note without highlights is repairable by applying again.

## Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@localhost/db
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OLLAMA_API_KEY=ollama-...

# Optional - Knowledge Graph
KG_MAX_SECTIONS=5      # Limit sections (0 = all)
KG_DEBUG=1             # Enable KG extraction debug logs

# Optional - Debug Flags (set to "true" to enable)
HTML_INJECTION_DEBUG=true      # Debug HTML span injection agent
TOOLTIP_AGENT_DEBUG=true       # Debug tooltip suggestion agent
```

## Database Migrations

```bash
cd backend

# Create migration
alembic revision -m "add column"

# Apply
alembic upgrade head

# Rollback
alembic downgrade -1
```

## Testing

```bash
# From project root
.venv/bin/pytest tests/ -v

# Single file
.venv/bin/pytest tests/test_api.py -v

# With coverage
.venv/bin/pytest --cov=backend tests/
```

## Common Tasks

### Add new API endpoint

1. Add route in `api/main.py`
2. Add Pydantic models for request/response
3. Write test in `tests/test_api.py`

### Extend semantic specialization

1. Prefer a role, facet, or relation qualifier over a new top-level kind.
2. Update strict contracts and the coordinated extraction prompt when a universal change is justified.
3. Extend cross-domain ontology fixtures and projection/UI tests.

### Modify tooltip behavior

1. Update model in `database/models.py`
2. Create Alembic migration
3. Update API endpoint in `api/main.py`
4. Update frontend `useTooltips.ts`
