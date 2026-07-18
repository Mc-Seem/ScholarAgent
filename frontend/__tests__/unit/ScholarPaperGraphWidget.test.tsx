import { act, render, cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { SelectionService } from '@theia/core'
import { MessageLoop } from '@theia/core/shared/@lumino/messaging'
import type {
  ScholarPaperGraphWidget as ScholarPaperGraphWidgetClass,
  ScholarPaperGraphWidgetOptions,
  isScholarPaperGraphWidgetOptions as IsScholarPaperGraphWidgetOptions,
} from '@/theia/scholar-extension/src/browser/scholar-paper-graph-widget'
import type { KnowledgeGraphSelection } from '@/components/reader/KnowledgeGraphView'
import type {
  KnowledgeGraphController,
  KnowledgeGraphControllerSnapshot,
} from '@/components/reader/knowledge-graph-controller'
import { ScholarGraphSelection } from '@/theia/scholar-extension/src/browser/scholar-graph-selection'

interface KnowledgeGraphViewProps {
  paperId: string
  onNavigate?: (domNodeId: string) => void
  onSelectionChange?: (selection: KnowledgeGraphSelection | null) => void
  onControllerChange?: (controller: KnowledgeGraphController | null) => void
  showEmbeddedControls?: boolean
  showSelectionDetails?: boolean
}

const navigateToPaperElementMock = vi.hoisted(() => vi.fn())

const knowledgeGraphViewMock = vi.fn((props: KnowledgeGraphViewProps) => {
  React.useEffect(() => () => props.onControllerChange?.(null), [props.onControllerChange])
  return <div data-testid="kg-view" data-paper-id={props.paperId} />
})

vi.mock('@/components/reader/KnowledgeGraphView', () => ({
  KnowledgeGraphView: (props: KnowledgeGraphViewProps) => knowledgeGraphViewMock(props),
}))

vi.mock('@/theia/scholar-extension/src/browser/scholar-react', () => ({
  navigateToPaperElement: navigateToPaperElementMock,
}))

let ScholarPaperGraphWidget: typeof ScholarPaperGraphWidgetClass
let isScholarPaperGraphWidgetOptions: typeof IsScholarPaperGraphWidgetOptions
let SCHOLAR_PAPER_GRAPH_FACTORY_ID: string

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarPaperGraphWidget, isScholarPaperGraphWidgetOptions, SCHOLAR_PAPER_GRAPH_FACTORY_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-paper-graph-widget'
  ))
})

function createWidget(
  selectionService: SelectionService,
  options: ScholarPaperGraphWidgetOptions,
): ScholarPaperGraphWidgetClass {
  let widget: ScholarPaperGraphWidgetClass | undefined
  act(() => {
    widget = new ScholarPaperGraphWidget(selectionService, options)
    MessageLoop.flush()
  })
  return widget!
}

function lastKnowledgeGraphProps(): KnowledgeGraphViewProps {
  const props = knowledgeGraphViewMock.mock.calls.at(-1)?.[0]
  if (!props) {
    throw new Error('KnowledgeGraphView was not rendered')
  }
  return props
}

function readySnapshot(label = 'Node'): KnowledgeGraphControllerSnapshot {
  return {
    status: 'ready',
    searchItems: [{ id: 'node-1', label, nodeType: 'theorem' }],
    nodeTypeFilters: [{ type: 'theorem', label: 'Theorems', count: 1, selected: true }],
    edgeTypeFilters: [],
    visibleNodeCount: 1,
    totalNodeCount: 1,
    visibleEdgeCount: 0,
    totalEdgeCount: 0,
    selectedNode: null,
    focusMode: false,
    focusedNodeId: null,
    canFocusSelection: false,
    canRevealSelectionInPaper: false,
  }
}

function createControllerHarness(snapshot = readySnapshot()) {
  let listener: (() => void) | undefined
  const unsubscribe = vi.fn()
  const controller: KnowledgeGraphController = {
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn(nextListener => {
      listener = nextListener
      return unsubscribe
    }),
    revealNode: vi.fn(),
    setVisibleTypes: vi.fn(),
    focusSelection: vi.fn(),
    clearFocus: vi.fn(),
    resetLayout: vi.fn(),
    revealSelectionInPaper: vi.fn(),
  }
  return {
    controller,
    emit: () => listener?.(),
    unsubscribe,
  }
}

