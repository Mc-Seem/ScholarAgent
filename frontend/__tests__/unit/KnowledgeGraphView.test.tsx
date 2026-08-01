import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import dagre from 'dagre'

const reactFlowSpies = vi.hoisted(() => ({
  fitView: vi.fn(),
  setCenter: vi.fn(),
}))

vi.mock('reactflow', () => {
  const reactFlowInstance = reactFlowSpies

  function ReactFlowMock(props: {
    nodes: Array<{ id: string; data: { label: string } }>
    edges: Array<{ id: string; source: string; target: string; label?: string; data?: { evidence?: string } }>
    onNodeClick?: (event: unknown, node: unknown) => void
    onEdgeClick?: (event: unknown, edge: unknown) => void
    onPaneClick?: () => void
    children?: React.ReactNode
  }): React.ReactElement {
    return (
      <div data-testid="react-flow-mock">
        {props.nodes.map(node => (
          <button
            key={node.id}
            type="button"
            data-testid={`node-${node.id}`}
            onClick={event => props.onNodeClick?.(event, node)}
          >
            {node.data.label}
          </button>
        ))}
        {props.edges.map(edge => (
          <button
            key={edge.id}
            type="button"
            data-testid={`edge-${edge.id}`}
            onClick={event => props.onEdgeClick?.(event, edge)}
          >
            {edge.id}
          </button>
        ))}
        <button
          type="button"
          data-testid="pane"
          onClick={() => props.onPaneClick?.()}
        >
          pane
        </button>
        {props.children}
      </div>
    )
  }

  function useNodesState(initial: unknown[]) {
    const [nodes, setNodes] = React.useState(initial)
    const onNodesChange = React.useCallback(() => undefined, [])
    return [nodes, setNodes, onNodesChange] as const
  }

  function useEdgesState(initial: unknown[]) {
    const [edges, setEdges] = React.useState(initial)
    const onEdgesChange = React.useCallback(() => undefined, [])
    return [edges, setEdges, onEdgesChange] as const
  }

  function useReactFlow() {
    return reactFlowInstance
  }

  function ReactFlowProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    return <>{children}</>
  }

  return {
    default: ReactFlowMock,
    Background: () => null,
    Controls: () => <div data-testid="flow-controls" />,
    MiniMap: () => <div data-testid="flow-minimap" />,
    useNodesState,
    useEdgesState,
    useReactFlow,
    ReactFlowProvider,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    ConnectionLineType: { SmoothStep: 'smoothstep' },
  }
})

vi.mock('@/components/reader/KnowledgeGraphProgress', () => ({
  KnowledgeGraphProgress: ({ onComplete }: { onComplete: () => void }) => (
    <button type="button" data-testid="build-complete" onClick={onComplete}>
      complete build
    </button>
  ),
}))

import { KnowledgeGraphView } from '@/components/reader/KnowledgeGraphView'
import type { KnowledgeGraphController } from '@/components/reader/knowledge-graph-controller'

function graphFixture() {
  const signals = {
    contribution: 0.9,
    prominence: 0.8,
    recurrence: 0.5,
    confidence: 0.9,
    familiarity: 0.2,
  }
  const evidence = (id: string, label: string, domNodeId: string) => [{
    observation_id: `obs-${id}`,
    kind: 'topic',
    label,
    source: {
      paper_id: 'paper-a',
      section_id: 'sec-1',
      section_title: 'Section 1',
      dom_node_id: domNodeId,
      equation_id: null,
      quote: label === 'Theorem 1' ? 'A well-known theorem.' : 'A basic definition.',
      char_start: 0,
      char_end: 10,
    },
  }]
  return {
    status: 'ready',
    schema_version: '3.0',
    nodes: [
      {
        stable_id: 'n1',
        type: 'claim',
        label: 'Theorem 1',
        aliases: [],
        facets: [{ kind: 'theorem', payload: { text: 'A well-known theorem.' }, evidence_ids: ['obs-n1'] }],
        signals,
        rank: 0.9,
        evidence: evidence('n1', 'Theorem 1', 'dom-n1'),
        omitted_relation_count: 1,
      },
      {
        stable_id: 'n2',
        type: 'topic',
        label: 'Definition 2',
        aliases: [],
        facets: [{ kind: 'definition', payload: { text: 'A basic definition.' }, evidence_ids: ['obs-n2'] }],
        signals,
        rank: 0.8,
        evidence: evidence('n2', 'Definition 2', 'dom-n2'),
        omitted_relation_count: 0,
      },
    ],
    relations: [
      {
        stable_id: 'e1',
        source_id: 'n1',
        target_id: 'n2',
        type: 'depends_on',
        qualifiers: ['prerequisite'],
        confidence: 0.9,
        evidence: [{
          observation_id: 'obs-e1',
          kind: 'relation',
          label: 'Theorem 1 depends on Definition 2',
          source: {
            paper_id: 'paper-a',
            section_id: 'sec-1',
            section_title: 'Section 1',
            dom_node_id: 'dom-e1',
            equation_id: null,
            quote: 'See proof in Section 2.',
            char_start: 0,
            char_end: 23,
          },
        }],
      },
    ],
    total_entity_count: 2,
    total_relation_count: 1,
    omitted_relation_count: 0,
    truncated: false,
  }
}

