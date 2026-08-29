import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  SemanticLensOtherPapers,
  type OtherPaperTermLink,
} from '@/components/reader/SemanticLensOtherPapers'
import type { EntityAlignment, ReadingSet, ReadingSetPaperSummary } from '@/lib/reading-set-api'
import type { SemanticSubjectDetails } from '@/lib/semantic-api'
import type { ScholarSemanticLensWidget as ScholarSemanticLensWidgetClass } from '@/theia/scholar-extension/src/browser/scholar-semantic-lens-widget'
import type { ScholarGraphSelection as ScholarGraphSelectionType } from '@/theia/scholar-extension/src/browser/scholar-graph-selection'

let ScholarSemanticLensWidget: typeof ScholarSemanticLensWidgetClass
let ScholarGraphSelection: typeof import(
  '@/theia/scholar-extension/src/browser/scholar-graph-selection'
).ScholarGraphSelection
let SCHOLAR_GRAPH_SELECTION_KIND: string

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarSemanticLensWidget } = await import(
    '@/theia/scholar-extension/src/browser/scholar-semantic-lens-widget'
  ))
  ;({ ScholarGraphSelection, SCHOLAR_GRAPH_SELECTION_KIND } = await import(
    '@/theia/scholar-extension/src/browser/scholar-graph-selection'
  ))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

function link(overrides: Partial<OtherPaperTermLink> = {}): OtherPaperTermLink {
  return {
    alignmentId: 'align-1',
    readingSetId: 'set-a',
    paperId: 'paper-b',
    subjectId: 'artifact:dpo',
    paperTitle: 'Direct Preference Optimization',
    label: 'reward-free tuning',
    confidence: 'high',
    status: 'auto',
    rationale: 'Both papers optimize the same preference objective.',
    ...overrides,
  }
}