afterEach(() => {
  act(() => cleanup())
  knowledgeGraphViewMock.mockClear()
  navigateToPaperElementMock.mockClear()
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

function renderWidget(widget: ScholarPaperGraphWidgetClass) {
  const node = (widget as unknown as { render(): React.ReactNode }).render()
  return render(<>{node}</>)
}

describe('SCHOLAR_PAPER_GRAPH_FACTORY_ID', () => {
  it('is a distinct, stable factory id used to restore layout', () => {
    expect(SCHOLAR_PAPER_GRAPH_FACTORY_ID).toBe('scholar-agent:paper-graph')
  })
})

describe('isScholarPaperGraphWidgetOptions', () => {
  it('accepts a stable paperId as the only persisted layout option', () => {
    const options: ScholarPaperGraphWidgetOptions = { paperId: 'paper-a' }
    expect(isScholarPaperGraphWidgetOptions(options)).toBe(true)
  })

  it('rejects undefined, non-objects, and options missing a usable paperId', () => {
    expect(isScholarPaperGraphWidgetOptions(undefined)).toBe(false)
    expect(isScholarPaperGraphWidgetOptions(null)).toBe(false)
    expect(isScholarPaperGraphWidgetOptions('paper-a')).toBe(false)
    expect(isScholarPaperGraphWidgetOptions({})).toBe(false)
    expect(isScholarPaperGraphWidgetOptions({ paperId: '   ' })).toBe(false)
    expect(isScholarPaperGraphWidgetOptions({ paperId: 'paper-a' })).toBe(true)
    expect(isScholarPaperGraphWidgetOptions({ label: 'Alpha' })).toBe(false)
  })
})

describe('ScholarPaperGraphWidget', () => {
  it('derives a stable, unique widget id from the paperId, distinct from the paper widget id', () => {
    const widget = createWidget(new SelectionService(), { paperId: 'paper a/b' })
    expect(widget.id).toBe(`scholar-agent:paper-graph:${encodeURIComponent('paper a/b')}`)
  })

  it('gives two widgets for different papers different, stable ids', () => {
    const widgetA = createWidget(new SelectionService(), { paperId: 'paper-a' })
    const widgetB = createWidget(new SelectionService(), { paperId: 'paper-b' })
    expect(widgetA.id).not.toBe(widgetB.id)
  })

  it('sets a title/caption that names the paper', () => {
    const widget = createWidget(new SelectionService(), { paperId: 'paper-a' })
    widget.updateLabel('Alpha Paper')
    expect(widget.title.label).toContain('Alpha Paper')
    expect(widget.title.caption).toContain('Alpha Paper')
    expect(widget.title.closable).toBe(true)
  })

  it('renders the knowledge graph for its own fixed options.paperId, isolated from other instances', () => {
    const widgetA = createWidget(new SelectionService(), { paperId: 'paper-a' })
    knowledgeGraphViewMock.mockClear()
    renderWidget(widgetA)
    expect(knowledgeGraphViewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ paperId: 'paper-a' }),
    )

    const widgetB = createWidget(new SelectionService(), { paperId: 'paper-b' })
    knowledgeGraphViewMock.mockClear()
    renderWidget(widgetB)
    expect(knowledgeGraphViewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ paperId: 'paper-b' }),
    )
  })

  it('disables the built-in Next.js selection overlays in favor of the native Property View', () => {
    const widget = createWidget(new SelectionService(), { paperId: 'paper-a' })
    knowledgeGraphViewMock.mockClear()
    renderWidget(widget)
    expect(lastKnowledgeGraphProps().showSelectionDetails).toBe(false)
    expect(lastKnowledgeGraphProps().showEmbeddedControls).toBe(false)
  })

  it('navigates to a source element through the widget paper identity', () => {
    const widget = createWidget(new SelectionService(), { paperId: 'paper-a' })
    renderWidget(widget)

    lastKnowledgeGraphProps().onNavigate?.('dom-node-1')

    expect(navigateToPaperElementMock).toHaveBeenCalledWith('paper-a', 'dom-node-1')
  })
})

