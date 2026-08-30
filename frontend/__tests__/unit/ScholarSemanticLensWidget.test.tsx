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

function entitySelection(): ScholarGraphSelectionType {
  return ScholarGraphSelection.create(
    'paper-a',
    {
      kind: SCHOLAR_GRAPH_SELECTION_KIND as ScholarGraphSelectionType['source']['kind'],
      paperId: 'paper-a',
      owner,
    },
    {
      kind: 'occurrence',
      occurrenceId: 'occ-1',
      subjectId: 'artifact:kto',
      label: 'KTO',
      domNodeId: 'p-1',
      scopeId: 'sec-1',
    },
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

function subjectDetails() {
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
    explanation: null,
    occurrences: [],
    evidence: [],
    occurrence_total: 1,
    defining_equation: null,
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
  const saveSemanticNote = vi.fn().mockResolvedValue({ id: 'tooltip-new' })
  const clearSemanticNote = vi.fn().mockResolvedValue(undefined)
  const setNextContextForPaper = vi.fn()
  const sendMessage = vi.fn().mockResolvedValue(undefined)
  const executeCommand = vi.fn().mockResolvedValue(undefined)
  const fullStore = {
    ...store,
    saveSemanticNote,
    clearSemanticNote,
    setActiveEntity: vi.fn(),
    setSemanticSelection: vi.fn(),
    getSnapshot: () => ({ tooltipsByPaperId: { 'paper-a': store.tooltips ?? [] } }),
    subscribe: () => () => undefined,
  }
  const readingSets = {
    getSnapshot: vi.fn(() => ({ readingSets: [], loading: false, error: null, alignmentBuilds: {} })),
    subscribe: vi.fn(() => () => undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    alignmentsOf: vi.fn(() => undefined),
    loadAlignments: vi.fn().mockResolvedValue([]),
    confirmAlignment: vi.fn(),
    rejectAlignment: vi.fn(),
  }
  const widgetManager = {
    getOrCreateWidget: vi.fn(),
  }
  const shell = {
    addWidget: vi.fn().mockResolvedValue(undefined),
    activateWidget: vi.fn().mockResolvedValue(undefined),
  }
  const WidgetCtor = ScholarSemanticLensWidget as unknown as new (
    ...args: unknown[]
  ) => ScholarSemanticLensWidgetClass
  const widget = new WidgetCtor(
    fullStore,
    selectionService,
    { setNextContextForPaper, sendMessage },
    { executeCommand },
    readingSets,
    widgetManager,
    shell,
  )
  return {
    widget,
    saveSemanticNote,
    clearSemanticNote,
    setNextContextForPaper,
    sendMessage,
    executeCommand,
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
    expect(screen.queryByRole('button', { name: /ask about this entity/i })).not.toBeInTheDocument()
  })

  it('attaches the selected entity and opens Chat from the lens', async () => {
    const store = {
      loadEquationDetails: vi.fn(),
      loadSemanticSubject: vi.fn().mockResolvedValue(subjectDetails()),
    }
    const { widget, publish, setNextContextForPaper, executeCommand } = createLens(store)

    await act(async () => {
      publish(entitySelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    renderLens(widget)

    const askButton = screen.getByRole('button', { name: /ask about this entity/i })
    expect(askButton).toHaveTextContent('')
    expect(askButton.parentElement).toHaveClass('semantic-lens-title-row')
    expect(askButton.parentElement).toContainElement(screen.getByRole('heading', { name: 'KTO' }))

    await userEvent.click(askButton)

    expect(setNextContextForPaper).toHaveBeenCalledWith('paper-a', {
      kind: 'entity',
      subject_id: 'artifact:kto',
      data_id: 'p-1',
      section_id: 'sec-1',
      label: 'KTO',
    })
    expect(executeCommand).toHaveBeenCalledWith('scholar-agent.show-chat')
  })

  it.each([
    ['Deeper', 'Explain the displayed definition of KTO in more depth.'],
    ['Simpler', 'Explain the displayed definition of KTO more simply.'],
    ['Example', 'Give me a concrete example of KTO.'],
    ['Connections', 'Explain how KTO connects to other concepts in this paper.'],
  ])('opens Chat and immediately submits the %s explanation request', async (label, message) => {
    const details = subjectDetails()
    details.explanation = {
      stable_id: 'explanation:kto',
      subject_id: 'artifact:kto',
      base_content: 'A preference optimization method that needs no pairs.',
      expertise: 'intermediate',
      evidence_ids: [],
    }
    const store = {
      loadEquationDetails: vi.fn(),
      loadSemanticSubject: vi.fn().mockResolvedValue(details),
    }
    const { widget, publish, sendMessage, executeCommand } = createLens(store)

    await act(async () => {
      publish(entitySelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    renderLens(widget)
    await userEvent.click(screen.getByRole('button', { name: label }))

    expect(executeCommand).toHaveBeenCalledWith('scholar-agent.show-chat')
    expect(sendMessage).toHaveBeenCalledWith(message, {
      kind: 'entity',
      subject_id: 'artifact:kto',
      data_id: 'p-1',
      section_id: 'sec-1',
      label: 'KTO',
    })
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

  it('shows the reader wording in place of the agent text and keeps the original reachable', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(equationDetails('Stabilization parameter.')),
      loadSemanticSubject: vi.fn(),
      tooltips: [{
        id: 'tooltip-1',
        paper_id: 'paper-a',
        dom_node_id: null,
        entity_id: 'equation:eq-7',
        content: 'Element-size limiter.',
        is_user_override: true,
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

    const header = document.querySelector('.semantic-lens-header')
    expect(header).toHaveTextContent('Element-size limiter.')
    expect(header).not.toHaveTextContent('Stabilization parameter.')
    expect(screen.getAllByTestId('semantic-editable-badge').length).toBeGreaterThan(0)

    await userEvent.click(screen.getAllByTestId('semantic-editable-original')[0])
    expect(screen.getByTestId('semantic-editable-agent-text')).toHaveTextContent(
      'Stabilization parameter.',
    )
  })

  it('stores an edited symbol meaning against its notation subject', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(equationDetails('Stabilization parameter.')),
      loadSemanticSubject: vi.fn(),
    }
    const { widget, saveSemanticNote, publish } = createLens(store)

    await act(async () => {
      publish(equationSelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    renderLens(widget)

    const row = document.querySelector('[data-subject-id="notation:tau"]') as HTMLElement
    await userEvent.click(row.querySelector('[data-testid="semantic-editable-edit"]')!)
    const input = screen.getByTestId('semantic-editable-input')
    await userEvent.clear(input)
    await userEvent.type(input, 'Element size over twice the speed.')
    await userEvent.click(screen.getByTestId('semantic-editable-save'))

    expect(saveSemanticNote).toHaveBeenCalledWith(
      'paper-a',
      'notation:tau',
      'Element size over twice the speed.',
      'τ',
    )
  })

  it('restores the agent wording without deleting the paper anchors', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(equationDetails('Stabilization parameter.')),
      loadSemanticSubject: vi.fn(),
      tooltips: [{
        id: 'tooltip-1',
        paper_id: 'paper-a',
        dom_node_id: null,
        entity_id: 'equation:eq-7',
        content: 'Element-size limiter.',
        is_user_override: true,
        is_pinned: false,
      }],
    }
    const { widget, clearSemanticNote, publish } = createLens(store)

    await act(async () => {
      publish(equationSelection())
      await Promise.resolve()
      await Promise.resolve()
    })
    renderLens(widget)

    await userEvent.click(screen.getAllByTestId('semantic-editable-restore')[0])

    expect(clearSemanticNote).toHaveBeenCalledWith('paper-a', 'equation:eq-7')
  })

  it('does not treat a paragraph comment as the wording of the equation', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(equationDetails('Agent wording.')),
      loadSemanticSubject: vi.fn(),
      tooltips: [{
        id: 'tooltip-2',
        paper_id: 'paper-a',
        dom_node_id: 'eq-7',
        entity_id: null,
        content: 'A comment anchored to the equation block.',
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

    expect(document.querySelector('.semantic-lens-header')).toHaveTextContent('Agent wording.')
    expect(screen.queryByTestId('semantic-editable-badge')).not.toBeInTheDocument()
  })

  it('does not treat an applied AI tooltip as a reader edit after a graph rebuild', async () => {
    const store = {
      loadEquationDetails: vi.fn().mockResolvedValue(equationDetails('New graph wording.')),
      loadSemanticSubject: vi.fn(),
      tooltips: [{
        id: 'tooltip-applied',
        paper_id: 'paper-a',
        dom_node_id: null,
        entity_id: 'equation:eq-7',
        content: 'Wording from the previous graph build.',
        is_user_override: false,
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

    expect(document.querySelector('.semantic-lens-header')).toHaveTextContent('New graph wording.')
    expect(screen.queryByTestId('semantic-editable-badge')).not.toBeInTheDocument()
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
