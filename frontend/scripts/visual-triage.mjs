#!/usr/bin/env node
/**
 * Triage Playwright visual-regression failures with a local VLM.
 *
 * Scans `e2e/test-results/` for `*-expected.png` / `*-actual.png` / `*-diff.png`
 * triplets produced by failed `toHaveScreenshot()` assertions, sends each set to
 * an OpenAI-compatible vision endpoint, and writes `e2e/visual-report.md` with a
 * classified, human-readable description of every visual difference.
 *
 * Defaults target Junie Local (`/local` in Junie: mlx-vlm serving
 * Qwen3.6-27B-4bit at http://localhost:19239/v1). Override with:
 *   SCHOLAR_VLM_BASE_URL  e.g. http://localhost:11434/v1 (Ollama)
 *   SCHOLAR_VLM_MODEL     e.g. qwen2.5vl:7b (otherwise auto-discovered via /models)
 *   SCHOLAR_VLM_API_KEY   optional bearer token
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RESULTS_DIR = path.join(FRONTEND_DIR, 'e2e', 'test-results')
const REPORT_PATH = path.join(FRONTEND_DIR, 'e2e', 'visual-report.md')

const BASE_URL = (process.env.SCHOLAR_VLM_BASE_URL ?? 'http://localhost:19239/v1').replace(/\/$/, '')
const API_KEY = process.env.SCHOLAR_VLM_API_KEY

const SYSTEM_PROMPT = `You are a meticulous UI visual-regression triage assistant for Scholar Agent,
an academic paper reader built on Eclipse Theia (IDE-like shell: side panels, tabs, a paper view with
LaTeX/MathJax content, knowledge-graph panels, tooltips).

You receive three screenshots of one failed visual test: the EXPECTED baseline, the ACTUAL render,
and a DIFF mask highlighting changed pixels. The diff mask tells you WHERE changes are - trust it over
your own pixel comparison. Your job is to describe and classify, not to detect.

Respond with strict JSON (no markdown fences) matching:
{
  "classification": "regression" | "intentional-looking-change" | "rendering-noise",
  "severity": "high" | "medium" | "low",
  "affected_components": ["short names of affected UI areas"],
  "description": "2-4 sentences: what changed, where, and why you classified it that way",
  "suggested_action": "one sentence: what a developer should do next"
}`

async function findFailures(dir) {
  let entries
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true })
  } catch {
    return []
  }
  const failures = new Map()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    const match = entry.name.match(/^(.*)-(expected|actual|diff)\.png$/)
    if (!match) continue
    const key = path.join(entry.parentPath ?? entry.path, match[1])
    const failure = failures.get(key) ?? { name: match[1], dir: entry.parentPath ?? entry.path }
    failure[match[2]] = path.join(entry.parentPath ?? entry.path, entry.name)
    failures.set(key, failure)
  }
  return [...failures.values()]
}

async function resolveModel() {
  if (process.env.SCHOLAR_VLM_MODEL) return process.env.SCHOLAR_VLM_MODEL
  const response = await fetch(`${BASE_URL}/models`, { headers: authHeaders() })
  if (!response.ok) throw new Error(`GET ${BASE_URL}/models -> ${response.status}`)
  const body = await response.json()
  const model = body?.data?.[0]?.id
  if (!model) throw new Error(`No models reported by ${BASE_URL}/models`)
  return model
}

function authHeaders() {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}
}

async function imagePart(filePath) {
  const data = await readFile(filePath)
  return {
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${data.toString('base64')}` },
  }
}

async function triageFailure(model, failure) {
  const content = [{
    type: 'text',
    text: `Failed visual test: "${failure.name}". Images in order: EXPECTED baseline, ACTUAL render, DIFF mask.`,
  }]
  for (const kind of ['expected', 'actual', 'diff']) {
    if (failure[kind]) content.push(await imagePart(failure[kind]))
  }

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 700,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`POST ${BASE_URL}/chat/completions -> ${response.status}: ${await response.text()}`)
  }
  const body = await response.json()
  const raw = body?.choices?.[0]?.message?.content ?? ''
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*|\s*```$/g, '')
    return JSON.parse(jsonText)
  } catch {
    return { classification: 'unparsed', severity: 'unknown', affected_components: [], description: raw, suggested_action: 'Review manually.' }
  }
}

function renderReport(model, results) {
  const lines = [
    '# Visual regression triage report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Model: \`${model}\` at \`${BASE_URL}\``,
    `- Failures triaged: ${results.length}`,
    '',
  ]
  for (const { failure, verdict, error } of results) {
    lines.push(`## ${failure.name}`)
    lines.push('')
    if (error) {
      lines.push(`Triage failed: ${error}`)
    } else {
      lines.push(`- **Classification**: ${verdict.classification}`)
      lines.push(`- **Severity**: ${verdict.severity}`)
      if (verdict.affected_components?.length) {
        lines.push(`- **Affected components**: ${verdict.affected_components.join(', ')}`)
      }
      lines.push(`- **Description**: ${verdict.description}`)
      lines.push(`- **Suggested action**: ${verdict.suggested_action}`)
    }
    lines.push(`- **Artifacts**: \`${path.relative(FRONTEND_DIR, failure.dir)}\``)
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  const failures = await findFailures(RESULTS_DIR)
  if (failures.length === 0) {
    console.log('visual-triage: no snapshot failures found in e2e/test-results - nothing to triage.')
    return
  }

  let model
  try {
    model = await resolveModel()
  } catch (error) {
    console.error(`visual-triage: cannot reach the VLM endpoint at ${BASE_URL} (${error.message}).`)
    console.error('Start Junie Local with the /local command, or point SCHOLAR_VLM_BASE_URL at any OpenAI-compatible vision endpoint.')
    process.exitCode = 1
    return
  }

  console.log(`visual-triage: triaging ${failures.length} failure(s) with ${model} at ${BASE_URL}`)
  const results = []
  for (const failure of failures) {
    try {
      const verdict = await triageFailure(model, failure)
      results.push({ failure, verdict })
      console.log(`  - ${failure.name}: ${verdict.classification} (${verdict.severity})`)
    } catch (error) {
      results.push({ failure, error: error.message })
      console.error(`  - ${failure.name}: triage error - ${error.message}`)
    }
  }

  await writeFile(REPORT_PATH, renderReport(model, results))
  console.log(`visual-triage: report written to ${path.relative(FRONTEND_DIR, REPORT_PATH)}`)
}

await main()