describe('ScholarPaperGraphWidget controller bridge', () => {
  it('publishes controller state changes and proxies every graph action', () => {
    const widget = createWidget(new SelectionService(), { paperId: 'paper-a' })
    const harness = createControllerHarness()
    const onDidChange = vi.fn()
    widget.onDidChangeGraphState(onDidChange)
    renderWidget(widget)

    lastKnowledgeGraphProps().onControllerChange?.(harness.controller)

    expect(widget.getGraphController()).toBe(harness.controller)
    expect(widget.getGraphSnapshot()).toBe(harness.controller.getSnapshot())
    expect(onDidChange).toHaveBeenCalledTimes(1)

    harness.emit()
    expect(onDidChange).toHaveBeenCalledTimes(2)

    widget.revealNode('node-1')
    widget.setVisibleTypes(['theorem'], ['depends_on'])
    widget.focusSelection()
    widget.clearFocus()
    widget.resetLayout()
    widget.revealSelectionInPaper()

    expect(harness.controller.revealNode).toHaveBeenCalledWith('node-1')
    expect(harness.controller.setVisibleTypes).toHaveBeenCalledWith(['theorem'], ['depends_on'])
    expect(harness.controller.focusSelection).toHaveBeenCalledOnce()
    expect(harness.controller.clearFocus).toHaveBeenCalledOnce()
    expect(harness.controller.resetLayout).toHaveBeenCalledOnce()
    expect(harness.controller.revealSelectionInPaper).toHaveBeenCalledOnce()
  })

  it('unsubscribes replaced controllers and clears the current bridge on React unmount', () => {
    const widget = createWidget(new SelectionService(), { paperId: 'paper-a' })
    const first = createControllerHarness(readySnapshot('First'))
    const second = createControllerHarness(readySnapshot('Second'))
    const onDidChange = vi.fn()
    widget.onDidChangeGraphState(onDidChange)
    const view = renderWidget(widget)
    const props = lastKnowledgeGraphProps()

    props.onControllerChange?.(first.controller)
    props.onControllerChange?.(second.controller)

    expect(first.unsubscribe).toHaveBeenCalledOnce()
    expect(widget.getGraphController()).toBe(second.controller)
    const eventCountAfterReplacement = onDidChange.mock.calls.length
    first.emit()
    expect(onDidChange).toHaveBeenCalledTimes(eventCountAfterReplacement)

    view.unmount()

    expect(second.unsubscribe).toHaveBeenCalledOnce()
    expect(widget.getGraphController()).toBeUndefined()
    expect(widget.getGraphSnapshot()).toBeUndefined()
  })

  it('keeps controllers isolated across stale and fresh widgets for the same paper', () => {
    const selectionService = new SelectionService()
    const staleWidget = createWidget(selectionService, { paperId: 'paper-a' })
    const staleController = createControllerHarness(readySnapshot('Stale'))
    renderWidget(staleWidget)
    lastKnowledgeGraphProps().onControllerChange?.(staleController.controller)

    const freshWidget = createWidget(selectionService, { paperId: 'paper-a' })
    const freshController = createControllerHarness(readySnapshot('Fresh'))
    renderWidget(freshWidget)
    lastKnowledgeGraphProps().onControllerChange?.(freshController.controller)

    staleWidget.revealNode('stale-node')
    expect(staleController.controller.revealNode).toHaveBeenCalledWith('stale-node')
    expect(freshController.controller.revealNode).not.toHaveBeenCalled()

    act(() => staleWidget.dispose())

    expect(staleController.unsubscribe).toHaveBeenCalledOnce()
    expect(freshController.unsubscribe).not.toHaveBeenCalled()
    expect(freshWidget.getGraphController()).toBe(freshController.controller)
  })

  it('clears subscriptions and ignores stale controller notifications after dispose', () => {
    const widget = createWidget(new SelectionService(), { paperId: 'paper-a' })
    const harness = createControllerHarness()
    const onDidChange = vi.fn()
    widget.onDidChangeGraphState(onDidChange)
    renderWidget(widget)
    lastKnowledgeGraphProps().onControllerChange?.(harness.controller)

    act(() => widget.dispose())
    const eventCountAfterDispose = onDidChange.mock.calls.length
    harness.emit()

    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(widget.getGraphController()).toBeUndefined()
    expect(onDidChange).toHaveBeenCalledTimes(eventCountAfterDispose)
  })
})