async function renderGraph(props: Partial<React.ComponentProps<typeof KnowledgeGraphView>> = {}) {
  const utils = render(
    <KnowledgeGraphView paperId="paper-a" {...props} />,
  )
  await waitFor(() => expect(screen.getByTestId('node-n1')).toBeInTheDocument())
  return utils
}

describe('KnowledgeGraphView selection callback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(graphFixture()),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('calls onSelectionChange with a node payload including connections when a node is clicked', async () => {
    const onSelectionChange = vi.fn()
    await renderGraph({ onSelectionChange })

    onSelectionChange.mockClear()
    fireEvent.click(screen.getByTestId('node-n1'))

    await waitFor(() => expect(onSelectionChange).toHaveBeenCalled())
    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0]
    expect(lastCall).toEqual(expect.objectContaining({
      kind: 'node',
      id: 'n1',
      label: 'Theorem 1',
      nodeType: 'claim',
      statement: 'A well-known theorem.',
      omittedRelationCount: 1,
    }))
    expect(lastCall.outgoingConnections).toEqual([
      expect.objectContaining({ nodeId: 'n2', relationshipType: 'depends_on' }),
    ])
    expect(lastCall.incomingConnections).toEqual([])
  })

  it('calls onSelectionChange with an edge payload including source/target labels, type and evidence', async () => {
    const onSelectionChange = vi.fn()
    await renderGraph({ onSelectionChange })

    onSelectionChange.mockClear()
    fireEvent.click(screen.getByTestId('edge-e1'))

    await waitFor(() => expect(onSelectionChange).toHaveBeenCalled())
    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0]
    expect(lastCall).toEqual(expect.objectContaining({
      kind: 'edge',
      sourceId: 'n1',
      targetId: 'n2',
      sourceLabel: 'Theorem 1',
      targetLabel: 'Definition 2',
      relationshipType: 'depends_on',
      qualifiers: ['prerequisite'],
      evidence: 'See proof in Section 2.',
    }))
    expect(lastCall.evidenceItems).toHaveLength(1)
  })

  it('calls onSelectionChange with null when the pane is clicked after a selection', async () => {
    const onSelectionChange = vi.fn()
    await renderGraph({ onSelectionChange })

    fireEvent.click(screen.getByTestId('node-n1'))
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'node', id: 'n1' }),
    ))

    onSelectionChange.mockClear()
    fireEvent.click(screen.getByTestId('pane'))

    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(null))
  })

  it('calls onSelectionChange with null when the node detail panel is closed', async () => {
    const onSelectionChange = vi.fn()
    await renderGraph({ onSelectionChange })

    fireEvent.click(screen.getByTestId('node-n1'))
    await waitFor(() => expect(screen.getByLabelText('Close')).toBeInTheDocument())

    onSelectionChange.mockClear()
    fireEvent.click(screen.getByLabelText('Close'))

    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(null))
  })

  it('calls onSelectionChange with null when the edge detail panel is closed', async () => {
    const onSelectionChange = vi.fn()
    await renderGraph({ onSelectionChange })

    fireEvent.click(screen.getByTestId('edge-e1'))
    await waitFor(() => expect(screen.getByLabelText('Close')).toBeInTheDocument())

    onSelectionChange.mockClear()
    fireEvent.click(screen.getByLabelText('Close'))

    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(null))
  })

  it('clears a stale selection when a rebuilt graph completes', async () => {
    const onSelectionChange = vi.fn()
    await renderGraph({ onSelectionChange })

    fireEvent.click(screen.getByTestId('node-n1'))
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'node', id: 'n1' }),
    ))
    act(() => window.dispatchEvent(new Event('kg-build-start')))
    await waitFor(() => expect(screen.getByTestId('build-complete')).toBeInTheDocument())

    onSelectionChange.mockClear()
    fireEvent.click(screen.getByTestId('build-complete'))

    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(null))
  })
})

