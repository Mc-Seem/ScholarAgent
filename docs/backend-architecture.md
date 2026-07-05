# Backend Architecture

## Module Structure

```
backend/
├── app/
│   ├── api/main.py           # FastAPI endpoints
│   ├── agents/               # LangGraph pipelines
│   │   ├── knowledge_graph.py    # KG extraction (symbols, defs, theorems)
│   │   ├── tooltip_suggestion.py # Expertise-based filtering
│   │   └── utils.py              # Shared utilities (retry, strip_html)
│   ├── compiler/
│   │   ├── latexml_compiler.py   # LaTeX → HTML via Docker
│   │   ├── html_injection.py     # Inject <span> tags for tooltips
│   │   └── ai_html_injection.py  # AI-assisted injection fallback
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
