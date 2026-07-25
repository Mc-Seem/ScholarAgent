import { Container, ContainerModule } from '@theia/core/shared/inversify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { PropertyDataService } from '@theia/property-view/lib/browser/property-data-service'
import { PropertyViewWidgetProvider } from '@theia/property-view/lib/browser/property-view-widget-provider'

import {
  ScholarGraphSelection,
  type ScholarGraphSelectionSource,
} from '@/theia/scholar-extension/src/browser/scholar-graph-selection'
import type {
  ScholarGraphPropertyDataService as ScholarGraphPropertyDataServiceClass,
  ScholarGraphPropertyViewWidget as ScholarGraphPropertyViewWidgetClass,
  ScholarGraphPropertyViewWidgetProvider as ScholarGraphPropertyViewWidgetProviderClass,
  bindScholarGraphPropertyView as BindScholarGraphPropertyView,
  buildScholarGraphPropertyRows as BuildScholarGraphPropertyRows,
} from '@/theia/scholar-extension/src/browser/scholar-graph-property-view'

let ScholarGraphPropertyDataService: typeof ScholarGraphPropertyDataServiceClass
let ScholarGraphPropertyViewWidget: typeof ScholarGraphPropertyViewWidgetClass
let ScholarGraphPropertyViewWidgetProvider: typeof ScholarGraphPropertyViewWidgetProviderClass
let bindScholarGraphPropertyView: typeof BindScholarGraphPropertyView
let buildScholarGraphPropertyRows: typeof BuildScholarGraphPropertyRows

beforeAll(async () => {
  ;(globalThis as { DragEvent?: typeof Event }).DragEvent = class DragEvent extends Event {}
  document.queryCommandSupported = () => false
  ;({
    ScholarGraphPropertyDataService,
    ScholarGraphPropertyViewWidget,
    ScholarGraphPropertyViewWidgetProvider,
    bindScholarGraphPropertyView,
    buildScholarGraphPropertyRows,
  } = await import('@/theia/scholar-extension/src/browser/scholar-graph-property-view'))
})

afterAll(() => {
  delete (globalThis as { DragEvent?: typeof Event }).DragEvent
  delete (document as Partial<Document>).queryCommandSupported
})

function nodeSelection(overrides: Partial<{
  definition: string
  statement: string
  summary: string
  context: string
  aliases: string[]
  rank: number
  evidence: Array<{
    observation_id: string
    kind: string
    label: string
    source: {
      paper_id: string
      section_id: string | null
      section_title: string | null
      dom_node_id: string | null
      equation_id: string | null
      quote: string
      char_start: number | null
      char_end: number | null
    }
  }>
  incomingConnections: { nodeId: string; nodeLabel: string; nodeType: string; relationshipType: string }[]
  outgoingConnections: { nodeId: string; nodeLabel: string; nodeType: string; relationshipType: string }[]
}> = {}) {
  const source: ScholarGraphSelectionSource = {
    kind: 'scholar-agent:graph-selection',
    paperId: 'paper-a',
    owner: {},
  }
  return ScholarGraphSelection.create('paper-a', source, {
    kind: 'node',
    id: 'node-1',
    label: 'Theorem 1',
    nodeType: 'theorem',
    incomingConnections: [],
    outgoingConnections: [],
    ...overrides,
  })
}

function edgeSelection(overrides: Partial<{ evidence: string }> = {}) {
  const source: ScholarGraphSelectionSource = {
    kind: 'scholar-agent:graph-selection',
    paperId: 'paper-a',
    owner: {},
  }
  return ScholarGraphSelection.create('paper-a', source, {
    kind: 'edge',
    sourceId: 'a',
    targetId: 'b',
    sourceLabel: 'Theorem 1',
    targetLabel: 'Lemma 2',
    relationshipType: 'depends_on',
    ...overrides,
  })
}

describe('ScholarGraphPropertyDataService', () => {
  it('handles only ScholarGraphSelection objects with a higher priority than the fallback', () => {
    const service = new ScholarGraphPropertyDataService()
    expect(service.canHandleSelection(nodeSelection())).toBe(100)
    expect(service.canHandleSelection(edgeSelection())).toBe(100)
  })

  it('does not handle undefined, arbitrary objects or tree-shaped selections', () => {
    const service = new ScholarGraphPropertyDataService()
    expect(service.canHandleSelection(undefined)).toBe(0)
    expect(service.canHandleSelection({ foo: 'bar' })).toBe(0)
    expect(service.canHandleSelection({ id: 'tree-node', parent: undefined, children: [] })).toBe(0)
  })

  it('resolves graph rows as property data when it can handle the selection', async () => {
    const service = new ScholarGraphPropertyDataService()
    const selection = nodeSelection()
    await expect(service.providePropertyData(selection)).resolves.toEqual(
      buildScholarGraphPropertyRows(selection),
    )
  })

  it('resolves no rows for a selection it cannot handle', async () => {
    const service = new ScholarGraphPropertyDataService()
    await expect(service.providePropertyData({ foo: 'bar' })).resolves.toEqual([])
    await expect(service.providePropertyData(undefined)).resolves.toEqual([])
  })
})