describe('KnowledgeGraphView progressive loading', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads the bounded overview endpoint instead of the full export', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(graphFixture()),
    })
    vi.stubGlobal('fetch', fetchMock)

    await renderGraph()

    expect(String(fetchMock.mock.calls[0][0])).toContain('/knowledge-graph/overview?')
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/\/knowledge-graph$/)
  })

  it('merges an expanded one-hop neighborhood by stable ID', async () => {
    const expanded = graphFixture()
    expanded.nodes.push({
      ...expanded.nodes[0],
      stable_id: 'n3',
      label: 'Expanded concept',
      evidence: [{
        ...expanded.nodes[0].evidence[0],
        observation_id: 'obs-n3',
        label: 'Expanded concept',
      }],
    })
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(url.includes('/subgraph?') ? expanded : graphFixture()),
    }))
    vi.stubGlobal('fetch', fetchMock)
    let controller: KnowledgeGraphController | null = null
    await renderGraph({ onControllerChange: value => { controller = value } })

    await act(async () => controller!.expandNode('n1'))

    await waitFor(() => expect(screen.getByTestId('node-n3')).toBeInTheDocument())
    expect(screen.getAllByTestId('node-n1')).toHaveLength(1)
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/knowledge-graph/subgraph?')
  })

  it('keeps remote search results outside the layout until explicitly revealed', async () => {
    const graph = graphFixture()
    const { rank, ...remoteNode } = {
      ...graph.nodes[0], stable_id: 'remote', label: 'Remote result', rank: 0.7,
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(url.includes('/search?')
        ? { status: 'ready', schema_version: '3.0', results: [{ ...remoteNode, score: 1 }] }
        : graph),
    }))
    vi.stubGlobal('fetch', fetchMock)
    let controller: KnowledgeGraphController | null = null
    await renderGraph({ onControllerChange: value => { controller = value } })

    let results: readonly { id: string }[] = []
    await act(async () => {
      results = await controller!.search('Remote')
    })

    expect(results).toEqual([expect.objectContaining({ id: 'remote' })])
    expect(screen.queryByTestId('node-remote')).not.toBeInTheDocument()
  })

  it('presents legacy graphs as requiring a rebuild', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ status: 'rebuild_required', reason: 'Legacy graph' }),
    }))

    render(<KnowledgeGraphView paperId="paper-a" />)

    await waitFor(() => expect(screen.getByText(/requires a rebuild/i)).toBeInTheDocument())
  })

  it('enforces the 50-node visible cap when a large neighborhood is returned', async () => {
    const graph = graphFixture()
    const expanded = {
      ...graph,
      nodes: Array.from({ length: 60 }, (_, index) => ({
        ...graph.nodes[0],
        stable_id: `large-${index}`,
        label: `Large ${index}`,
        evidence: [{
          ...graph.nodes[0].evidence[0],
          observation_id: `large-obs-${index}`,
          label: `Large ${index}`,
        }],
      })),
      relations: [],
      total_entity_count: 60,
      total_relation_count: 0,
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(url.includes('/subgraph?') ? expanded : graph),
    })))
    let controller: KnowledgeGraphController | null = null
    await renderGraph({ onControllerChange: value => { controller = value } })

    await act(async () => controller!.expandNode('n1'))

    await waitFor(() => expect(controller!.getSnapshot().visibleNodeCount).toBe(50))
    expect(screen.getAllByTestId(/^node-/)).toHaveLength(50)
  })

  it('does not rerun Dagre when server search changes without topology changes', async () => {
    const graph = graphFixture()
    const { rank, ...searchNode } = graph.nodes[0]
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(url.includes('/search?')
        ? { status: 'ready', schema_version: '3.0', results: [{ ...searchNode, score: 1 }] }
        : graph),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const layoutSpy = vi.spyOn(dagre, 'layout')
    let controller: KnowledgeGraphController | null = null
    await renderGraph({ onControllerChange: value => { controller = value } })
    const layoutCalls = layoutSpy.mock.calls.length

    await act(async () => { await controller!.search('Theorem') })

    expect(layoutSpy).toHaveBeenCalledTimes(layoutCalls)
    layoutSpy.mockRestore()
  })
})

