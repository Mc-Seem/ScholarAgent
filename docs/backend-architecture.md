# Backend Architecture

## Module Structure

```
backend/
├── app/
│   ├── api/main.py           # FastAPI endpoints
│   ├── api/settings_routes.py # Draft-aware LLM settings endpoints
│   ├── agents/               # LangGraph pipelines
│   │   ├── knowledge_graph.py    # KG extraction (symbols, defs, theorems)
│   │   ├── tooltip_suggestion.py # Expertise-based filtering
│   │   └── utils.py              # Shared utilities (retry, strip_html)
│   ├── compiler/
│   │   ├── latexml_compiler.py   # LaTeX → HTML via Docker
│   │   ├── html_injection.py     # Inject <span> tags for tooltips
│   │   └── ai_html_injection.py  # AI-assisted injection fallback
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
    knowledge_graph: JSON      # {nodes: [...], edges: [...]}
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

data_loader → symbol_extraction ─┐
           → definition_extraction ─┼→ dependency_extraction → build_graph
           → theorem_extraction ─┘

Each extraction runs in parallel (ThreadPoolExecutor)
```

### Entity Types

| Type | ID Pattern | Example |
|------|------------|---------|
| Symbol | `symbol_{name}_{hash}` | `symbol_alpha_t_a1b2` |
| Definition | `definition_{name}_{hash}` | `definition_ELBO_c3d4` |
| Theorem | `theorem_{name}_{hash}` | `theorem_3.2_e5f6` |

### Occurrence Tracking

Each entity includes occurrence positions:
```python
{
    "section_id": "sec_3_2",
    "dom_node_id": "p_456",
    "char_offset": 45,      # Offset in stripped text
    "length": 3,
    "snippet": "...where α_t represents..."
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
| POST | `/api/papers/{id}/build-knowledge-graph` | Start build (SSE) |
| GET | `/api/papers/{id}/build-knowledge-graph/progress` | SSE stream |
| GET | `/api/papers/{id}/knowledge-graph` | Get graph data |

### Tooltips
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/papers/{id}/tooltips` | List all |
| POST | `/api/papers/{id}/tooltips` | Create (comment) |
| PUT | `/api/papers/{id}/tooltips/{tid}` | Update |
| DELETE | `/api/papers/{id}/tooltips/{tid}` | Delete |
| POST | `/api/papers/{id}/tooltips/suggest` | AI suggestions |
| POST | `/api/papers/{id}/tooltips/apply` | Apply (inject spans) |

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
   data-entity-id="symbol_alpha_t"
   data-entity-type="symbol">α_t</span> controls noise.</p>
```

### Character Offset Sync

**Critical**: Both extraction and injection use the same text normalization:
```python
# In utils.py
def strip_html_tags(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    return soup.get_text(separator=' ', strip=True)
```

The `separator=' '` is essential - it ensures offsets match.

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

### Add new entity type to KG

1. Add Pydantic model in `agents/knowledge_graph.py`
2. Add extraction agent function
3. Update `build_graph()` to convert to nodes
4. Add to parallel execution in `extract_all_entities()`

### Modify tooltip behavior

1. Update model in `database/models.py`
2. Create Alembic migration
3. Update API endpoint in `api/main.py`
4. Update frontend `useTooltips.ts`
