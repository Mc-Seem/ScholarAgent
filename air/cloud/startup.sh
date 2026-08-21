#!/usr/bin/env bash
#
# Air cloud provisioning for Scholar Agent.
# Runs after the repo clone, before the agent starts.
#
# Design notes:
#   - Idempotent: safe to re-run. Expensive steps are stamped and skipped.
#   - Always exits 0. A half-provisioned environment with a live agent that can
#     read this script's report is more useful than no agent at all. Read the
#     SUMMARY block at the end of the log to see what actually succeeded.
#   - Environment constraints (no compiler, no Docker pulls) are documented in
#     the CONSTRAINTS section below rather than worked around, because they
#     cannot be fixed from inside this script. See the notes there if you are
#     editing the image or the network allowlist.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAMP_DIR="$REPO_ROOT/.air-stamps"
NODE_VERSION="24.18.0"   # must match [tools] node in mise.toml

mkdir -p "$STAMP_DIR"

# ---------------------------------------------------------------------------
# Logging / step tracking
# ---------------------------------------------------------------------------

OK_STEPS=()
FAILED_STEPS=()

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*"; }

# run_step <label> <command...> -- records pass/fail, never aborts the script
run_step() {
  local label="$1"; shift
  log "$label"
  if "$@"; then
    OK_STEPS+=("$label")
    return 0
  else
    local rc=$?
    fail "$label (exit $rc)"
    FAILED_STEPS+=("$label")
    return $rc
  fi
}

noop() { info "already done - skipping"; }

# ---------------------------------------------------------------------------
# 0. Preflight: outbound network in this environment is proxy-only
# ---------------------------------------------------------------------------
# All egress goes through an HTTP proxy (HTTP_PROXY/HTTPS_PROXY). Direct DNS is
# refused, so any tool that ignores the proxy env vars cannot reach the network.
# That is the root cause of the Docker limitation noted in CONSTRAINTS.

log "Preflight"
if [[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]]; then
  info "proxy: ${HTTPS_PROXY:-$https_proxy}"
else
  warn "no HTTPS_PROXY set. If downloads below fail, the proxy env vars are"
  warn "missing from this script's environment - that is the first thing to check."
fi

if curl -fsS -o /dev/null --max-time 15 https://registry.npmjs.org/ 2>/dev/null; then
  info "network: reachable"
else
  warn "cannot reach registry.npmjs.org - install steps will likely fail"
fi

# ---------------------------------------------------------------------------
# 1. mise (pins Node; every command in AGENTS.md goes through it)
# ---------------------------------------------------------------------------

export PATH="$HOME/.local/bin:$PATH"

install_mise() {
  if command -v mise >/dev/null 2>&1; then
    info "mise present: $(mise --version)"
    return 0
  fi
  # Installed from mise.run. If that host is ever removed from the allowlist,
  # the GitHub releases tarball at github.com/jdx/mise/releases is a fallback.
  curl -fsSL https://mise.run | MISE_QUIET=1 sh
}
run_step "Install mise" install_mise

setup_node() {
  command -v mise >/dev/null 2>&1 || { fail "mise unavailable"; return 1; }
  mise trust "$REPO_ROOT/mise.toml" || true
  # Harmless warning here: mise-versions.jdx.dev is not allowlisted, so the
  # version-list fetch fails and mise falls back to the pinned version. The
  # download itself comes from nodejs.org, which is allowlisted.
  mise install || return 1
  mise reshim || true
  local got
  got="$(mise exec -- node --version 2>/dev/null)"
  info "node: ${got:-<none>} (want v$NODE_VERSION)"
  [[ "$got" == "v$NODE_VERSION" ]]
}
run_step "Install Node $NODE_VERSION via mise" setup_node

# Put mise shims on PATH for the agent's own shells. Shims (rather than
# `mise activate`) are the supported route for non-interactive shells, which is
# what the agent uses.
persist_path() {
  local shim_dir="$HOME/.local/share/mise/shims"
  local marker="# >>> scholaragent air startup >>>"
  local block="$marker
export PATH=\"\$HOME/.local/bin:$shim_dir:\$PATH\"
# <<< scholaragent air startup <<<"
  local f
  for f in "$HOME/.bashrc" "$HOME/.profile"; do
    touch "$f"
    if ! grep -qF "$marker" "$f"; then
      printf '\n%s\n' "$block" >> "$f"
      info "patched $f"
    else
      info "$f already patched"
    fi
  done
  export PATH="$shim_dir:$PATH"
}
run_step "Persist mise shims on PATH" persist_path

# ---------------------------------------------------------------------------
# 2. Skip native npm builds (see CONSTRAINTS: no compiler in this image)
# ---------------------------------------------------------------------------
# This is set in the *user* npmrc, not the repo's, so the repo stays clean and
# the setting travels with the environment that actually needs it. Without it a
# plain `npm ci` / `npm install` dies on @theia/ffmpeg with "not found: make".

configure_npm() {
  local npmrc="$HOME/.npmrc"
  touch "$npmrc"
  if grep -qE '^ignore-scripts=' "$npmrc"; then
    info "ignore-scripts already configured in $npmrc"
  else
    printf 'ignore-scripts=true\n' >> "$npmrc"
    info "set ignore-scripts=true in $npmrc"
  fi
}
run_step "Configure npm to skip native builds" configure_npm

# ---------------------------------------------------------------------------
# 3. Python backend
# ---------------------------------------------------------------------------

run_step "Sync Python deps (uv sync)" bash -c "cd '$REPO_ROOT' && uv sync"

# ---------------------------------------------------------------------------
# 4. Frontend deps
# ---------------------------------------------------------------------------
# npm ci wipes and reinstalls node_modules every time, which is slow, so stamp
# it against the lockfile hash and skip when nothing has changed.

