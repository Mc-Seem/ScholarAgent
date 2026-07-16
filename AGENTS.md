# Scholar Agent

Interactive academic paper reader that compiles arXiv LaTeX sources into HTML5 with semantic annotations, knowledge graphs, and AI-powered tooltips.

## Quick Start
- **Runtime**: `mise install` (from project root; pins Node.js 24.18.0)
- **Bootstrap**: `mise run bootstrap`
- **Backend**: `uv run uvicorn backend.app.api.main:app --reload --port 8000` (from project root)
- **Frontend**: `mise exec -- npm --prefix frontend run dev`
- **Electron**: `mise exec -- npm --prefix frontend run dev:desktop`

## Key Commands
- **Run Tests**: `.venv/bin/pytest tests/` (backend) | `mise exec -- npm --prefix frontend test -- --run` (frontend)
- **Verify Frontend**: `mise run verify` (tests + Next.js + Theia browser/Electron builds)
- **Database**: `cd backend && alembic upgrade head` | `alembic revision -m "description"`

## Architecture
arXiv .tar.gz → LaTeXML (Docker) → HTML5 + MathML → PostgreSQL → data-id injection → Knowledge Graph extraction (LLM) → Semantic tooltip injection.

**Stack**: FastAPI, PostgreSQL, SQLAlchemy, Alembic, LangGraph, Next.js, html-react-parser, MathJax 4, Framer Motion, React Flow.

## Documentation

All reference docs are in `docs/`:

| File | Purpose |
|------|---------|
| `docs/backend-architecture.md` | Backend module structure, models, API endpoints, HTML injection |
| `docs/frontend-architecture.md` | Frontend component tree, data flow, entity styling, API integration |
| `docs/kg-pipeline.md` | KG extraction pipeline architecture (LangGraph, schemas, progress) |
| `docs/kg-todos.md` | KG feature backlog and completed items |
| `docs/design-system.md` | Design tokens, reusable components, color palette, entity styling |
| `docs/testing.md` | Test strategy, running tests, coverage goals, CI/CD |
| `docs/roadmap.md` | Feature roadmap (multi-paper, chat, QoL) |
| `docs/kg-deduplication-plan.md` | KG dedup design plan (in-progress) |
| `docs/kg-formula-entity-plan.md` | Formula entity design plan (in-progress) |

## Database Models
- **Paper**: filename, HTML content, KG (JSONB), sections/equations data.
- **Tooltip**: Linked to paper + entity (semantic) or DOM node (paragraph comment).

## Debugging
- **Backend**: `SCHOLAR_DEBUG=true` for logs.
- **Database**: `psql -U scholaragent -d scholaragent`.
- **Frontend**: React DevTools, monitor SSE streams for KG progress.
- **Env**: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `KG_MAX_SECTIONS`, `KG_DEBUG`, `HTML_INJECTION_DEBUG`, `TOOLTIP_AGENT_DEBUG` in `.env`.

---

# Custom Agents

## /latex-compile
**Purpose**: Compile LaTeX sources to HTML using LaTeXML.
**When to use**: When working on LaTeX → HTML compilation pipeline, debugging compilation errors, or validating output structure.

## /db-migrate
**Purpose**: Manage PostgreSQL database schema changes using Alembic.
**When to use**: When modifying database schema (adding tables, columns, indexes), or troubleshooting migration issues.

## /test-integration
**Purpose**: Run and analyze end-to-end integration tests.
**When to use**: After major changes to verify full system functionality, or when debugging cross-layer issues.

## /frontend-debug
**Purpose**: Debug frontend rendering and interaction issues.
**When to use**: When investigating frontend bugs, rendering issues, or interaction problems with tooltips/math.

## /api-design
**Purpose**: Review and refine FastAPI endpoint design.
**When to use**: When designing new endpoints, refactoring existing API, or reviewing API architecture.

## /docker-setup
**Purpose**: Manage Docker containers for LaTeXML compilation.
**When to use**: When setting up LaTeXML environment, debugging container issues, or optimizing compilation performance.

## /cleanup-code
**Purpose**: Remove obsolete code during the rework phase.
**When to use**: During Phase 1 of rework (cleanup), or periodic maintenance to remove dead code.