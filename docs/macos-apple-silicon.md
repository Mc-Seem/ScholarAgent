# macOS Apple Silicon source setup

This is the primary development path for an Apple Silicon Mac, including M5.
It runs Python, Node.js, PostgreSQL, LaTeXML, Theia Browser, and Theia Desktop
natively as `arm64`; Rosetta and Docker are not required.

## 1. Install native prerequisites

Install the Xcode command-line tools and Homebrew if needed:

```bash
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the Homebrew installer prompt that adds `/opt/homebrew/bin` to your
shell, then open a new terminal. Install the native tools:

```bash
brew install git mise uv postgresql@17 latexml
echo 'export PATH="$(brew --prefix postgresql@17)/bin:$PATH"' >> ~/.zprofile
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
brew services start postgresql@17
```

Confirm the terminal is native before continuing:

```bash
uname -m
# arm64
```

If it prints `x86_64`, quit the terminal, disable **Open using Rosetta** in its
Finder Info panel, and open it again. Do not install x86 Homebrew under
`/usr/local` for this setup.

## 2. Bootstrap the repository

```bash
git clone https://github.com/Mc-Seem/ScholarAgent.git
cd ScholarAgent
mise trust
mise install
mise exec -- uv sync --frozen
mise run bootstrap
cp .env.example .env
```

`mise.toml` pins Python 3.12 and Node.js 24.18.0. Edit `.env` and replace the
Anthropic placeholder if knowledge-graph features are needed. Keep these
native source settings:

```dotenv
DATABASE_URL=postgresql://scholaragent:scholaragent@localhost:5432/scholaragent
LATEXML_USE_DOCKER=false
```

## 3. Create the PostgreSQL role and database

Homebrew initializes PostgreSQL for the current macOS account; it does not
normally create a Linux-style `postgres` OS user. Run these commands without
`sudo`:

```bash
psql postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE scholaragent LOGIN PASSWORD 'scholaragent';
CREATE DATABASE scholaragent OWNER scholaragent;
SQL
```

For an existing setup, verify the connection instead of recreating it:

```bash
psql 'postgresql://scholaragent:scholaragent@localhost:5432/scholaragent' -c 'SELECT 1;'
```

Apply the checked-in migrations from the repository root through `uv`:

```bash
uv run alembic -c backend/alembic.ini upgrade head
```

Do not run `alembic init`; the migration environment and revisions already
exist in `backend/alembic/`.

## 4. Check the environment

```bash
mise run doctor
```

A successful run ends with `[ok] Environment is ready for Scholar Agent source development.`
Run it before either frontend. Every failure includes a corrective command and
checks the native architecture, pinned runtimes, `.env`, `latexmlc`, and the
database connection.

## 5. Native LaTeXML smoke test

The application invokes `latexmlc` with HTML5, Presentation MathML, and Content
MathML enabled. Test the Homebrew executable with the repository fixture:

```bash
smoke_dir="$(mktemp -d)"
trap 'rm -rf "$smoke_dir"' EXIT
latexmlc tests/fixtures/simple_paper.tex \
  "--dest=$smoke_dir/simple-paper.html" \
  --format=html5 --pmml --cmml
grep -q '<math' "$smoke_dir/simple-paper.html"
grep -q 'MathML-Content' "$smoke_dir/simple-paper.html"
echo 'OK: native HTML5 + Presentation/Content MathML'
```

The final `OK` is printed only if both MathML checks pass.

## 6. First launch

Each command builds its Theia target and starts the backend. Run one target at
a time from the repository root; stop it with **Ctrl+C** before switching.

### Theia Browser

```bash
mise run dev-theia-browser
```

Open <http://localhost:3000>. Confirm backend health separately with:

```bash
curl http://localhost:8000/health
```

### Theia Desktop

```bash
mise run dev-theia-desktop
```

The native Electron window should open automatically. This is a development
launch, not a signed/notarized distributable `.app`.

## 7. Repository verification

```bash
.venv/bin/pytest tests/ -q
mise run verify
```

`mise run verify` runs frontend tests and builds the legacy Next.js target plus
both Theia targets. The compiler and doctor branches are unit-tested with
mocked platform/process values, but that does not replace the `doctor`, native
smoke, Browser launch, and Desktop launch checks on the physical Mac.

> **Validation boundary:** while preparing this guide, the full backend suite
> passed with 279 tests, frontend verification passed with 498 tests, and the
> Next.js, Theia Browser, and Theia Electron builds completed successfully on
> Linux/x86_64. No M5 host or native `latexmlc` was available in that
> environment, so the four physical-Mac checks named above were not claimed as
> completed.

## Docker LaTeXML fallback

Homebrew LaTeXML is the recommended M5 path. Some papers may depend on TeX
packages available only in the ar5ivist image; for those papers, install and
start Docker Desktop, then change `.env`:

```dotenv
LATEXML_USE_DOCKER=true
```

```bash
docker pull latexml/ar5ivist:latest
mise run doctor
```

The published image is `linux/amd64`, is larger than 2 GB, and therefore runs
through emulation on Apple Silicon. Use it only as a compatibility fallback;
no Docker setting is needed for native mode.

## Troubleshooting

### `psql` is not found

```bash
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
```

Persist the same line in `~/.zprofile`, then retry `mise run doctor`.

### PostgreSQL is unreachable or port 5432 is busy

```bash
brew services restart postgresql@17
lsof -nP -iTCP:5432 -sTCP:LISTEN
psql "$DATABASE_URL" -c 'SELECT 1;'
```

The last command requires `DATABASE_URL` to be exported; otherwise paste the
URL from `.env`. Stop the conflicting service or update the port consistently
in PostgreSQL and `.env`.

### `latexmlc` is missing or fails its version check

```bash
brew reinstall latexml
latexmlc --VERSION
```

### Port 8000 or 3000 is busy

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Stop the stale development process before launching a shared Theia task; each
task starts its own backend.

### A complex paper fails only in native mode

First inspect the `latexmlc` diagnostic for a missing TeX package. Install the
package natively if available; otherwise use the Docker fallback above for
that paper.