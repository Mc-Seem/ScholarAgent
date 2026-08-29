import { afterEach, describe, expect, it, vi } from 'vitest'

import { sharedTermPalette } from '@/lib/design-system'
import type { EntityAlignment, ReadingSet, ReadingSetPaperSummary } from '@/lib/reading-set-api'
import type { ScholarReadingSetService } from '@/theia/scholar-extension/src/browser/scholar-reading-set-service'
import {
  SharedTermHighlighter,
  applySharedTermHighlights,
  buildSharedTermGroups,
  sharedTermColorsByKey,
} from '@/theia/scholar-extension/src/browser/scholar-shared-term-highlighter'

function alignment(id: string, overrides: Partial<EntityAlignment> = {}): EntityAlignment {
  return {
    id,
    reading_set_id: 'set-a',
    paper_a_id: 'paper-1',
    subject_a_id: 'subject-1',
    label_a: 'Policy Improvement',
    paper_b_id: 'paper-2',
    subject_b_id: 'subject-2',
    label_b: 'policy iteration step',
    method: 'deterministic',
    score: 1,
    confidence: 'high',
    status: 'auto',
    rationale: null,
    created_at: '2026-08-29T00:00:00Z',
    ...overrides,
  }
}

/** A pair record between (paperA, subjectA) and (paperB, subjectB). */
function pair(
  id: string,
  a: readonly [string, string],
  b: readonly [string, string],
  overrides: Partial<EntityAlignment> = {},
): EntityAlignment {
  return alignment(id, {
    paper_a_id: a[0],
    subject_a_id: a[1],
    paper_b_id: b[0],
    subject_b_id: b[1],
    ...overrides,
  })
}