describe('KnowledgeGraphView selection overlay visibility', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(graphFixture()),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the built-in node detail overlay by default (unchanged Next.js behavior)', async () => {
    await renderGraph()

    fireEvent.click(screen.getByTestId('node-n1'))

    await waitFor(() => expect(screen.getByText('A well-known theorem.')).toBeInTheDocument())
  })

  it('hides the built-in detail overlay when showSelectionDetails is false', async () => {
    await renderGraph({ showSelectionDetails: false })

    fireEvent.click(screen.getByTestId('node-n1'))

    await act(async () => undefined)
    expect(screen.queryByText('A well-known theorem.')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
  })
})

describe('KnowledgeGraphView controller bridge', () => {
  beforeEach(() => {
    reactFlowSpies.fitView.mockClear()
    reactFlowSpies.setCenter.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(graphFixture()),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('registers one stable controller and unregisters it on unmount', async () => {
    const controllers: Array<KnowledgeGraphController | null> = []
    const onControllerChange = vi.fn((controller: KnowledgeGraphController | null) => {
      controllers.push(controller)
    })
    const { rerender, unmount } = await renderGraph({ onControllerChange })

    const controller = controllers.find((value): value is KnowledgeGraphController => value !== null)
    expect(controller).toBeDefined()
    expect(controller?.getSnapshot().status).toBe('ready')

    rerender(<KnowledgeGraphView paperId="paper-a" onControllerChange={onControllerChange} />)
    await act(async () => undefined)

    expect(controllers.filter(value => value !== null)).toEqual([controller])

    unmount()
    expect(controllers.at(-1)).toBeNull()
  })

  it('publishes view-neutral search, filter, count, selection, and capability state', async () => {
    let controller: KnowledgeGraphController | null = null
    await renderGraph({
      onControllerChange: value => {
        controller = value
      },
    })

    const snapshot = controller!.getSnapshot()
    expect(snapshot).toEqual(expect.objectContaining({
      status: 'ready',
      visibleNodeCount: 2,
      totalNodeCount: 2,
      visibleEdgeCount: 1,
      totalEdgeCount: 1,
      omittedEdgeCount: 0,
      selectedNode: null,
      focusMode: false,
      focusedNodeId: null,
      canFocusSelection: false,
      canRevealSelectionInPaper: false,
    }))
    expect(snapshot.searchItems).toContainEqual(expect.objectContaining({
      id: 'n1',
      label: 'Theorem 1',
      nodeType: 'claim',
      detail: 'A well-known theorem.',
    }))
    expect(snapshot.nodeTypeFilters).toContainEqual({
      type: 'claim',
      label: 'Claims',
      count: 1,
      selected: true,
    })
    expect(snapshot.edgeTypeFilters).toContainEqual({
      type: 'depends_on',
      label: 'Depends on',
      count: 1,
      selected: true,
    })
  })

  it('reveals filtered nodes and delegates focus, layout, and source actions', async () => {
    let controller: KnowledgeGraphController | null = null
    const onSelectionChange = vi.fn()
    const onNavigate = vi.fn()
    await renderGraph({
      onControllerChange: value => {
        controller = value
      },
      onSelectionChange,
      onNavigate,
    })

    act(() => controller!.setVisibleTypes([], []))
    await waitFor(() => expect(controller!.getSnapshot().visibleNodeCount).toBe(0))

    act(() => controller!.revealNode('n1'))
    await waitFor(() => expect(screen.getByTestId('node-n1')).toBeInTheDocument())

    expect(controller!.getSnapshot()).toEqual(expect.objectContaining({
      visibleNodeCount: 1,
      visibleEdgeCount: 0,
      selectedNode: expect.objectContaining({
        id: 'n1',
        label: 'Theorem 1',
        nodeType: 'claim',
        domNodeId: 'dom-n1',
      }),
      canFocusSelection: true,
      canRevealSelectionInPaper: true,
    }))
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
    await waitFor(() => expect(reactFlowSpies.setCenter).toHaveBeenCalled())

    act(() => controller!.focusSelection())
    await waitFor(() => expect(controller!.getSnapshot()).toEqual(expect.objectContaining({
      focusMode: true,
      focusedNodeId: 'n1',
    })))

    act(() => controller!.revealSelectionInPaper())
    expect(onNavigate).toHaveBeenCalledWith('dom-n1')

    act(() => controller!.resetLayout())
    await waitFor(() => expect(reactFlowSpies.fitView).toHaveBeenCalled())

    act(() => controller!.clearFocus())
    await waitFor(() => expect(controller!.getSnapshot().focusMode).toBe(false))
  })

  it('notifies subscribers only when the public snapshot changes', async () => {
    let controller: KnowledgeGraphController | null = null
    await renderGraph({
      onControllerChange: value => {
        controller = value
      },
    })
    const listener = vi.fn()
    const unsubscribe = controller!.subscribe(listener)

    fireEvent.change(screen.getByPlaceholderText('Search entities...'), {
      target: { value: 'theorem' },
    })
    await act(async () => undefined)
    expect(listener).not.toHaveBeenCalled()

    act(() => controller!.setVisibleTypes(
      ['claim', 'topic'],
      ['depends_on'],
    ))
    await act(async () => undefined)
    expect(listener).not.toHaveBeenCalled()

    act(() => controller!.setVisibleTypes(['claim'], ['depends_on']))
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))

    unsubscribe()
    act(() => controller!.setVisibleTypes([], []))
    await act(async () => undefined)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps embedded controls by default and hides only shell-replaced controls when requested', async () => {
    const { unmount } = await renderGraph()

    expect(screen.getByPlaceholderText('Search entities...')).toBeInTheDocument()
    expect(screen.getByTitle('Filter visible nodes and relationships')).toBeInTheDocument()
    expect(screen.getByTestId('react-flow-mock').parentElement).toHaveStyle({
      height: 'calc(100% - 36px)',
    })
    expect(screen.getByTestId('flow-controls')).toBeInTheDocument()
    expect(screen.getByTestId('flow-minimap')).toBeInTheDocument()

    unmount()
    let controller: KnowledgeGraphController | null = null
    await renderGraph({
      showEmbeddedControls: false,
      onControllerChange: value => {
        controller = value
      },
    })

    expect(screen.queryByPlaceholderText('Search entities...')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Filter visible nodes and relationships')).not.toBeInTheDocument()
    expect(screen.getByTestId('react-flow-mock').parentElement).toHaveStyle({ height: '100%' })
    expect(screen.getByTestId('flow-controls')).toBeInTheDocument()
    expect(screen.getByTestId('flow-minimap')).toBeInTheDocument()

    act(() => controller!.revealNode('n1'))
    act(() => controller!.focusSelection())
    await waitFor(() => expect(controller!.getSnapshot().focusMode).toBe(true))
    expect(screen.queryByText('Focusing on:')).not.toBeInTheDocument()
  })

  it('reports loading and error lifecycle states without enabling selection actions', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(resolve => {
      resolveFetch = resolve
    })))
    let controller: KnowledgeGraphController | null = null
    render(
      <KnowledgeGraphView
        paperId="paper-a"
        onControllerChange={value => {
          controller = value
        }}
      />,
    )
    await waitFor(() => expect(controller).not.toBeNull())
    expect(controller!.getSnapshot()).toEqual(expect.objectContaining({
      status: 'loading',
      canFocusSelection: false,
      canRevealSelectionInPaper: false,
    }))

    await act(async () => {
      resolveFetch?.({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      })
    })
    await waitFor(() => expect(controller!.getSnapshot().status).toBe('error'))
    expect(controller!.getSnapshot()).toEqual(expect.objectContaining({
      canFocusSelection: false,
      canRevealSelectionInPaper: false,
    }))
  })
})
