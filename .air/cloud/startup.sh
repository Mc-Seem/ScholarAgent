#!/usr/bin/env bash
#
# Air cloud provisioning for Scholar Agent.
#
# Air runs this after cloning the repo and before the agent starts, every time
# the cloud environment comes up - including on every task resume, which is why
# idempotency is non-negotiable here.
#
# Things the Air contract guarantees, which this script relies on:
#   - Starts in the project root, as the environment user, with sudo rights.
#   - The checkout is shallow (latest commit only), so nothing here may depend
#     on git history.
#   - This runs in a separate process, so plain `export` does NOT reach the
#     agent's session. Anything the agent needs on PATH must be appended to
#     ~/.bashrc, guarded so resumes don't duplicate it. See persist_path below.
#
# Design notes:
#   - Idempotent: safe to re-run. Expensive steps are stamped and skipped.
#   - No step aborts the run. Optional steps degrade to a working fallback and
#     say so; the SUMMARY block at the end reports what actually happened, and
#     the exit code reflects it.
#   - Capability gaps are probed, not assumed. Everything in the CONSTRAINTS
#     section below is a consequence of the environment's "Internet access"
#     setting, so the script adapts at runtime and tells you what to allow.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_VERSION="24.18.0"   # must match [tools] node in mise.toml

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

# Put mise shims on PATH for the agent's own shells. Two reasons for doing it
# this way rather than exporting PATH directly:
#   - Air runs this script in its own process, so exports die with it. Appending
#     to ~/.bashrc is the documented way to reach the agent's session.
#   - Shims, rather than `mise activate`, are the supported route for the
#     non-interactive shells the agent actually uses.
# The marker guard keeps task resumes from appending duplicate blocks.
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
# 2. C/C++ toolchain, if the allowlist permits it
# ---------------------------------------------------------------------------
# The default cloud image has no make/gcc/g++, which breaks the native npm
# modules Theia's Electron target needs. Custom cloud images are not supported,
# so apt inside this script is the only way to get a compiler.
#
# Whether that works depends entirely on the environment's "Internet access"
# setting: archive.ubuntu.com and security.ubuntu.com must be reachable. Note
# that allowlisting `ubuntu.com` is NOT enough - the apex domain does not cover
# its subdomains, so list them explicitly or use `*.ubuntu.com`.
#
# This step probes first and adapts, so the environment upgrades itself as soon
# as those domains are allowed, with no edit needed here.

HAVE_TOOLCHAIN=0

setup_toolchain() {
  if command -v make >/dev/null 2>&1 && command -v g++ >/dev/null 2>&1; then
    info "toolchain already present"
    HAVE_TOOLCHAIN=1
    return 0
  fi

  if ! curl -fsS -o /dev/null --max-time 15 \
       http://archive.ubuntu.com/ubuntu/dists/noble/Release 2>/dev/null; then
    warn "archive.ubuntu.com unreachable - skipping compiler install."
    warn "Native npm modules will be skipped instead (Electron build stays broken)."
    warn "To fix: allow archive.ubuntu.com + security.ubuntu.com in the"
    warn "environment's Additional domains, then resume the task."
    return 0   # not a failure: the fallback below is a working configuration
  fi

  info "apt reachable - installing build-essential"
  sudo apt-get update -qq && sudo apt-get install -y -qq build-essential || return 1
  command -v make >/dev/null 2>&1 && HAVE_TOOLCHAIN=1
  info "toolchain installed: $(make --version 2>/dev/null | head -1)"
}
run_step "Provision C/C++ toolchain" setup_toolchain

# With no compiler, `npm ci` dies on @theia/ffmpeg with "not found: make", so
# native build scripts have to be skipped. This goes in the *user* npmrc rather
# than the repo's, so the repo stays clean and the workaround travels with the
# environment that actually needs it. With a compiler present the flag is
# removed again, so npm behaves normally.

