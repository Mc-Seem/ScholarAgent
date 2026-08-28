---
name: visual-check
description: Run the Theia frontend visual regression suite (Playwright screenshots) and triage diffs with the local VLM. Use when asked to check for visual regressions, verify UI changes, investigate visual inconsistencies, or update screenshot baselines.
---

#### Visual Check

Automated visual regression workflow for the Scholar Agent Theia frontend.
It replaces manual "screenshot and describe the inconsistency" loops.

##### Architecture

1. `frontend/e2e/visual.spec.ts` (Playwright) captures canonical UI states and
   compares them against committed baselines in `frontend/e2e/__screenshots__/`.
   Baselines are per-platform (`*-darwin.png`, `*-linux.png`, ...) because font
   rasterization differs across OSes; each machine only compares against its own.
2. On mismatch, Playwright writes `*-expected.png` / `*-actual.png` / `*-diff.png`
   triplets into `frontend/e2e/test-results/`.
3. `frontend/scripts/visual-triage.mjs` sends each triplet to a local
   OpenAI-compatible VLM (default: Junie Local, Qwen3.6-27B at
   `http://localhost:19239/v1`) which classifies each diff as
   `regression` / `intentional-looking-change` / `rendering-noise` and writes
   `frontend/e2e/visual-report.md`.

##### Preconditions

- Postgres running (`docker compose up -d` / container `scholaragent-db`) with at least one paper imported.
- Theia browser bundle built: `mise exec -- npm --prefix frontend run theia:build:browser`
  (required after any frontend code change; Playwright auto-starts the backend and Theia servers, but does not rebuild).
- For triage: Junie Local running (Qwen3.6-27B-4bit via mlx-vlm; the user installs it once with the
  `/local` command). When installed, manage it with `~/.local/share/junie-local/current/serverctl.sh`
  (`status` / `start` / `health` / `wait`); probe readiness via `curl http://localhost:19239/v1/models`.
  Alternatively set `SCHOLAR_VLM_BASE_URL` / `SCHOLAR_VLM_MODEL` to another OpenAI-compatible vision
  endpoint. On the Linux/CachyOS machine (RX 9070 XT, 16 GB VRAM) use Ollama with ROCm:
  `SCHOLAR_VLM_BASE_URL=http://localhost:11434/v1 SCHOLAR_VLM_MODEL=qwen2.5vl:7b`.
  Triage is optional — without a reachable VLM the tests still run and diffs can be reviewed manually.

##### Commands (from project root)

- `mise run visual-check` — run the suite, then triage any diffs with the VLM. Exit code reflects test result.
- `mise run visual-baseline` — re-capture baselines after an intentional UI change, or once on a new
  platform without committed baselines. Review the updated PNGs before committing.
- `mise exec -- npm --prefix frontend run visual:triage` — triage-only (re-run on existing artifacts).

##### Interpreting results

- Read `frontend/e2e/visual-report.md` first: it contains per-failure classification, severity,
  affected components, and a suggested action.
- Treat `regression` findings as bugs to fix; verify `intentional-looking-change` against the change
  being worked on and update baselines if it is expected; ignore `rendering-noise` unless recurring
  (then mask the flaky region in the spec or raise `maxDiffPixelRatio`).
- The VLM only describes diffs found by the pixel comparison — do not ask it to find differences itself.

##### Extending coverage

Add new canonical states to `frontend/e2e/visual.spec.ts` (one `test` per state:
navigate/interact, wait for deterministic readiness markers, then `toHaveScreenshot`).
Useful selectors: `.theia-ApplicationShell`, `.scholar-library-tree`, `.html-renderer`,
`mjx-container` (MathJax done), `.scholar-chat-widget`, `.react-flow` (KG view).
Then run `mise run visual-baseline` to create the new baseline.

##### Interactive inspection

For ad-hoc "go look at the UI" checks (not regression testing), use the `playwright`
MCP server configured in `.junie/mcp/mcp.json` to drive a live browser against
`http://localhost:3000` while `mise run dev-theia-browser` is running.