describe('buildScholarGraphPropertyRows (node)', () => {
  it('includes Paper, Label and Type at minimum', () => {
    const rows = buildScholarGraphPropertyRows(nodeSelection())
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Paper', value: 'paper-a' }),
      expect.objectContaining({ label: 'Label', value: 'Theorem 1' }),
      expect.objectContaining({ label: 'Type', value: 'theorem' }),
    ]))
  })

  it('shows empty Definition/Connections values safely when optional fields are missing', () => {
    const rows = buildScholarGraphPropertyRows(nodeSelection())
    expect(rows.find(row => row.label === 'Definition / Description')?.value).toBe('—')
    expect(rows.find(row => row.label === 'Connections')?.value).toBe('—')
  })

  it('includes a description row sourced from definition/statement/summary/context, in priority order', () => {
    const withDefinition = buildScholarGraphPropertyRows(nodeSelection({ definition: 'Def text' }))
    expect(withDefinition.find(row => row.label === 'Definition / Description')?.value).toBe('Def text')

    const withStatementOnly = buildScholarGraphPropertyRows(nodeSelection({ statement: 'Statement text' }))
    expect(withStatementOnly.find(row => row.label === 'Definition / Description')?.value).toBe('Statement text')
  })

  it('includes a Connections row describing each connection when present', () => {
    const rows = buildScholarGraphPropertyRows(nodeSelection({
      outgoingConnections: [
        {
          nodeId: 'n2',
          nodeLabel: 'Lemma 2',
          nodeType: 'theorem',
          relationshipType: 'depends_on',
        },
      ],
    }))
    const connectionsRow = rows.find(row => row.label === 'Connections')
    expect(connectionsRow?.value).toContain('Lemma 2')
    expect(connectionsRow?.value).toContain('depends_on')
  })

  it('includes canonical aliases, rank, and inspectable evidence', () => {
    const rows = buildScholarGraphPropertyRows(nodeSelection({
      aliases: ['ELBO'],
      rank: 0.875,
      evidence: [{
        observation_id: 'obs-1',
        kind: 'concept',
        label: 'Evidence lower bound',
        source: {
          paper_id: 'paper-a',
          section_id: 'sec-1',
          section_title: 'Method',
          dom_node_id: 'p-1',
          equation_id: null,
          quote: 'We define the evidence lower bound.',
          char_start: 0,
          char_end: 35,
        },
      }],
    }))

    expect(rows.find(row => row.label === 'Aliases')?.value).toBe('ELBO')
    expect(rows.find(row => row.label === 'View Rank')?.value).toBe('0.875')
    expect(rows.find(row => row.label === 'Evidence')?.value).toContain('Method: We define')
  })
})

describe('buildScholarGraphPropertyRows (edge)', () => {
  it('includes Paper and the relation with Source → Target', () => {
    const rows = buildScholarGraphPropertyRows(edgeSelection())
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Paper', value: 'paper-a' }),
      expect.objectContaining({
        label: 'Relation',
        value: 'Theorem 1 → Lemma 2 (depends_on)',
      }),
    ]))
  })

  it('shows empty Evidence safely when missing and the value when present', () => {
    const withoutEvidence = buildScholarGraphPropertyRows(edgeSelection())
    expect(withoutEvidence.find(row => row.label === 'Evidence')?.value).toBe('—')

    const withEvidence = buildScholarGraphPropertyRows(edgeSelection({ evidence: 'See Section 3.' }))
    expect(withEvidence.find(row => row.label === 'Evidence')?.value).toBe('See Section 3.')
  })
})

describe('ScholarGraphPropertyViewWidgetProvider', () => {
  it('can handle only ScholarGraphSelection objects with graph priority', () => {
    const container = new Container()
    container.load(new ContainerModule(bindScholarGraphPropertyView))
    const provider = container.get(ScholarGraphPropertyViewWidgetProvider)

    expect(provider.canHandle(nodeSelection())).toBe(100)
    expect(provider.canHandle(edgeSelection())).toBe(100)
    expect(provider.canHandle(undefined)).toBe(0)
    expect(provider.canHandle({ foo: 'bar' })).toBe(0)
  })

  it('always resolves the same singleton content widget instance', async () => {
    const container = new Container()
    container.load(new ContainerModule(bindScholarGraphPropertyView))
    const provider = container.get(ScholarGraphPropertyViewWidgetProvider)

    const widgetA = await provider.provideWidget(nodeSelection())
    const widgetB = await provider.provideWidget(edgeSelection())
    expect(widgetA).toBe(widgetB)
  })

  it('updates an already open content widget through the standard Property View contract', () => {
    const container = new Container()
    container.load(new ContainerModule(bindScholarGraphPropertyView))
    const provider = container.get(ScholarGraphPropertyViewWidgetProvider)
    const contentWidget = container.get(ScholarGraphPropertyViewWidget)
    const update = vi.spyOn(contentWidget, 'updatePropertyViewContent')
    const selection = edgeSelection({ evidence: 'See Section 3.' })

    provider.updateContentWidget(selection)

    expect(update).toHaveBeenCalledWith(
      expect.any(ScholarGraphPropertyDataService),
      selection,
    )
  })
})

describe('bindScholarGraphPropertyView (root contribution wiring)', () => {
  it('binds exactly one PropertyDataService and one PropertyViewWidgetProvider contribution', () => {
    const container = new Container()
    container.load(new ContainerModule(bindScholarGraphPropertyView))

    const dataServices = container.getAll(PropertyDataService)
    const widgetProviders = container.getAll(PropertyViewWidgetProvider)

    expect(dataServices).toHaveLength(1)
    expect(dataServices[0]).toBeInstanceOf(ScholarGraphPropertyDataService)
    expect(widgetProviders).toHaveLength(1)
    expect(widgetProviders[0]).toBeInstanceOf(ScholarGraphPropertyViewWidgetProvider)
  })

  it('binds the content widget as a singleton', () => {
    const container = new Container()
    container.load(new ContainerModule(bindScholarGraphPropertyView))

    const widgetA = container.get(ScholarGraphPropertyViewWidget)
    const widgetB = container.get(ScholarGraphPropertyViewWidget)
    expect(widgetA).toBe(widgetB)
  })
})