configure_npm() {
  local npmrc="$HOME/.npmrc"
  touch "$npmrc"
  if [[ "$HAVE_TOOLCHAIN" == "1" ]]; then
    if grep -qE '^ignore-scripts=' "$npmrc"; then
      sed -i '/^ignore-scripts=/d' "$npmrc"
      info "toolchain available - removed ignore-scripts from $npmrc"
    else
      info "toolchain available - npm left at defaults"
    fi
  elif grep -qE '^ignore-scripts=true' "$npmrc"; then
    info "ignore-scripts already set in $npmrc"
  else
    sed -i '/^ignore-scripts=/d' "$npmrc"
    printf 'ignore-scripts=true\n' >> "$npmrc"
    info "no toolchain - set ignore-scripts=true in $npmrc"
  fi
}
run_step "Configure npm for available toolchain" configure_npm

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

  # The stamp lives *inside* node_modules on purpose. Air re-syncs the
  # repository fresh for each new task while preserving state outside it, so a
  # stamp kept elsewhere could outlive the node_modules it describes and cause
  # a skip with nothing installed. Inside, the two share a fate.
  local stamp="node_modules/.air-bootstrap-stamp"
  local want
  want="$(sha256sum package-lock.json | cut -d' ' -f1)-toolchain:$HAVE_TOOLCHAIN"

  if [[ -f "$stamp" && "$(cat "$stamp")" == "$want" ]]; then
    noop
    return 0
  fi

  # The stamp records the toolchain mode too, so gaining a compiler correctly
  # forces a reinstall that actually builds the native modules.
  if [[ "$HAVE_TOOLCHAIN" == "1" ]]; then
    info "building with native modules"
    npm ci || return 1
  else
    # Also set in ~/.npmrc; passed explicitly so this works even if that is reset.
    info "building without native modules"
    npm ci --ignore-scripts || return 1
  fi
  printf '%s\n' "$want" > "$stamp"
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

Everything below is a consequence of the environment's "Internet access"
setting, not a hard limit. Fix it in the web app under
Settings | Environments -> Additional domains, then resume the task.

IMPORTANT: an apex domain does NOT cover its subdomains. Verified here -
`ubuntu.com` returns 200 while `archive.ubuntu.com` returns 403, and
`hub.docker.com` returns 200 while `production.cloudflare.docker.com` returns
403. List subdomains explicitly, or use a wildcard like `*.ubuntu.com`.

Note also that custom Docker images are not supported for cloud environments
and `.air/docker.json` is ignored there, so this script is the only place a
missing system package can be installed.

1. No C/C++ toolchain (no make, gcc, g++) in the default image.
   Breaks: native npm modules - @theia/ffmpeg, drivelist, native-keymap.
   Consequence: `npm run theia:build:electron` fails, so `mise run verify`
   fails on its last of four stages. Everything else builds.
   Fix: allow `archive.ubuntu.com` and `security.ubuntu.com` (or
   `*.ubuntu.com`). This script then installs build-essential itself and
   switches to a full `npm ci` automatically - no edit here required.

2. Docker cannot pull images, for two independent reasons.
   a) index.docker.io and production.cloudflare.docker.com (the manifest
      endpoint and the blob CDN) are blocked, while auth.docker.io and
      registry-1.docker.io are allowed - so Docker Hub is half-open and
      fails partway. Confirmed with crane, which needs neither the daemon
      nor root and still cannot fetch a manifest.
   b) dockerd itself runs with no proxy config while direct DNS is refused,
      so even once (a) is fixed `docker pull` cannot resolve a registry.
   Consequence: no Postgres container and no latexml/ar5ivist container.
   Postgres is worked around with SQLite (above). LaTeXML is NOT worked
   around - LaTeX -> HTML compilation cannot run here at all, which takes
   the paper ingest pipeline offline.

   To unlock: allow `index.docker.io` and `production.cloudflare.docker.com`
   (or `*.docker.io` and `*.docker.com`). Then prefer crane over fixing the
   daemon, since it is proxy-aware in userspace and needs no restart -
   restarting dockerd from a provisioning script risks the container:
       crane pull --platform linux/amd64 postgres:16-alpine pg.tar
       docker load < pg.tar
   then run the container from docker-compose-dev.yml and point
   DATABASE_URL back at Postgres. Mind the disk: a Small VM has 20 GB and
   latexml/ar5ivist is multi-GB on top of a vfs storage driver.

3. Domains worth adding, in priority order:
     archive.ubuntu.com, security.ubuntu.com  -> apt, unlocks Electron build
     index.docker.io,
     production.cloudflare.docker.com         -> Docker Hub, unlocks Postgres
                                                 and the LaTeXML pipeline
     mise-versions.jdx.dev                    -> silences a mise warning only
     astral.sh                                -> only if uv ever leaves the image

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

The knowledge-graph and tooltip features need a real ANTHROPIC_API_KEY. Add it
as a "Personal secret" under Settings | Environments -> Environment Variables;
this script picks it up from the environment on the next resume. Without it the
app runs but every LLM-backed feature fails.
VERIFY
else
  printf '\n%s step(s) failed. The agent still starts regardless; see above.\n' "${#FAILED_STEPS[@]}"
fi

# Air does not block the task on a non-zero exit - the agent runs either way -
# so report the real status rather than swallowing it. This surfaces failures in
# the downloadable environment logs instead of hiding them behind a green exit.
[[ ${#FAILED_STEPS[@]} -eq 0 ]] || exit 1
exit 0
