# Development Setup Guide

Complete guide to setting up Scholar Agent development environment.

---

## Prerequisites

### Required
- **mise** (installs the project-pinned Python 3.12 and Node.js 24.18.0)
- **uv** package manager
- **PostgreSQL 14+**
- **LaTeXML** (`latexmlc`) or Docker as a compatibility fallback
- **Git**

### System-Specific Notes

#### Arch Linux (CachyOS)
```bash
sudo pacman -S python python-pip mise postgresql docker git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER  # Re-login after this
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install python3 python3-pip postgresql postgresql-contrib docker.io git curl
curl https://mise.run | sh
sudo systemctl enable --now postgresql docker
sudo usermod -aG docker $USER  # Re-login after this
```

#### macOS
```bash
brew install git mise uv postgresql@17 latexml
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
brew services start postgresql@17
```

Apple Silicon users should follow the complete
[native M-series guide](docs/macos-apple-silicon.md). It avoids Rosetta, Docker,
and Linux-only PostgreSQL administration commands.

---

## Initial Setup

### 1. Clone Repository
```bash
git clone <repository-url>
cd ScholarAgent
```

### 2. Python Environment

#### Install uv (if not already installed)
```bash
pip install uv
```

#### Install Python dependencies
```bash
uv sync
```

This will:
- Create a virtual environment in `.venv/`
- Install all dependencies from `pyproject.toml`

### 3. Frontend Setup

```bash
mise trust
mise install
mise run bootstrap
```

The root `mise.toml` pins Python 3.12 and Node.js 24.18.0. `mise run bootstrap` and
`mise run verify` work without shell activation. To make ordinary `node` and
`npm` commands automatically use that version in Fish, add
`mise activate fish | source` to `~/.config/fish/config.fish` and restart the
shell.

### 4. PostgreSQL Setup

#### Option A: Native PostgreSQL (recommended on Apple Silicon)

