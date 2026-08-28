import { defineConfig } from '@playwright/test'

/**
 * Visual regression suite for the Theia frontend.
 *
 * - Baselines live in `e2e/__screenshots__/` (committed).
 * - Failure artifacts (actual/diff) land in `e2e/test-results/` (gitignored)
 *   and are triaged by `scripts/visual-triage.mjs` via a local VLM.
 * - Both servers are reused when already running (`mise run dev-theia-browser`),
 *   otherwise Playwright boots them. The Theia browser bundle must be built
 *   first: `npm run theia:build:browser`.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e/test-results/report.json' }],
  ],
  // `{platform}` keeps per-OS baselines (font rasterization differs across
  // macOS/Linux); capture them once per platform with `mise run visual-baseline`.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'uv run --project .. python -m uvicorn backend.app.api.main:app --port 8000 --app-dir ..',
      url: 'http://localhost:8000/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run start --workspace @scholar-agent/theia-browser',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