describe('ScholarPaperGraphWidget selection publishing', () => {
  it('publishes a node selection carrying the fixed options.paperId when the graph view selects a node', () => {
    const selectionService = new SelectionService()
    const widget = createWidget(selectionService, { paperId: 'paper-a' })
    renderWidget(widget)

    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'node',
      id: 'node-1',
      label: 'Theorem 1',
      nodeType: 'theorem',
      definition: 'A well-known result.',
      incomingConnections: [],
      outgoingConnections: [],
    })

    const selection = selectionService.selection
    expect(ScholarGraphSelection.is(selection)).toBe(true)
    if (ScholarGraphSelection.is(selection)) {
      expect(selection.paperId).toBe('paper-a')
      expect(selection.payload.kind).toBe('node')
      expect(selection.payload).toMatchObject({ id: 'node-1', label: 'Theorem 1' })
    }
  })

  it('publishes an edge selection with source/target labels, relation type and evidence', () => {
    const selectionService = new SelectionService()
    const widget = createWidget(selectionService, { paperId: 'paper-a' })
    renderWidget(widget)

    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'edge',
      sourceId: 'node-1',
      targetId: 'node-2',
      sourceLabel: 'Theorem 1',
      targetLabel: 'Lemma 2',
      relationshipType: 'depends_on',
      evidence: 'See Section 3.',
    })

    const selection = selectionService.selection
    expect(ScholarGraphSelection.is(selection)).toBe(true)
    if (ScholarGraphSelection.is(selection) && selection.payload.kind === 'edge') {
      expect(selection.payload.sourceLabel).toBe('Theorem 1')
      expect(selection.payload.targetLabel).toBe('Lemma 2')
      expect(selection.payload.evidence).toBe('See Section 3.')
    }
  })

  it('keeps every published selection isolated to its own paperId across two widget instances', () => {
    const selectionService = new SelectionService()
    const widgetA = createWidget(selectionService, { paperId: 'paper-a' })
    const widgetB = createWidget(selectionService, { paperId: 'paper-b' })

    renderWidget(widgetA)
    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'node', id: 'n', label: 'N', nodeType: 'symbol', incomingConnections: [], outgoingConnections: [],
    })
    const selectionFromA = selectionService.selection
    expect(ScholarGraphSelection.is(selectionFromA) && selectionFromA.paperId).toBe('paper-a')

    renderWidget(widgetB)
    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'node', id: 'n', label: 'N', nodeType: 'symbol', incomingConnections: [], outgoingConnections: [],
    })
    const selectionFromB = selectionService.selection
    expect(ScholarGraphSelection.is(selectionFromB) && selectionFromB.paperId).toBe('paper-b')
  })

  it('clears its own selection when the graph view reports no selection (pane click / detail close)', () => {
    const selectionService = new SelectionService()
    const widget = createWidget(selectionService, { paperId: 'paper-a' })
    renderWidget(widget)

    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'node', id: 'n', label: 'N', nodeType: 'symbol', incomingConnections: [], outgoingConnections: [],
    })
    expect(selectionService.selection).toBeDefined()

    lastKnowledgeGraphProps().onSelectionChange?.(null)
    expect(selectionService.selection).toBeUndefined()
  })
})

describe('ScholarPaperGraphWidget selection cleanup (hide/close/dispose)', () => {
  it('clears its own selection on hide, but never a foreign selection from another widget', () => {
    const selectionService = new SelectionService()
    const widget = createWidget(selectionService, { paperId: 'paper-a' })
    renderWidget(widget)
    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'node', id: 'n', label: 'N', nodeType: 'symbol', incomingConnections: [], outgoingConnections: [],
    })
    expect(selectionService.selection).toBeDefined()

    ;(widget as unknown as { onAfterHide(message: unknown): void }).onAfterHide({} as never)
    expect(selectionService.selection).toBeUndefined()
  })

  it('does not clear a foreign selection (e.g. from a TreeWidget or another graph widget) on hide/close/dispose', () => {
    const selectionService = new SelectionService()
    const widget = createWidget(selectionService, { paperId: 'paper-a' })
    renderWidget(widget)

    const foreignSelection = { some: 'tree-selection' }
    selectionService.selection = foreignSelection

    ;(widget as unknown as { onAfterHide(message: unknown): void }).onAfterHide({} as never)
    expect(selectionService.selection).toBe(foreignSelection)

    act(() => widget.dispose())
    expect(selectionService.selection).toBe(foreignSelection)
  })

  it('clears its own selection on dispose', () => {
    const selectionService = new SelectionService()
    const widget = createWidget(selectionService, { paperId: 'paper-a' })
    renderWidget(widget)
    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'node', id: 'n', label: 'N', nodeType: 'symbol', incomingConnections: [], outgoingConnections: [],
    })
    expect(selectionService.selection).toBeDefined()

    act(() => widget.dispose())
    expect(selectionService.selection).toBeUndefined()
  })

  it('does not let disposing a stale, already-replaced widget instance for the same paperId clear the new instance selection', () => {
    const selectionService = new SelectionService()
    const staleWidget = createWidget(selectionService, { paperId: 'paper-a' })
    renderWidget(staleWidget)
    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'node', id: 'stale', label: 'Stale', nodeType: 'symbol', incomingConnections: [], outgoingConnections: [],
    })

    const freshWidget = createWidget(selectionService, { paperId: 'paper-a' })
    renderWidget(freshWidget)
    lastKnowledgeGraphProps().onSelectionChange?.({
      kind: 'node', id: 'fresh', label: 'Fresh', nodeType: 'symbol', incomingConnections: [], outgoingConnections: [],
    })

    act(() => staleWidget.dispose())

    const selection = selectionService.selection
    expect(ScholarGraphSelection.is(selection) && selection.payload.kind === 'node' && selection.payload.id).toBe('fresh')
  })
})