describe('buildSharedTermGroups', () => {
  it('merges transitively linked subjects into one group across three papers', () => {
    const groups = buildSharedTermGroups([
      pair('a-b', ['paper-a', 's-1'], ['paper-b', 's-2']),
      pair('b-c', ['paper-b', 's-2'], ['paper-c', 's-3']),
      pair('other', ['paper-a', 's-9'], ['paper-c', 's-8']),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual([
      { paperId: 'paper-a', subjectId: 's-1' },
      { paperId: 'paper-b', subjectId: 's-2' },
      { paperId: 'paper-c', subjectId: 's-3' },
    ])
    expect(groups[1]).toEqual([
      { paperId: 'paper-a', subjectId: 's-9' },
      { paperId: 'paper-c', subjectId: 's-8' },
    ])
  })

  it('leaves rejected and stale alignments out of every group', () => {
    const groups = buildSharedTermGroups([
      pair('kept', ['paper-a', 's-1'], ['paper-b', 's-2']),
      pair('rejected', ['paper-a', 's-3'], ['paper-b', 's-4'], { status: 'rejected' }),
      pair('stale', ['paper-a', 's-5'], ['paper-b', 's-6'], { status: 'stale' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].map(member => member.subjectId)).toEqual(['s-1', 's-2'])
  })
})

describe('sharedTermColorsByKey', () => {
  it('gives every member of a group the same color and neighbouring groups different ones', () => {
    const groups = buildSharedTermGroups([
      pair('a-b', ['paper-a', 's-1'], ['paper-b', 's-2']),
      pair('b-c', ['paper-b', 's-2'], ['paper-c', 's-3']),
      pair('other', ['paper-a', 's-9'], ['paper-c', 's-8']),
    ])

    const colors = sharedTermColorsByKey(groups)

    expect(colors.get('paper-a::s-1')).toBe(sharedTermPalette[0])
    expect(colors.get('paper-b::s-2')).toBe(sharedTermPalette[0])
    expect(colors.get('paper-c::s-3')).toBe(sharedTermPalette[0])
    expect(colors.get('paper-a::s-9')).toBe(sharedTermPalette[1])
    expect(colors.get('paper-c::s-8')).toBe(sharedTermPalette[1])
  })

  it('spreads the whole palette across groups before repeating a color', () => {
    const groupCount = sharedTermPalette.length + 2
    const groups = buildSharedTermGroups(
      Array.from({ length: groupCount }, (_, index) =>
        pair(`pair-${index}`, ['paper-a', `a-${index}`], ['paper-b', `b-${index}`])),
    )

    const colors = sharedTermColorsByKey(groups)
    const groupColors = groups.map(
      (_, index) => colors.get(`paper-a::a-${index}`),
    )

    expect(new Set(groupColors.slice(0, sharedTermPalette.length)).size)
      .toBe(sharedTermPalette.length)
    expect(groupColors[sharedTermPalette.length]).toBe(sharedTermPalette[0])
    expect(groupColors[sharedTermPalette.length + 1]).toBe(sharedTermPalette[1])
  })
})

function paperSummary(id: string): ReadingSetPaperSummary {
  return {
    id,
    filename: `${id}.tar.gz`,
    arxiv_id: null,
    title: null,
    has_html: true,
    has_knowledge_graph: true,
    added_at: '2026-08-29T00:00:00Z',
  }
}

function readingSet(id: string, paperIds: string[]): ReadingSet {
  return {
    id,
    name: `Set ${id}`,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    papers: paperIds.map(paperSummary),
  }
}

function paperRoot(paperId: string, subjectIds: string[]): HTMLElement {
  const root = document.createElement('div')
  root.dataset.scholarPaperId = paperId
  for (const subjectId of subjectIds) {
    const span = document.createElement('span')
    span.className = 'kg-entity'
    span.dataset.subjectId = subjectId
    root.appendChild(span)
  }
  document.body.appendChild(root)
  return root
}

function entitySpans(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.kg-entity'))
}

describe('applySharedTermHighlights', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('paints only the colored subjects and removes exactly that paint on cleanup', () => {
    const rootA = paperRoot('paper-a', ['s-1', 's-plain'])
    const rootB = paperRoot('paper-b', ['s-2'])
    const colors = new Map([
      ['paper-a::s-1', '#f59e0b'],
      ['paper-b::s-2', '#f59e0b'],
    ])

    const cleanup = applySharedTermHighlights(colors)

    const [aligned, plain] = entitySpans(rootA)
    const [alignedB] = entitySpans(rootB)
    expect(aligned.classList.contains('scholar-shared-term')).toBe(true)
    expect(aligned.style.getPropertyValue('--scholar-shared-term-color')).toBe('#f59e0b')
    expect(alignedB.classList.contains('scholar-shared-term')).toBe(true)
    expect(plain.classList.contains('scholar-shared-term')).toBe(false)

    cleanup()

    expect(aligned.classList.contains('scholar-shared-term')).toBe(false)
    expect(aligned.style.getPropertyValue('--scholar-shared-term-color')).toBe('')
    expect(alignedB.classList.contains('scholar-shared-term')).toBe(false)
  })
})

describe('SharedTermHighlighter', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function fakeService(sets: ReadingSet[], alignments: EntityAlignment[]) {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      getSnapshot: vi.fn(() => ({
        readingSets: sets,
        loading: false,
        error: null,
        alignmentBuilds: {},
      })),
      alignmentsOf: vi.fn(() => alignments),
      loadAlignments: vi.fn().mockResolvedValue(alignments),
    } as unknown as ScholarReadingSetService
  }

  it('prefers the reading set that contains the active paper', () => {
    const sets = [
      readingSet('set-1', ['paper-x', 'paper-y']),
      readingSet('set-2', ['paper-a', 'paper-b']),
    ]

    const candidate = SharedTermHighlighter.candidateSet(
      sets,
      ['paper-a', 'paper-b', 'paper-x', 'paper-y'],
    )

    expect(candidate?.id).toBe('set-2')
  })

  it('paints on the first toggle and cleanly removes the paint on the second', async () => {
    const rootA = paperRoot('paper-a', ['s-1'])
    const rootB = paperRoot('paper-b', ['s-2'])
    const service = fakeService(
      [readingSet('set-a', ['paper-a', 'paper-b'])],
      [pair('a-b', ['paper-a', 's-1'], ['paper-b', 's-2'])],
    )
    const highlighter = new SharedTermHighlighter()

    const first = await highlighter.toggle(service, ['paper-a', 'paper-b'])
    expect(first).toEqual({
      kind: 'highlighted',
      readingSetName: 'Set set-a',
      groupCount: 1,
      paperCount: 2,
    })
    expect(entitySpans(rootA)[0].classList.contains('scholar-shared-term')).toBe(true)
    expect(entitySpans(rootB)[0].classList.contains('scholar-shared-term')).toBe(true)

    const second = await highlighter.toggle(service, ['paper-a', 'paper-b'])
    expect(second).toEqual({ kind: 'cleared' })
    expect(document.querySelectorAll('.scholar-shared-term')).toHaveLength(0)
  })

  it('skips groups whose counterpart lives only in a closed paper', async () => {
    paperRoot('paper-a', ['s-1'])
    const service = fakeService(
      [readingSet('set-a', ['paper-a', 'paper-b', 'paper-c'])],
      [
        pair('a-b', ['paper-a', 's-1'], ['paper-b', 's-2']),
        pair('a-c', ['paper-a', 's-9'], ['paper-c', 's-8']),
      ],
    )
    const highlighter = new SharedTermHighlighter()

    const outcome = await highlighter.toggle(service, ['paper-a', 'paper-b'])

    expect(outcome).toEqual({
      kind: 'highlighted',
      readingSetName: 'Set set-a',
      groupCount: 1,
      paperCount: 2,
    })
  })
})
