# Development Setup Guide

Complete guide to setting up Scholar Agent development environment.

---

## Prerequisites

### Required
- **Python 3.12+** with `uv` package manager
- **Node.js 18+** with npm
- **PostgreSQL 14+**
- **Docker** (for LaTeXML compilation)
- **Git**

### System-Specific Notes

#### Arch Linux (CachyOS)
```bash
sudo pacman -S python python-pip nodejs npm postgresql docker git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER  # Re-login after this
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install python3 python3-pip nodejs npm postgresql postgresql-contrib docker.io git
sudo systemctl enable --now postgresql docker
sudo usermod -aG docker $USER  # Re-login after this
```

#### macOS
```bash
brew install python node postgresql docker git
brew services start postgresql
```

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
cd frontend
npm install
cd ..
```

### 4. PostgreSQL Setup

#### Option A: Docker (Recommended)
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

#### Option B: System PostgreSQL
```bash
# Linux
sudo systemctl start postgresql
sudo systemctl enable postgresql

# macOS
brew services start postgresql

# Create database and user
sudo -u postgres psql
CREATE DATABASE scholaragent;
CREATE USER scholaragent WITH PASSWORD 'scholaragent';
GRANT ALL PRIVILEGES ON DATABASE scholaragent TO scholaragent;
\q
```

#### Configure database connection
Create `.env` file in project root:
```bash
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://scholaragent:scholaragent@localhost/scholaragent
ANTHROPIC_API_KEY=your-anthropic-key
```

For OpenRouter instead:
```
DATABASE_URL=postgresql://scholaragent:scholaragent@localhost/scholaragent
OPENROUTER_API_KEY=your-openrouter-key
```

Then choose the provider and, for OpenRouter, the models in the app's `AI Settings` dialog.

### 5. Database Migrations

```bash
cd backend

# Initialize Alembic (first time only)
alembic init alembic

# Create initial migration
alembic revision --autogenerate -m "Initial schema: papers and tooltips"

# Apply migrations
alembic upgrade head

cd ..
```

### 6. Docker Setup for LaTeXML

#### Pull LaTeXML image (ar5ivist - official arXiv converter)
```bash
docker pull latexml/ar5ivist
```

#### Test LaTeXML (optional)
```bash
# Test with a sample .tex file
# ar5ivist has latexmlc as entrypoint, so no need to specify it
docker run --rm \
  -v $(pwd)/test:/source:ro \
  -v $(pwd)/output:/output \
  latexml/ar5ivist \
  /source/test.tex \
  --dest=/output/output.html \
  --format=html5 \
  --pmml \
  --cmml
```

**Note**: The application will automatically use this Docker image for compiling LaTeX papers.

---

## Running the Application

### Development Mode

#### Option 1: Full stack (Next.js + FastAPI + Electron)
```bash
cd frontend
npm run dev:desktop
```

This will start:
- Backend API on `http://localhost:8000`
- Frontend on `http://localhost:3000`
- Electron desktop app

#### Option 2: Backend only
```bash
cd frontend
npm run dev:backend
```

Or manually:
```bash
uv run uvicorn backend.app.api.main:app --reload --port 8000
```

#### Option 3: Frontend only (requires backend running separately)
```bash
cd frontend
npm run dev
```

### Production Mode

```bash
cd frontend
npm run build
npm start
```

---

## IDE Setup

### PyCharm / IntelliJ IDEA

1. **Open project** in PyCharm
2. **Configure Python interpreter**:
   - File → Settings → Project → Python Interpreter
   - Add Interpreter → Existing
   - Select `.venv/bin/python`
3. **Enable Node.js support**:
   - File → Settings → Languages & Frameworks → Node.js
   - Node interpreter: `/usr/bin/node`
   - Package manager: npm
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
curl http://localhost:8000/
# Expected: {"message": "Welcome to Scholar Agent API"}
```

### Frontend
Open browser to `http://localhost:3000`

### Database
```bash
psql -U scholaragent -d scholaragent -c "SELECT version();"
```

### Docker
```bash
docker run --rm arxivvanity/engrafo latexml --version
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
sudo systemctl status postgresql
sudo systemctl start postgresql
psql -U postgres -l | grep scholaragent
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

# Kill process
kill -9 <PID>

# Or change port in .env / next.config.mjs
```

### Issue: Alembic migration errors
**Solution**:
```bash
# Drop all tables and start fresh (DEV ONLY)
psql -U scholaragent -d scholaragent
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
\q

# Re-run migrations
cd backend
alembic upgrade head
```

---

## Environment Variables

### Required (`.env`)
```bash
DATABASE_URL=postgresql://scholaragent:password@localhost/scholaragent
```

### Optional
```bash
# Backend
BACKEND_PORT=8000
BACKEND_HOST=0.0.0.0
DEBUG=true

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000

# Docker
LATEXML_IMAGE=arxivvanity/engrafo
```

---

## Testing Setup

### Backend Tests
```bash
# Create test database
sudo -u postgres psql
CREATE DATABASE scholaragent_test;
GRANT ALL PRIVILEGES ON DATABASE scholaragent_test TO scholaragent;
\q

# Run tests
pytest tests/
```

### Frontend Tests
```bash
cd frontend
npm test
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
   pytest tests/
   cd frontend && npm test
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
cd backend && alembic upgrade head
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
cd frontend && npm update

# Add new dependency
npm install <package>

# Remove dependency
npm uninstall <package>
```

---

## Next Steps

After setup is complete:

1. Read `Design Document.md` for architecture overview
2. Review `REWORK_PLAN.md` for current refactoring status
3. Check `TESTING.md` for testing guidelines
4. Explore `AGENTS.md` for custom slash commands

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
cd frontend && npm update
```

### Database Backups
```bash
# Weekly backup (add to cron)
pg_dump -U scholaragent scholaragent > ~/backups/scholaragent_$(date +%Y%m%d).sql
```

### Docker Image Updates
```bash
# Update LaTeXML
docker pull latexml/ar5ivist

# Update PostgreSQL (backup first!)
pg_dump -U scholaragent scholaragent > backup.sql
docker stop scholaragent-db
docker rm scholaragent-db
docker pull postgres:16
# Re-run PostgreSQL setup from section 4
```