describe('SemanticLensOtherPapers', () => {
  it('renders nothing at all for a paper outside every reading set', () => {
    const { container } = render(
      <SemanticLensOtherPapers
        links={[]}
        onOpen={() => {}}
        onConfirm={() => {}}
        onReject={() => {}}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the other paper, its own name for the term, and the confidence', () => {
    render(
      <SemanticLensOtherPapers
        links={[link()]}
        onOpen={() => {}}
        onConfirm={() => {}}
        onReject={() => {}}
      />,
    )

    const section = screen.getByTestId('semantic-other-papers')
    expect(section).toHaveTextContent('In other papers')
    expect(section).toHaveTextContent('Direct Preference Optimization')
    expect(section).toHaveTextContent('reward-free tuning')
    expect(screen.getByTestId('alignment-confidence')).toHaveTextContent('high')
    expect(screen.getByTestId('alignment-confidence')).toHaveClass('semantic-confidence-high')
  })

  it('lets the reader open, confirm, or reject an automatic link', async () => {
    const onOpen = vi.fn()
    const onConfirm = vi.fn()
    const onReject = vi.fn()
    render(
      <SemanticLensOtherPapers
        links={[link()]}
        onOpen={onOpen}
        onConfirm={onConfirm}
        onReject={onReject}
      />,
    )

    await userEvent.click(screen.getByTestId('other-paper-open'))
    await userEvent.click(screen.getByTestId('alignment-confirm'))
    await userEvent.click(screen.getByTestId('alignment-reject'))

    expect(onOpen).toHaveBeenCalledWith(link())
    expect(onConfirm).toHaveBeenCalledWith(link())
    expect(onReject).toHaveBeenCalledWith(link())
  })

  it('marks a confirmed link instead of offering to confirm it again', () => {
    render(
      <SemanticLensOtherPapers
        links={[link({ status: 'confirmed' })]}
        onOpen={() => {}}
        onConfirm={() => {}}
        onReject={() => {}}
      />,
    )

    expect(screen.getByTestId('alignment-confirmed')).toBeInTheDocument()
    expect(screen.queryByTestId('alignment-confirm')).not.toBeInTheDocument()
  })

  it('disables the judgement of the row whose request is in flight', () => {
    render(
      <SemanticLensOtherPapers
        links={[link()]}
        busyAlignmentId="align-1"
        onOpen={() => {}}
        onConfirm={() => {}}
        onReject={() => {}}
      />,
    )

    expect(screen.getByTestId('alignment-confirm')).toBeDisabled()
    expect(screen.getByTestId('alignment-reject')).toBeDisabled()
  })
})

function paperSummary(id: string, title: string): ReadingSetPaperSummary {
  return {
    id,
    filename: `${id}.tar.gz`,
    arxiv_id: null,
    title,
    has_html: true,
    has_knowledge_graph: true,
    added_at: '2026-08-29T00:00:00Z',
  }
}

function readingSet(overrides: Partial<ReadingSet> = {}): ReadingSet {
  return {
    id: 'set-a',
    name: 'Preference Optimization',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    papers: [
      paperSummary('paper-a', 'KTO'),
      paperSummary('paper-b', 'Direct Preference Optimization'),
    ],
    ...overrides,
  }
}

function alignment(id: string, overrides: Partial<EntityAlignment> = {}): EntityAlignment {
  return {
    id,
    reading_set_id: 'set-a',
    paper_a_id: 'paper-a',
    subject_a_id: 'artifact:kto',
    label_a: 'KTO',
    paper_b_id: 'paper-b',
    subject_b_id: 'artifact:dpo',
    label_b: 'reward-free tuning',
    method: 'llm',
    score: 0.9,
    confidence: 'high',
    status: 'auto',
    rationale: null,
    created_at: '2026-08-29T00:00:00Z',
    ...overrides,
  }
}

function subjectDetails(): SemanticSubjectDetails {
  return {
    schema_version: '3.0',
    subject: {
      stable_id: 'artifact:kto',
      kind: 'artifact',
      label: 'KTO',
      aliases: [],
      roles: [],
      facets: [],
      units: null,
      constraints: [],
      object_ids: [],
    },
    explanation: {
      stable_id: 'explanation:kto',
      subject_id: 'artifact:kto',
      base_content: 'A preference optimization method that needs no pairs.',
      expertise: 'intermediate',
      evidence_ids: [],
    },
    occurrences: [],
    evidence: [],
    occurrence_total: 0,
    defining_equation: null,
  }
}

function createLens(alignments: EntityAlignment[]) {
  const selectionService = {
    selection: undefined as unknown,
    onSelectionChanged: () => ({ dispose: () => undefined }),
  }
  const store = {
    loadEquationDetails: vi.fn(),
    loadSemanticSubject: vi.fn().mockResolvedValue(subjectDetails()),
    saveSemanticNote: vi.fn(),
    clearSemanticNote: vi.fn(),
    setActiveEntity: vi.fn(),
    setSemanticSelection: vi.fn(),
    getSnapshot: () => ({ tooltipsByPaperId: {} }),
    subscribe: () => () => undefined,
  }
  const readingSets = {
    getSnapshot: vi.fn(() => ({
      readingSets: [readingSet()],
      loading: false,
      error: null,
      alignmentBuilds: {},
    })),
    subscribe: vi.fn(() => () => undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    alignmentsOf: vi.fn(() => alignments),
    loadAlignments: vi.fn().mockResolvedValue(alignments),
    confirmAlignment: vi.fn().mockResolvedValue(alignment('align-1', { status: 'confirmed' })),
    rejectAlignment: vi.fn().mockResolvedValue(alignment('align-1', { status: 'rejected' })),
  }
  const paperWidget = { id: 'scholar-agent:paper:paper-b', isAttached: false }
  const widgetManager = {
    getOrCreateWidget: vi.fn().mockResolvedValue(paperWidget),
  }
  const shell = {
    addWidget: vi.fn().mockResolvedValue(undefined),
    activateWidget: vi.fn().mockResolvedValue(undefined),
  }
  const WidgetCtor = ScholarSemanticLensWidget as unknown as new (
    ...args: unknown[]
  ) => ScholarSemanticLensWidgetClass
  const widget = new WidgetCtor(store, selectionService, readingSets, widgetManager, shell)
  return { widget, store, readingSets, widgetManager, shell, selectionService }
}

function occurrenceSelection(): ScholarGraphSelectionType {
  return ScholarGraphSelection.create(
    'paper-a',
    {
      kind: SCHOLAR_GRAPH_SELECTION_KIND as ScholarGraphSelectionType['source']['kind'],
      paperId: 'paper-a',
      owner: {},
    },
    {
      kind: 'occurrence',
      occurrenceId: 'occ-1',
      subjectId: 'artifact:kto',
      label: 'KTO',
      scopeId: 'sec-1',
    },
  )
}

async function showLens(widget: ScholarSemanticLensWidgetClass): Promise<void> {
  await act(async () => {
    ;(widget as unknown as { applySelection(selection: unknown): void })
      .applySelection(occurrenceSelection())
    await Promise.resolve()
    await Promise.resolve()
  })
  const content = (widget as unknown as { render(): React.ReactNode }).render()
  render(React.createElement(React.Fragment, null, content))
}

describe('semantic lens "In other papers"', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists the visible alignments of the active term and hides rejected and stale ones', async () => {
    const { widget } = createLens([
      alignment('align-1'),
      alignment('align-2', {
        status: 'rejected',
        subject_b_id: 'artifact:rejected',
        label_b: 'a rejected reading',
      }),
      alignment('align-3', {
        status: 'stale',
        subject_b_id: 'artifact:stale',
        label_b: 'an outdated reading',
      }),
      alignment('align-4', {
        subject_a_id: 'artifact:unrelated',
        label_b: 'another term entirely',
      }),
    ])

    await showLens(widget)

    const section = screen.getByTestId('semantic-other-papers')
    expect(section).toHaveTextContent('Direct Preference Optimization')
    expect(section).toHaveTextContent('reward-free tuning')
    expect(section).not.toHaveTextContent('a rejected reading')
    expect(section).not.toHaveTextContent('an outdated reading')
    expect(section).not.toHaveTextContent('another term entirely')
  })

  it('rejects a link through the reading-set service', async () => {
    const { widget, readingSets } = createLens([alignment('align-1')])

    await showLens(widget)
    await userEvent.click(screen.getByTestId('alignment-reject'))

    expect(readingSets.rejectAlignment).toHaveBeenCalledWith('set-a', 'align-1')
  })

  it('confirms a link through the reading-set service', async () => {
    const { widget, readingSets } = createLens([alignment('align-1')])

    await showLens(widget)
    await userEvent.click(screen.getByTestId('alignment-confirm'))

    expect(readingSets.confirmAlignment).toHaveBeenCalledWith('set-a', 'align-1')
  })

  it('opens the other paper on its term when a row is clicked', async () => {
    const { widget, store, widgetManager, shell } = createLens([alignment('align-1')])
    const paperRoot = document.createElement('div')
    paperRoot.dataset.scholarPaperId = 'paper-b'
    const occurrence = document.createElement('span')
    occurrence.className = 'kg-entity'
    occurrence.dataset.subjectId = 'artifact:dpo'
    occurrence.scrollIntoView = vi.fn()
    paperRoot.appendChild(occurrence)
    document.body.appendChild(paperRoot)

    await showLens(widget)
    await userEvent.click(screen.getByTestId('other-paper-open'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(widgetManager.getOrCreateWidget).toHaveBeenCalledWith(
      'scholar-agent:paper',
      { paperId: 'paper-b', label: 'Direct Preference Optimization' },
    )
    expect(shell.addWidget).toHaveBeenCalled()
    expect(shell.activateWidget).toHaveBeenCalledWith('scholar-agent:paper:paper-b')
    expect(store.setActiveEntity).toHaveBeenCalledWith('paper-b', 'artifact:dpo')
    expect(occurrence.scrollIntoView).toHaveBeenCalled()
    expect(occurrence.classList.contains('kg-entity-flash')).toBe(true)
  })
})
