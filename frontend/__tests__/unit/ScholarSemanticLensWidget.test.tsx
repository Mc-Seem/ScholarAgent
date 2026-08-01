import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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

const owner = {}

function equationSelection(equationId = 'eq-7'): ScholarGraphSelectionType {
  return ScholarGraphSelection.create(
    'paper-a',
    {
      kind: SCHOLAR_GRAPH_SELECTION_KIND as ScholarGraphSelectionType['source']['kind'],
      paperId: 'paper-a',
      owner,
    },
    { kind: 'equation', equationId },
  )
}

function equationDetails(summary: string) {
  return {
    schema_version: '3.0',
    equation: {
      stable_id: 'equation:eq-7',
      equation_id: 'eq-7',
      latex: '\\tau = h / (2 |u|)',
      summary,
      notation_ids: ['notation:tau'],
      object_ids: [],
      evidence_ids: [],
    },
    notation: [{
      stable_id: 'notation:tau',
      symbol: 'τ',
      meaning: 'SUPG stabilization parameter',
      scope_id: 'sec-1',
      units: null,
      constraints: [],
      object_ids: [],
      evidence_ids: [],
    }],
    objects: [],
    evidence: [],
  }
}

interface LensStore {
  loadEquationDetails: unknown
  loadSemanticSubject: unknown
  tooltips?: unknown[]
}

function createLens(store: LensStore) {
  let listener: ((selection: unknown) => void) | undefined
  const selectionService = {
    selection: undefined as unknown,
    onSelectionChanged: (next: (selection: unknown) => void) => {
      listener = next
      return { dispose: () => undefined }
    },
  }
  const commands = { executeCommand: vi.fn().mockResolvedValue(undefined) }
  const fullStore = {
    ...store,
    getSnapshot: () => ({ tooltipsByPaperId: { 'paper-a': store.tooltips ?? [] } }),
    subscribe: () => () => undefined,
  }
  const WidgetCtor = ScholarSemanticLensWidget as unknown as new (
    store: unknown,
    selectionService: unknown,
    commands: unknown,
  ) => ScholarSemanticLensWidgetClass
  const widget = new WidgetCtor(fullStore, selectionService, commands)
  return {
    widget,
    commands,
    publish: (selection: unknown) => {
      selectionService.selection = selection
      listener?.(selection)
    },
  }
}

function renderLens(widget: ScholarSemanticLensWidgetClass): void {
  const content = (widget as unknown as { render(): React.ReactNode }).render()
  render(React.createElement(React.Fragment, null, content))
}

// The widget owns a detached React root that repaints on every update request.
async function flushWidgetRepaint(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('ScholarSemanticLensWidget', () => {
  it('invites the reader to pick something instead of showing an empty panel', async () => {
    const { widget } = createLens({
      loadEquationDetails: vi.fn(),
      loadSemanticSubject: vi.fn(),
    })
    await flushWidgetRepaint()

    renderLens(widget)

    expect(screen.getByText(/Select an equation or a highlighted term/i)).toBeInTheDocument()
  })

  it('renders the shared Equation Lens for an equation selection', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(
        equationDetails('Defines the SUPG stabilization parameter.'),
      ),
      loadSemanticSubject: vi.fn(),
    }
    const { widget, publish } = createLens(store)

    await act(async () => {
      publish(equationSelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    renderLens(widget)

    expect(store.loadEquationDetails).toHaveBeenCalledWith('paper-a', 'eq-7')
    expect(screen.getByTestId('equation-lens')).toBeInTheDocument()
    expect(screen.getByText('Defines the SUPG stabilization parameter.')).toBeInTheDocument()
  })

  it('keeps the current lens when an unrelated selection arrives and clears it on an empty one', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(equationDetails('Stays visible.')),
      loadSemanticSubject: vi.fn(),
    }
    const { widget, publish } = createLens(store)

    await act(async () => {
      publish(equationSelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    publish({ id: 'library-tree-node' })
    await flushWidgetRepaint()
    expect(widget.currentSelection?.payload).toEqual({ kind: 'equation', equationId: 'eq-7' })

    publish(undefined)
    await flushWidgetRepaint()
    expect(widget.currentSelection).toBeUndefined()
    renderLens(widget)
    expect(screen.getByText(/Select an equation or a highlighted term/i)).toBeInTheDocument()
  })

  it('ignores a stale response when the reader moves on to another equation', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    const store = {
      loadEquationDetails: vi.fn()
        .mockImplementationOnce(() => new Promise(resolve => {
          resolveFirst = resolve
        }))
        .mockResolvedValue(equationDetails('Second equation.')),
      loadSemanticSubject: vi.fn(),
    }
    const { widget, publish } = createLens(store)

    publish(equationSelection('eq-7'))
    await act(async () => {
      publish(equationSelection('eq-9'))
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      resolveFirst?.(equationDetails('First equation.'))
      await Promise.resolve()
    })
    renderLens(widget)

    expect(screen.getByText('Second equation.')).toBeInTheDocument()
    expect(screen.queryByText('First equation.')).not.toBeInTheDocument()
  })

  it('is bound through a widget factory and stays transient so a closed tab can reopen', () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'theia/scholar-extension/src/browser/scholar-frontend-module.ts',
      ),
      'utf-8',
    )

    expect(source).toMatch(/bind\(ScholarSemanticLensWidget\)\.toSelf\(\)\s*$/m)
    expect(source).toMatch(/id: SCHOLAR_SEMANTIC_LENS_WIDGET_ID/)
  })

  it('shows the reader note next to the equation and edits it through the annotation editor', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(equationDetails('Stabilization parameter.')),
      loadSemanticSubject: vi.fn(),
      tooltips: [{
        id: 'tooltip-1',
        paper_id: 'paper-a',
        dom_node_id: 'eq-7',
        entity_id: null,
        content: 'Remember: h is the local element size.',
        is_pinned: false,
      }],
    }
    const { widget, commands, publish } = createLens(store)

    await act(async () => {
      publish(equationSelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    renderLens(widget)

    expect(screen.getByTestId('semantic-note')).toHaveTextContent(
      'Remember: h is the local element size.',
    )
    await userEvent.click(screen.getByTestId('semantic-note-edit'))
    expect(commands.executeCommand).toHaveBeenCalledWith('scholar-agent.edit-annotation', {
      paperId: 'paper-a',
      domNodeId: 'eq-7',
      tooltipIds: ['tooltip-1'],
    })
  })

  it('leaves the note card out when nothing is saved for the subject', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(equationDetails('No note yet.')),
      loadSemanticSubject: vi.fn(),
      tooltips: [{
        id: 'tooltip-2',
        paper_id: 'paper-a',
        dom_node_id: 'p-3',
        entity_id: null,
        content: 'A comment on an unrelated paragraph.',
        is_pinned: false,
      }],
    }
    const { widget, publish } = createLens(store)

    await act(async () => {
      publish(equationSelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    renderLens(widget)

    expect(screen.queryByTestId('semantic-note')).not.toBeInTheDocument()
  })

  it('surfaces a failed lookup instead of an endless spinner', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockRejectedValue(new Error('Semantic API is offline')),
      loadSemanticSubject: vi.fn(),
    }
    const { widget, publish } = createLens(store)

    await act(async () => {
      publish(equationSelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    renderLens(widget)

    expect(screen.getByText(/Semantic API is offline/)).toBeInTheDocument()
  })
})