For Homebrew service, role, and database commands, follow
[macOS Apple Silicon source setup](docs/macos-apple-silicon.md#3-create-the-postgresql-role-and-database).
On Linux, start the system service and create the role/database with the tools
provided by the distribution.

#### Option B: Docker
```bash
# Start PostgreSQL in Docker
docker run -d \
  --name scholaragent-db \
  -e POSTGRES_DB=scholaragent \
  -e POSTGRES_USER=scholaragent \
  -e POSTGRES_PASSWORD=scholaragent \
  -p 5432:5432 \
  -v scholaragent-db-data:/var/lib/postgresql/data \
  postgres:16

# Verify it's running
docker ps | grep scholaragent-db
```

After reboot, restart the container:
```bash
docker start scholaragent-db
```

#### Configure database connection
Create `.env` file in project root:
```bash
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://scholaragent:scholaragent@localhost:5432/scholaragent
```

### 5. Database Migrations

```bash
# From the repository root; migrations are already checked in.
uv run alembic -c backend/alembic.ini upgrade head
```

### 6. LaTeXML Setup

#### Native LaTeXML (recommended on Apple Silicon)

```bash
brew install latexml
# Keep LATEXML_USE_DOCKER=false in .env
latexmlc --VERSION
mise run doctor
```

See the [native compiler smoke test](docs/macos-apple-silicon.md#5-native-latexml-smoke-test)
for HTML5 plus Presentation/Content MathML validation.

#### Docker fallback

```bash
docker pull latexml/ar5ivist:latest
# Set LATEXML_USE_DOCKER=true in .env
```

#### Test LaTeXML (optional)
```bash
# Test with a sample .tex file
# ar5ivist has latexmlc as entrypoint, so no need to specify it
docker run --rm \
  -v "$(pwd)/tests/fixtures:/source:ro" \
  -v $(pwd)/output:/output \
  latexml/ar5ivist:latest \
  /source/simple_paper.tex \
  --dest=/output/output.html \
  --format=html5 \
  --pmml \
  --cmml
```

The Docker image is `linux/amd64` and runs through emulation on Apple Silicon;
reserve it for papers that need its additional TeX packages.

---

## Running the Application

### Development Mode

#### Option 1: Theia desktop + FastAPI (recommended)
```bash
mise run dev-theia-desktop
```

This will start:
- Backend API on `http://localhost:8000`
- Theia Electron desktop app

#### Option 2: Theia browser + FastAPI (recommended)
```bash
mise run dev-theia-browser
```

#### Option 3: Backend only
```bash
cd frontend
npm run dev:backend
```

Or manually:
```bash
uv run uvicorn backend.app.api.main:app --reload --port 8000 --reload-dir backend --reload-delay 1
```

#### Legacy Next.js UI (deprecated)

The standalone Next.js UI and its Electron wrapper remain available as
fallbacks, but they do not receive every new feature, including chat. New UI
development should target Theia.

```bash
# Browser UI only (requires backend running separately)
mise exec -- npm --prefix frontend run dev

# Electron UI + frontend + backend
mise exec -- npm --prefix frontend run dev:desktop
```

### Legacy Next.js Production Mode (deprecated)

```bash
mise exec -- npm --prefix frontend run build
mise exec -- npm --prefix frontend start
```

---

## IDE Setup

### PyCharm / IntelliJ IDEA

1. **Open project** in PyCharm
2. **Configure Python interpreter**:
   - File → Settings → Project → Python Interpreter
   - Add Interpreter → Existing
   - Select `.venv/bin/python`
3. **Configure Node.js and shared runs**:
   - Run `mise install`
   - Shared run configurations `Scholar Theia Browser`, `Scholar Theia Desktop`, and `Scholar Verify` execute the corresponding `mise` tasks, so their child processes always use the pinned runtime
   - Keep the bundled Shell Script plugin enabled; selecting the interpreter printed by `mise which node` as the project runtime remains useful for ad-hoc npm configurations
4. **Database tool**:
   - View → Tool Windows → Database
   - Add PostgreSQL datasource
   - Connection: `postgresql://localhost:5432/scholaragent`

### VS Code

1. **Install extensions**:
   - Python (ms-python.python)
   - Pylance (ms-python.vscode-pylance)
   - ESLint (dbaeumer.vscode-eslint)
   - Tailwind CSS IntelliSense
2. **Configure Python interpreter**:
   - Cmd/Ctrl+Shift+P → Python: Select Interpreter
   - Choose `.venv/bin/python`
3. **PostgreSQL extension**:
   - Install PostgreSQL (cweijan.vscode-postgresql-client2)
   - Connect to `postgresql://localhost:5432/scholaragent`

---

## Verification

### Backend
```bash
curl http://localhost:8000/health
```

### Frontend
For the browser workbench, open the URL printed by Theia during startup.

Run the complete frontend verification from the project root:
```bash
mise run verify
```

### Database
```bash
psql -U scholaragent -d scholaragent -c "SELECT version();"
```

### Native LaTeXML
```bash
latexmlc --VERSION
```

---

## Common Issues

### Issue: `uv` command not found
**Solution**:
```bash
pip install --user uv
# Or add ~/.local/bin to PATH
export PATH="$HOME/.local/bin:$PATH"
```

### Issue: PostgreSQL connection refused
**Solution**:
```bash
# If using Docker:
docker ps | grep scholaragent-db  # Check if running
docker start scholaragent-db       # Start if stopped
docker logs scholaragent-db        # Check for errors

# If using system PostgreSQL:
# Linux: sudo systemctl status postgresql
# macOS:
brew services list
psql 'postgresql://scholaragent:scholaragent@localhost:5432/scholaragent' -c 'SELECT 1;'
```

### Issue: Docker permission denied
**Solution**:
```bash
sudo usermod -aG docker $USER
# Log out and log back in
```

### Issue: Port 8000 or 3000 already in use
**Solution**:
```bash
# Find process using port
lsof -i :8000
lsof -i :3000

# Stop a stale process gracefully
kill <PID>

# Or change port in .env / next.config.mjs
```

The shared Theia run configurations start the backend themselves. Stop any
separately running backend before launching one of them.

### Issue: Alembic migration errors
**Solution**:
```bash
# Drop all tables and start fresh (DEV ONLY)
psql -U scholaragent -d scholaragent
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
\q

# Re-run migrations
uv run alembic -c backend/alembic.ini upgrade head
```

---

## Environment Variables

### Required (`.env`)
```bash
DATABASE_URL=postgresql://scholaragent:scholaragent@localhost:5432/scholaragent
LATEXML_USE_DOCKER=false
```

### Optional
```bash
# Backend
BACKEND_PORT=8000
BACKEND_HOST=0.0.0.0
DEBUG=true

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000

# Optional Docker LaTeXML fallback
LATEXML_USE_DOCKER=true
```

---

## Testing Setup

### Backend Tests
```bash
# From the repository root
.venv/bin/pytest tests/
```

### Frontend Tests
```bash
mise exec -- npm --prefix frontend test -- --run
```

---

## Development Workflow

1. **Create feature branch**:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes** and test locally

3. **Run tests**:
   ```bash
   .venv/bin/pytest tests/
   mise run verify
   ```

4. **Format code**:
   ```bash
   # Python (if using black/ruff)
   ruff format backend/

   # TypeScript (if using prettier)
   cd frontend && npx prettier --write .
   ```

5. **Commit changes**:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

6. **Push and create PR**:
   ```bash
   git push origin feature/my-feature
   ```

---

## Useful Commands

### Database
```bash
# Connect to database
psql -U scholaragent -d scholaragent

# Dump database
pg_dump -U scholaragent scholaragent > backup.sql

# Restore database
psql -U scholaragent scholaragent < backup.sql

# Reset database (DEV ONLY)
dropdb scholaragent && createdb scholaragent
uv run alembic -c backend/alembic.ini upgrade head
```

### Docker
```bash
# List running containers
docker ps

# View container logs
docker logs scholaragent-db
docker logs <container_id>

# Start/stop database
docker start scholaragent-db
docker stop scholaragent-db

# Clean up unused images
docker system prune -a

# Remove database (WARNING: deletes all data)
docker rm -f scholaragent-db
docker volume rm scholaragent-db-data
```

### Python
```bash
# Update dependencies
uv sync

# Add new dependency
uv add <package>

# Remove dependency
uv remove <package>
```

### Node
```bash
# Update dependencies
mise exec -- npm --prefix frontend update

# Add new dependency
mise exec -- npm --prefix frontend install <package>

# Remove dependency
mise exec -- npm --prefix frontend uninstall <package>
```

---

## Next Steps

After setup is complete:

1. Read `docs/` for architecture, testing, and design system docs
2. Explore `AGENTS.md` for custom slash commands

---

## Getting Help

- **Issues**: Check GitHub issues or create new one
- **Documentation**: See `Design Document.md` and code comments
- **Community**: [Add Discord/Slack link if available]

---

## Maintenance

### Update Dependencies
```bash
# Python
uv sync --upgrade

# Node
mise exec -- npm --prefix frontend update
```

### Database Backups
```bash
# Weekly backup (add to cron)
pg_dump -U scholaragent scholaragent > ~/backups/scholaragent_$(date +%Y%m%d).sql
```

### Docker Image Updates
```bash
# Update LaTeXML
docker pull latexml/ar5ivist:latest

# Update PostgreSQL (backup first!)
pg_dump -U scholaragent scholaragent > backup.sql
docker stop scholaragent-db
docker rm scholaragent-db
docker pull postgres:16
# Re-run PostgreSQL setup from section 4
```