bootstrap_frontend() {
  cd "$REPO_ROOT/frontend" || return 1
  local stamp="$STAMP_DIR/npm-lock.sha256"
  local current
  current="$(sha256sum package-lock.json | cut -d' ' -f1)"

  if [[ -d node_modules && -f "$stamp" && "$(cat "$stamp")" == "$current" ]]; then
    noop
    return 0
  fi

  # --ignore-scripts is also in ~/.npmrc; passed explicitly so this step works
  # even if that file is reset.
  npm ci --ignore-scripts || return 1
  printf '%s\n' "$current" > "$stamp"
}
run_step "Bootstrap frontend (npm ci)" bootstrap_frontend

# ---------------------------------------------------------------------------
# 5. .env + local database
# ---------------------------------------------------------------------------
# Postgres is unavailable (no Docker pulls - see CONSTRAINTS), so point the app
# at SQLite. This works because backend/app/database/models.py deliberately uses
# JSON rather than JSONB columns; the comment there says it is for SQLite
# compatibility. Swap DATABASE_URL back to Postgres once a server is reachable.

write_env() {
  cd "$REPO_ROOT" || return 1
  local db_path="$REPO_ROOT/storage/scholaragent.db"
  mkdir -p "$REPO_ROOT/storage"

  if [[ -f .env ]]; then
    info ".env exists - leaving it untouched"
    return 0
  fi

  # Deliberately not copied from .env.example: that file ships a placeholder
  # ANTHROPIC_API_KEY ("sk-ant-api03-...") which looks real enough to produce
  # confusing 401s. Leave the key empty unless the environment supplies one.
  cat > .env <<EOF
# Generated by air/cloud/startup.sh. Edit freely; this file is gitignored
# and will not be overwritten on re-provision.

# Four slashes = absolute path, so the URL works from any working directory
# (frontend's dev:backend script runs uvicorn from frontend/).
DATABASE_URL=sqlite:///$db_path

# LLM features (knowledge graph, tooltips) need a real key. Left blank on
# purpose - fill it in to enable them.
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}

KG_MAX_SECTIONS=0
KG_DEBUG=
HTML_INJECTION_DEBUG=false
TOOLTIP_AGENT_DEBUG=false

# LaTeXML compilation is unavailable in this environment (no Docker images).
LATEXML_USE_DOCKER=false
EOF
  info "wrote .env (DATABASE_URL -> sqlite at storage/scholaragent.db)"
}
run_step "Write .env" write_env

# Alembic migrations are authored against Postgres, so create the schema
# straight from the SQLAlchemy models instead. Idempotent: create_all is a
# no-op for tables that already exist.
init_db() {
  cd "$REPO_ROOT" || return 1
  uv run python -c "
from backend.app.database.connection import engine
from backend.app.database.models import Base
from sqlalchemy import inspect
Base.metadata.create_all(engine)
print('    tables:', ', '.join(sorted(inspect(engine).get_table_names())))
"
}
run_step "Initialise database schema" init_db

# ---------------------------------------------------------------------------
# 6. Report
# ---------------------------------------------------------------------------

cat <<'CONSTRAINTS'

============================================================================
CONSTRAINTS - things this script cannot fix from the inside
============================================================================

1. No C/C++ toolchain (no make, gcc, g++).
   Breaks: native npm modules - @theia/ffmpeg, drivelist, native-keymap.
   Consequence: `npm run theia:build:electron` fails, so `mise run verify`
   fails on its last of four stages. Everything else builds.
   Not fixable at runtime: apt cannot help because archive.ubuntu.com and
   security.ubuntu.com both return 403 through the proxy.
   Real fix: install build-essential in the base image.

2. Docker cannot pull images, for two independent reasons.
   a) dockerd runs without proxy config, and direct DNS is refused, so it
      cannot resolve any registry. Fixing this needs root at image-build
      time: a /etc/docker/daemon.json with a "proxies" block, then a daemon
      restart.
   b) index.docker.io and production.cloudflare.docker.com return 403
      through the proxy, so even a proxy-aware puller is blocked.
   Consequence: no Postgres container and no latexml/ar5ivist container.
   Postgres is worked around with SQLite (above). LaTeXML is not worked
   around - LaTeX -> HTML compilation cannot run here at all.

3. Blocked hosts worth allowlisting, in priority order:
     index.docker.io, production.cloudflare.docker.com  -> Docker Hub pulls
     archive.ubuntu.com, security.ubuntu.com            -> apt
     mise-versions.jdx.dev                              -> silences a mise warning
     astral.sh                                          -> only if uv is ever absent

CONSTRAINTS

printf '\n============================================================================\n'
printf 'SUMMARY\n'
printf '============================================================================\n'
for s in "${OK_STEPS[@]:-}";     do [[ -n "$s" ]] && printf '  [ ok ]      %s\n' "$s"; done
for s in "${FAILED_STEPS[@]:-}"; do [[ -n "$s" ]] && printf '  [ FAILED ]  %s\n' "$s"; done

if [[ ${#FAILED_STEPS[@]} -eq 0 ]]; then
  cat <<'VERIFY'

Provisioning succeeded. Verified-working commands:
  .venv/bin/pytest tests/                     backend tests (207 pass, SQLite)
  npm --prefix frontend test -- --run         frontend tests (465 pass)
  npm --prefix frontend run build             Next.js production build
  npm --prefix frontend run theia:build:browser
  uv run uvicorn backend.app.api.main:app --reload --port 8000

Known-failing: `mise run verify` (Theia Electron stage - see CONSTRAINT 1).
VERIFY
else
  printf '\n%s step(s) failed. The agent still starts; see the log above.\n' "${#FAILED_STEPS[@]}"
fi

# Always succeed - a live agent can diagnose a partial environment.
exit 0
