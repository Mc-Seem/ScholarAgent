# Scholar Agent

Interactive academic paper reader that compiles arXiv LaTeX sources into HTML5 with semantic annotations, knowledge graphs, and AI-powered tooltips.

## Quick Start (Docker Compose)

**No repository clone required!** Just download the `docker-compose.yml` file:

```bash
curl -O https://raw.githubusercontent.com/Mc-Seem/ScholarAgent/master/docker-compose.yml

# Or with wget
wget https://raw.githubusercontent.com/Mc-Seem/ScholarAgent/master/docker-compose.yml
```

### Linux / macOS / WSL

```bash
# 1. Create .env file (same directory as docker-compose.yml)
cat > .env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
KG_MAX_SECTIONS=0
EOF

# 2. Start all services
docker compose up -d

# 3. Open in browser
open http://localhost:3000  # macOS
# or just visit http://localhost:3000 in your browser
```

### Windows (PowerShell)

```powershell
# 1. Download docker-compose.yml
Invoke-WebRequest -Uri https://raw.githubusercontent.com/your-repo/ScholarAgent/master/docker-compose.yml -OutFile docker-compose.yml

# 2. Create .env file
@"
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
KG_MAX_SECTIONS=0
"@ | Out-File -FilePath .env -Encoding ASCII

# 3. Start all services
docker compose up -d

# 4. Open in browser
Start-Process "http://localhost:3000"
```

### Windows (Command Prompt)

```cmd
REM 1. Download docker-compose.yml
curl -o docker-compose.yml https://raw.githubusercontent.com/your-repo/ScholarAgent/master/docker-compose.yml

REM 2. Create .env file manually
echo ANTHROPIC_API_KEY=sk-ant-api03-your-key-here > .env
echo KG_MAX_SECTIONS=0 >> .env

REM 3. Start all services
docker compose up -d

REM 4. Open in browser
start http://localhost:3000
```

That's it! The application will be running with:
- Frontend at `http://localhost:3000` (open in browser)
- Backend API at `http://localhost:8000`
- PostgreSQL database (internal)

**Note**: Get your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/)

## Setup from Source

### Prerequisites

**Required:**
- Python 3.12+ with `uv` package manager
- `mise` (installs the project-pinned Node.js 24.18.0 and npm)
- PostgreSQL 14+
- Docker (for LaTeXML compilation)
- Git

**Platform-specific installation:**

<details>
<summary>Linux (Ubuntu/Debian)</summary>

```bash
sudo apt update
sudo apt install python3 python3-pip postgresql docker.io git curl
curl https://mise.run | sh
pip install uv
sudo systemctl enable --now postgresql docker
sudo usermod -aG docker $USER  # Re-login after this
```
</details>

<details>
<summary>Linux (Arch/CachyOS)</summary>

```bash
sudo pacman -S python python-pip mise postgresql docker git
pip install uv
sudo systemctl enable --now postgresql docker
sudo usermod -aG docker $USER  # Re-login after this
```
</details>

<details>
<summary>macOS</summary>

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install python mise postgresql git
pip3 install uv
brew services start postgresql

# Install Docker Desktop for Mac from:
# https://docs.docker.com/desktop/install/mac-install/
```
</details>

<details>
<summary>Windows</summary>

1. **Python**: Download from [python.org](https://www.python.org/downloads/)
2. **Node.js**: Download from [nodejs.org](https://nodejs.org/)
3. **PostgreSQL**: Download from [postgresql.org](https://www.postgresql.org/download/windows/)
4. **Docker Desktop**: Download from [docker.com](https://docs.docker.com/desktop/install/windows-install/)
5. **Git**: Download from [git-scm.com](https://git-scm.com/download/win)
6. **uv**: Run `pip install uv` in PowerShell/CMD

For best experience, use WSL2 (Windows Subsystem for Linux) and follow Linux instructions.
</details>

### Installation

```bash
# 1. Clone repository
git clone <repository-url>
cd ScholarAgent

# 2. Trust the project config and install Node.js 24.18.0
mise trust
mise install

# 3. Install Python dependencies
uv sync

# 4. Install frontend dependencies exactly from package-lock.json
mise run bootstrap

