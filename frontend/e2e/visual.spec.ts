import { expect, test, type Page } from '@playwright/test'

/**
 * Canonical visual states of the Theia frontend.
 *
 * Baselines: `e2e/__screenshots__/`. Update intentionally changed baselines
 * with `mise run visual-baseline` (or `npx playwright test --update-snapshots`).
 * Failures produce expected/actual/diff triplets in `e2e/test-results/`,
 * which `scripts/visual-triage.mjs` describes via the local VLM.
 */

async function openShell(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.theia-ApplicationShell').waitFor({ state: 'visible', timeout: 60_000 })
  // The shell element exists underneath Theia's `.theia-preload` spinner
  // overlay; wait until the overlay is actually gone (it fades via opacity
  // before being detached, so check computed style, not just visibility).
  await page.waitForFunction(() => {
    const preload = document.querySelector('.theia-preload')
    if (!preload) return true
    const style = window.getComputedStyle(preload)
    return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0
  }, undefined, { timeout: 60_000 })
  // Real shell chrome rendered = layout restoration finished.
  await page.locator('#theia-statusBar').waitFor({ state: 'visible', timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready)
  // Let layout restoration and widget activation settle.
  await page.waitForTimeout(2_000)
}

async function openLibraryView(page: Page): Promise<void> {
  const libraryTree = page.locator('.scholar-library-tree')
  if (!(await libraryTree.first().isVisible().catch(() => false))) {
    // The library ships collapsed in the left sidebar; expand it via its shell tab.
    await page.locator('[id="shell-tab-scholar-agent:library"]').click()
  }
  await libraryTree.first().waitFor({ state: 'visible', timeout: 15_000 })
}

test('application shell', async ({ page }) => {
  await openShell(page)
  await expect(page).toHaveScreenshot('application-shell.png')
})

test('paper reader', async ({ page }) => {
  await openShell(page)
  await openLibraryView(page)

  const firstPaper = page.locator('.scholar-library-tree .theia-TreeNode').first()
  await firstPaper.waitFor({ state: 'visible', timeout: 15_000 })
  await firstPaper.dblclick()

  const renderer = page.locator('.html-renderer').first()
  await renderer.waitFor({ state: 'visible', timeout: 30_000 })
  // Wait for MathJax typesetting when the paper contains math.
  await page
    .waitForFunction(() => document.querySelectorAll('mjx-container').length > 0, undefined, { timeout: 20_000 })
    .catch(() => undefined)
  await page.waitForTimeout(2_000)

  // The chat panel renders persisted conversations (backend DB state), so its
  // content is not deterministic across machines/runs — mask the whole widget.
  await expect(page).toHaveScreenshot('paper-reader.png', {
    mask: [page.locator('[id="scholar-agent:chat"]')],
  })
})
