import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

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
  return {
    nodes: [
      {
        id: 'n1',
        type: 'theorem',
        label: 'Theorem 1',
        definition: 'A well-known theorem.',
        dom_node_id: 'dom-n1',
        section_id: 'sec-1',
      },
      {
        id: 'n2',
        type: 'definition',
        label: 'Definition 2',
        definition: 'A basic definition.',
        dom_node_id: 'dom-n2',
        section_id: 'sec-1',
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        type: 'depends_on',
        evidence: 'See proof in Section 2.',
      },
    ],
    metadata: {
      node_count: 2,
      edge_count: 1,
      symbol_count: 0,
      definition_count: 1,
      theorem_count: 1,
    },
  }
}

async function renderGraph(props: Partial<React.ComponentProps<typeof KnowledgeGraphView>> = {}) {
  const utils = render(
    <KnowledgeGraphView paperId="paper-a" {...props} />,
  )
  await waitFor(() => expect(screen.getByTestId('react-flow-mock')).toBeInTheDocument())
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
      nodeType: 'theorem',
      definition: 'A well-known theorem.',
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
    expect(lastCall).toEqual({
      kind: 'edge',
      sourceId: 'n1',
      targetId: 'n2',
      sourceLabel: 'Theorem 1',
      targetLabel: 'Definition 2',
      relationshipType: 'depends_on',
      evidence: 'See proof in Section 2.',
    })
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
      selectedNode: null,
      focusMode: false,
      focusedNodeId: null,
      canFocusSelection: false,
      canRevealSelectionInPaper: false,
    }))
    expect(snapshot.searchItems).toContainEqual({
      id: 'n1',
      label: 'Theorem 1',
      nodeType: 'theorem',
      detail: 'A well-known theorem.',
    })
    expect(snapshot.nodeTypeFilters).toContainEqual({
      type: 'theorem',
      label: 'Theorems',
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
        nodeType: 'theorem',
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
      ['formula', 'symbol', 'definition', 'theorem'],
      ['has_symbol', 'uses', 'depends_on', 'defines', 'extends', 'mentions'],
    ))
    await act(async () => undefined)
    expect(listener).not.toHaveBeenCalled()

    act(() => controller!.setVisibleTypes(['theorem'], ['depends_on']))
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