# 5. Start PostgreSQL (choose one):
# Option A: Docker
docker run -d --name scholaragent-db \
  -e POSTGRES_DB=scholaragent \
  -e POSTGRES_USER=scholaragent \
  -e POSTGRES_PASSWORD=scholaragent \
  -p 5432:5432 \
  postgres:16

# Option B: System PostgreSQL (Linux/macOS)
sudo systemctl start postgresql  # Linux
# or: brew services start postgresql  # macOS
sudo -u postgres psql -c "CREATE DATABASE scholaragent;"
sudo -u postgres psql -c "CREATE USER scholaragent WITH PASSWORD 'scholaragent';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE scholaragent TO scholaragent;"

# 6. Configure environment
cp .env.example .env
# Edit .env with your settings

# 7. Run database migrations
cd backend && alembic upgrade head && cd ..

# 8. Pull LaTeXML Docker image
docker pull latexml/ar5ivist
```

### Running from Source

```bash
# Backend (from project root)
uv run uvicorn backend.app.api.main:app --reload --port 8000

# Frontend (from project root, always with the pinned Node.js)
mise exec -- npm --prefix frontend run dev
```

Access the app at `http://localhost:3000`

### Experimental Theia Pilot

The existing Next.js client remains the default and fallback. The isolated
Theia Platform pilot reuses the same reader components and FastAPI backend.

```bash
# Browser workbench + backend (from project root)
mise exec -- npm --prefix frontend run dev:theia

# Electron workbench + backend
mise exec -- npm --prefix frontend run dev:theia:desktop

# Build either target without starting it
mise exec -- npm --prefix frontend run theia:build:browser
mise exec -- npm --prefix frontend run theia:build:electron

# Tests plus all frontend production builds
mise run verify
```

The pilot provides one central tab per paper, native split view and layout
restoration, Papers/Navigation/Annotations views, commands, keybindings, and
status-bar progress. Set `window.__SCHOLAR_API_BASE__` before frontend startup
to override the default `http://<current-host>:8000` API URL.

## Environment Variables

Create a `.env` file in the same directory as `docker-compose.yml`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | - | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/) |
| `DATABASE_URL` | No | Auto-configured | PostgreSQL connection string (only needed for source setup) |
| `KG_MAX_SECTIONS` | No | `0` | Limit sections processed in knowledge graph (0 = all sections) |
| `KG_DEBUG` | No | - | Enable knowledge graph extraction debug logs (set to `1`) |
| `HTML_INJECTION_DEBUG` | No | `false` | Enable HTML span injection debug logs (set to `true`) |
| `TOOLTIP_AGENT_DEBUG` | No | `false` | Enable tooltip suggestion debug logs (set to `true`) |
| `OPENAI_API_KEY` | No | - | For future OpenAI integrations |
| `LLAMA_CLOUD_API_KEY` | No | - | For future LlamaIndex integrations |

## Architecture

```
arXiv .tar.gz → LaTeXML → HTML5 + MathML → PostgreSQL
                               ↓
                   Knowledge Graph Extraction (LLM)
                               ↓
                   Semantic Tooltip Generation
                               ↓
                   Interactive Reader Interface
```

### Tech Stack
- **Backend**: FastAPI, PostgreSQL, SQLAlchemy, LangGraph
- **Frontend**: Next.js reference client; Theia Platform pilot; React, MathJax 4, Framer Motion
- **AI**: Claude Sonnet via Anthropic API
- **Compilation**: LaTeXML (Docker)

## Key Features

- **LaTeX Compilation**: Upload arXiv `.tar.gz` files, compile to semantic HTML5
- **Knowledge Graph**: Extract symbols, definitions, theorems with occurrence tracking
- **Semantic Tooltips**: AI-suggested explanations based on expertise level
- **Manual Annotations**: Add paragraph-level comments
- **Interactive UI**: Visual knowledge graph, MathML rendering, smooth navigation

## Docker Compose Commands

```bash
# Start services
docker compose up -d

# View logs (all services)
docker compose logs -f

# View logs (specific service)
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres

# Restart a service
docker compose restart backend

# Stop all services
docker compose down

# Stop and remove volumes (WARNING: deletes database)
docker compose down -v

# Pull latest images
docker compose pull

# Rebuild services (after code changes)
docker compose up -d --build
```

## Database Management

```bash
# Connect to database (Docker Compose)
docker compose exec postgres psql -U scholaragent -d scholaragent

# Connect to database (local source setup)
psql -U scholaragent -d scholaragent

# Common SQL commands
\dt              # List tables
\d papers        # Describe papers table
\d tooltips      # Describe tooltips table
\q               # Quit

# Backup database
docker compose exec postgres pg_dump -U scholaragent scholaragent > backup.sql

# Restore database
docker compose exec -T postgres psql -U scholaragent scholaragent < backup.sql
```

## Debugging

### Check service status
```bash
docker compose ps
```

### View container logs
```bash
# Follow all logs
docker compose logs -f

# Last 100 lines from backend
docker compose logs --tail=100 backend

# Search logs for errors
docker compose logs backend | grep -i error
```

### Restart failed services
```bash
docker compose restart backend
```

### Inspect database connection
```bash
docker compose exec backend env | grep DATABASE
```

### Test API health
```bash
curl http://localhost:8000/
# Expected: {"message": "Welcome to Scholar Agent API"}
```

### Reset everything (Docker Compose)
```bash
docker compose down -v
docker compose up -d
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/papers/upload` | POST | Upload and compile paper |
| `/api/papers/{id}` | GET | Get paper with HTML + metadata |
| `/api/papers/{id}/compile` | POST | Recompile paper |
| `/api/papers/{id}/build-knowledge-graph` | POST | Build knowledge graph (SSE) |
| `/api/papers/{id}/knowledge-graph` | GET | Get graph data |
| `/api/papers/{id}/tooltips` | GET/POST | List or create tooltips |
| `/api/papers/{id}/tooltips/suggest` | POST | Suggest semantic tooltips |
| `/api/papers/{id}/tooltips/apply` | POST | Apply suggested tooltips |

Full API docs: `http://localhost:8000/docs`

## Testing

```bash
# Backend tests
.venv/bin/pytest tests/ -v

# Frontend tests
cd frontend && npm test

# With coverage
.venv/bin/pytest --cov=backend tests/
cd frontend && npm run test:coverage
```

## Project Structure

```
ScholarAgent/
├── backend/
│   ├── app/
│   │   ├── api/main.py          # FastAPI endpoints
│   │   ├── agents/              # LangGraph pipelines
│   │   ├── compiler/            # LaTeXML compilation
│   │   └── database/            # SQLAlchemy models
│   └── alembic/                 # Database migrations
├── frontend/
│   ├── app/                     # Next.js pages
│   ├── components/reader/       # Paper viewer components
│   ├── hooks/                   # React hooks
│   └── lib/                     # Utilities & design system
├── storage/                     # Uploaded papers + compiled HTML
├── tests/                       # Backend pytest tests
└── docker-compose.yml           # Production deployment
```

## Documentation

All reference docs are in `docs/`:

- `docs/backend-architecture.md` - Backend module structure, models, API endpoints
- `docs/frontend-architecture.md` - Frontend component tree, data flow, entity styling
- `docs/kg-pipeline.md` - Knowledge graph extraction pipeline architecture
- `docs/kg-todos.md` - Knowledge graph feature backlog
- `docs/design-system.md` - Design tokens, reusable components, color palette
- `docs/testing.md` - Test strategy and guidelines
- `docs/roadmap.md` - Feature roadmap

## Common Issues

### "Connection refused" on startup
Wait 10-15 seconds for PostgreSQL to initialize, then restart backend:
```bash
docker compose restart backend
```

### LaTeXML compilation fails
Check Docker socket access:
```bash
docker compose exec backend ls -l /var/run/docker.sock
```

### Frontend can't reach backend
Verify backend is running:
```bash
docker compose logs backend
curl http://localhost:8000/
```

### Database migration errors
Reset database (Docker Compose):
```bash
docker compose down -v
docker compose up -d
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes and test locally
4. Run tests: `pytest tests/ && cd frontend && npm test`
5. Commit: `git commit -m "feat: add feature"`
6. Push and create pull request

## License

[Add license information]

## Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Documentation**: See docs above
- **API Key**: Get Anthropic API key at [console.anthropic.com](https://console.anthropic.com/)
