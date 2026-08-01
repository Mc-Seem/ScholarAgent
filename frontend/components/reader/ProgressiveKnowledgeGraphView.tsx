'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  useReactFlow,
} from 'reactflow'
import dagre from 'dagre'
import { AlertCircle, ChevronDown, Filter, Loader2, Network, Search, X } from 'lucide-react'

import { apiUrl } from '../../hooks/useApi'

import {
  HttpKnowledgeGraphApi,
  KnowledgeGraphApiError,
  KnowledgeGraphEntityType,
  KnowledgeGraphEvidence,
  KnowledgeGraphExpertise,
  KnowledgeGraphNode,
  KnowledgeGraphProjection,
  KnowledgeGraphRelation,
  KnowledgeGraphSearchResult,
} from '../../lib/knowledge-graph-api'
import { GraphNode } from './GraphNode'
import { EdgeInfoPanel } from './EdgeInfoPanel'
import { KnowledgeGraphProgress } from './KnowledgeGraphProgress'
import { ConnectionInfo, NodeInfoPanel } from './NodeInfoPanel'
import type {
  KnowledgeGraphEdgeSelection,
  KnowledgeGraphNodeSelection,
  KnowledgeGraphSelection,
  KnowledgeGraphViewProps,
} from './KnowledgeGraphView'
import type {
  KnowledgeGraphController,
  KnowledgeGraphControllerSnapshot,
  KnowledgeGraphLifecycleStatus,
  KnowledgeGraphSearchItem,
  KnowledgeGraphSourceFocus,
} from './knowledge-graph-controller'


const VISIBLE_NODE_CAP = 50
const OVERVIEW_LIMIT = 20
type ControllerActions = Omit<KnowledgeGraphController, 'getSnapshot' | 'subscribe'>

const nodeTypes = {
  topic: GraphNode,
  claim: GraphNode,
  procedure: GraphNode,
  artifact: GraphNode,
  quantity: GraphNode,
}

const edgeColors: Record<string, string> = {
  is_a: '#10b981',
  part_of: '#14b8a6',
  uses: '#6366f1',
  depends_on: '#f59e0b',
  applies_to: '#0ea5e9',
  produces: '#22c55e',
  supports: '#8b5cf6',
  challenges: '#ef4444',
  compares_with: '#ec4899',
}

const emptySnapshot: KnowledgeGraphControllerSnapshot = {
  status: 'loading',
  searchItems: [],
  nodeTypeFilters: [],
  edgeTypeFilters: [],
  visibleNodeCount: 0,
  totalNodeCount: 0,
  visibleEdgeCount: 0,
  totalEdgeCount: 0,
  omittedEdgeCount: 0,
  selectedNode: null,
  focusMode: false,
  focusedNodeId: null,
  canFocusSelection: false,
  canRevealSelectionInPaper: false,
}

function pluralLabel(value: string): string {
  return `${value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())}s`
}

function relationshipLabel(value: string): string {
  const label = value.replaceAll('_', ' ')
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function facetText(node: KnowledgeGraphNode | KnowledgeGraphSearchResult): string | undefined {
  for (const facet of node.facets) {
    const text = facet.payload.text ?? facet.payload.summary
    if (typeof text === 'string' && text) return text
  }
  return undefined
}

function formulaData(node: KnowledgeGraphNode | KnowledgeGraphSearchResult) {
  const facet = node.facets.find(item => item.kind === 'formula')
  return {
    latex: typeof facet?.payload.latex === 'string' ? facet.payload.latex : undefined,
    summary: typeof facet?.payload.summary === 'string' ? facet.payload.summary : facetText(node),
  }
}

function primaryEvidence(node: KnowledgeGraphNode): KnowledgeGraphEvidence | undefined {
  return node.evidence[0]
}

function sourceDomId(node: KnowledgeGraphNode): string | undefined {
  const source = primaryEvidence(node)?.source
  return source?.dom_node_id ?? source?.equation_id ?? undefined
}

function topologyPositions(
  nodeIds: string[],
  relations: KnowledgeGraphRelation[],
  cache: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 160, ranker: 'network-simplex' })
  nodeIds.forEach(id => graph.setNode(id, { width: 180, height: 80 }))
  relations.forEach(relation => graph.setEdge(relation.source_id, relation.target_id))
  dagre.layout(graph)
  const positions = new Map(cache)
  nodeIds.forEach(id => {
    const point = graph.node(id)
    positions.set(id, { x: point.x - 90, y: point.y - 40 })
  })
  return positions
}

export function ProgressiveKnowledgeGraphView({
  paperId,
  onNavigate,
  onRegisterFocusHandler,
  onSelectionChange,
  onControllerChange,
  showEmbeddedControls = true,
  showSelectionDetails = true,
  currentSectionId,
}: KnowledgeGraphViewProps) {
  const api = useMemo(() => new HttpKnowledgeGraphApi(), [])
  const reactFlow = useReactFlow()
  const [status, setStatus] = useState<KnowledgeGraphLifecycleStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [rebuildRequired, setRebuildRequired] = useState(false)
  const [isBuilding, setIsBuilding] = useState(false)
  const [canonicalNodes, setCanonicalNodes] = useState<KnowledgeGraphNode[]>([])
  const [canonicalRelations, setCanonicalRelations] = useState<KnowledgeGraphRelation[]>([])
  const [totalNodeCount, setTotalNodeCount] = useState(0)
  const [totalEdgeCount, setTotalEdgeCount] = useState(0)
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<Set<string>>(new Set())
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(new Set())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KnowledgeGraphSearchResult[]>([])
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [expertise, setExpertise] = useState<KnowledgeGraphExpertise>('intermediate')
  const [showFamiliar, setShowFamiliar] = useState(false)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const nodeMapRef = useRef(new Map<string, KnowledgeGraphNode>())
  const relationMapRef = useRef(new Map<string, KnowledgeGraphRelation>())
  const positionCacheRef = useRef(new Map<string, { x: number; y: number }>())
  const navigateRef = useRef(onNavigate)
  const snapshotRef = useRef<KnowledgeGraphControllerSnapshot>(emptySnapshot)
  const listenersRef = useRef(new Set<() => void>())
  const actionsRef = useRef<ControllerActions>({
    revealNode: (_id: string) => undefined,
    setVisibleTypes: (_nodes: readonly string[], _edges: readonly string[]) => undefined,
    focusSelection: () => undefined,
    clearFocus: () => undefined,
    resetLayout: () => undefined,
    revealSelectionInPaper: () => undefined,
    expandNode: async (_id: string) => undefined,
    focusSource: async (_source: KnowledgeGraphSourceFocus) => undefined,
    search: async (_query: string): Promise<readonly KnowledgeGraphSearchItem[]> => [],
  })

  useEffect(() => {
    navigateRef.current = onNavigate
  }, [onNavigate])

  const applyProjection = useCallback((projection: KnowledgeGraphProjection, replace: boolean) => {
    const nodes = replace ? new Map<string, KnowledgeGraphNode>() : new Map(nodeMapRef.current)
    for (const node of projection.nodes) {
      if (nodes.has(node.stable_id) || nodes.size < VISIBLE_NODE_CAP) nodes.set(node.stable_id, node)
    }
    const relations = replace ? new Map<string, KnowledgeGraphRelation>() : new Map(relationMapRef.current)
    for (const relation of projection.relations) {
      if (nodes.has(relation.source_id) && nodes.has(relation.target_id)) {
        relations.set(relation.stable_id, relation)
      }
    }
    for (const [id, relation] of relations) {
      if (!nodes.has(relation.source_id) || !nodes.has(relation.target_id)) relations.delete(id)
    }
    nodeMapRef.current = nodes
    relationMapRef.current = relations
    setCanonicalNodes([...nodes.values()])
    setCanonicalRelations([...relations.values()])
    setTotalNodeCount(projection.total_entity_count)
    setTotalEdgeCount(projection.total_relation_count)
    setVisibleNodeTypes(previous => previous.size
      ? previous
      : new Set([...nodes.values()].map(node => node.type)))
    setVisibleEdgeTypes(previous => previous.size
      ? previous
      : new Set([...relations.values()].map(relation => relation.type)))
    setStatus(nodes.size ? 'ready' : 'empty')
    setError(null)
  }, [])

  const loadOverview = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const response = await api.overview(paperId, {
        expertise,
        showFamiliar,
        limit: OVERVIEW_LIMIT,
      })
      if (response.status === 'rebuild_required') {
        setRebuildRequired(true)
        setStatus('empty')
        return
      }
      setRebuildRequired(false)
      applyProjection(response, true)
    } catch (requestError) {
      if (requestError instanceof KnowledgeGraphApiError && requestError.status === 404) {
        setStatus('empty')
      } else {
        setStatus('error')
        setError(requestError instanceof Error ? requestError.message : 'Failed to load knowledge graph')
      }
    }
  }, [api, applyProjection, expertise, paperId, showFamiliar])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    const onBuildStart = () => {
      setIsBuilding(true)
      setStatus('building')
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      onSelectionChange?.(null)
    }
    window.addEventListener('kg-build-start', onBuildStart)
    return () => window.removeEventListener('kg-build-start', onBuildStart)
  }, [onSelectionChange])

  const expandNode = useCallback(async (nodeId: string) => {
    const response = await api.subgraph(paperId, {
      seedIds: [nodeId],
      nodeBudget: 20,
      edgeBudget: 40,
      expertise,
    })
    if (response.status === 'ready') applyProjection(response, false)
  }, [api, applyProjection, expertise, paperId])

  const focusSource = useCallback(async (source: KnowledgeGraphSourceFocus) => {
    const response = await api.subgraph(paperId, {
      section: source.section,
      domNodeId: source.domNodeId,
      equationId: source.equationId,
      nodeBudget: 25,
      edgeBudget: 50,
      expertise,
    })
    if (response.status === 'ready') {
      applyProjection(response, false)
      setFocusMode(true)
      setFocusedNodeId(response.nodes[0]?.stable_id ?? null)
    }
  }, [api, applyProjection, expertise, paperId])

  useEffect(() => {
    if (currentSectionId && status === 'ready') void focusSource({ section: currentSectionId })
  }, [currentSectionId, focusSource, status])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setShowSearchResults(false)
      return
    }
    const timeout = window.setTimeout(async () => {
      try {
        const response = await api.search(paperId, searchQuery, { limit: 10 })
        if (response.status === 'ready') {
          setSearchResults(response.results)
          setShowSearchResults(true)
        }
      } catch {
        setSearchResults([])
      }
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [api, paperId, searchQuery])

  const visibleCanonicalNodes = useMemo(
    () => canonicalNodes.filter(node => visibleNodeTypes.has(node.type)),
    [canonicalNodes, visibleNodeTypes],
  )
  const visibleNodeIds = useMemo(
    () => new Set(visibleCanonicalNodes.map(node => node.stable_id)),
    [visibleCanonicalNodes],
  )
  const visibleCanonicalRelations = useMemo(
    () => canonicalRelations.filter(relation => visibleEdgeTypes.has(relation.type)
      && visibleNodeIds.has(relation.source_id)
      && visibleNodeIds.has(relation.target_id)),
    [canonicalRelations, visibleEdgeTypes, visibleNodeIds],
  )
  const topologyKey = `${visibleCanonicalNodes.map(node => node.stable_id).sort().join('|')}::${visibleCanonicalRelations
    .map(relation => `${relation.source_id}>${relation.target_id}`)
    .sort()
    .join('|')}::${layoutRevision}`
  const positions = useMemo(() => {
    const next = topologyPositions(
      visibleCanonicalNodes.map(node => node.stable_id),
      visibleCanonicalRelations,
      positionCacheRef.current,
    )
    positionCacheRef.current = next
    return next
    // Layout is intentionally keyed only by topology and explicit reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey])

  const flowNodes = useMemo<Node[]>(() => visibleCanonicalNodes.map(node => {
    const formula = formulaData(node)
    const description = facetText(node)
    return {
      id: node.stable_id,
      type: node.type,
      position: positions.get(node.stable_id) ?? { x: 0, y: 0 },
      data: {
        label: node.label,
        nodeType: node.type,
        definition: node.type === 'topic' ? description : undefined,
        statement: node.type === 'claim' ? description : undefined,
        summary: formula.summary ?? description,
        latex: formula.latex,
        domNodeId: sourceDomId(node) ?? '',
        rank: node.rank,
        aliases: node.aliases,
        omittedRelationCount: node.omitted_relation_count,
        onNavigate: () => {
          const id = sourceDomId(node)
          if (id) navigateRef.current?.(id)
        },
        isFocused: focusedNodeId === node.stable_id,
      },
    }
  }), [focusedNodeId, positions, visibleCanonicalNodes])

  const flowEdges = useMemo<Edge[]>(() => visibleCanonicalRelations.map(relation => ({
    id: relation.stable_id,
    source: relation.source_id,
    target: relation.target_id,
    label: relation.type,
    type: 'smoothstep',
    style: { stroke: edgeColors[relation.type] ?? '#94a3b8' },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[relation.type] ?? '#94a3b8' },
    data: { relation },
  })), [visibleCanonicalRelations])

  const connectionInfo = useCallback((nodeId: string) => {
    const incoming: ConnectionInfo[] = []
    const outgoing: ConnectionInfo[] = []
    for (const relation of canonicalRelations) {
      if (relation.source_id === nodeId) {
        const target = nodeMapRef.current.get(relation.target_id)
        if (target) outgoing.push({
          nodeId: target.stable_id,
          nodeLabel: target.label,
          nodeType: target.type,
          relationshipType: relation.type,
        })
      }
      if (relation.target_id === nodeId) {
        const source = nodeMapRef.current.get(relation.source_id)
        if (source) incoming.push({
          nodeId: source.stable_id,
          nodeLabel: source.label,
          nodeType: source.type,
          relationshipType: relation.type,
        })
      }
    }
    return { incoming, outgoing }
  }, [canonicalRelations])

  const selectionForNode = useCallback((node: KnowledgeGraphNode): KnowledgeGraphNodeSelection => {
    const description = facetText(node)
    const formula = formulaData(node)
    const connections = connectionInfo(node.stable_id)
    return {
      kind: 'node',
      id: node.stable_id,
      label: node.label,
      nodeType: node.type,
      definition: node.type === 'topic' ? description : undefined,
      statement: node.type === 'claim' ? description : undefined,
      summary: formula.summary ?? description,
      latex: formula.latex,
      domNodeId: sourceDomId(node),
      aliases: node.aliases,
      facets: node.facets,
      signals: node.signals,
      evidence: node.evidence,
      rank: node.rank,
      omittedRelationCount: node.omitted_relation_count,
      incomingConnections: connections.incoming,
      outgoingConnections: connections.outgoing,
    }
  }, [connectionInfo])

  const selectNode = useCallback((nodeId: string) => {
    const node = nodeMapRef.current.get(nodeId)
    if (!node) return
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
    setVisibleNodeTypes(previous => new Set(previous).add(node.type))
    onSelectionChange?.(selectionForNode(node))
    const position = positionCacheRef.current.get(nodeId)
    if (position) window.setTimeout(() => reactFlow.setCenter(position.x + 90, position.y + 40, { zoom: 1.4, duration: 300 }), 0)
  }, [onSelectionChange, reactFlow, selectionForNode])

  const revealNode = useCallback((nodeId: string) => {
    if (nodeMapRef.current.has(nodeId)) {
      selectNode(nodeId)
      return
    }
    void expandNode(nodeId).then(() => selectNode(nodeId))
  }, [expandNode, selectNode])

  useEffect(() => {
    onRegisterFocusHandler?.(revealNode)
  }, [onRegisterFocusHandler, revealNode])

  const selectedNode = selectedNodeId ? nodeMapRef.current.get(selectedNodeId) ?? null : null
  const selectedRelation = selectedEdgeId ? relationMapRef.current.get(selectedEdgeId) ?? null : null

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    onSelectionChange?.(null)
  }, [onSelectionChange])

  const selectEdge = useCallback((relationId: string) => {
    const relation = relationMapRef.current.get(relationId)
    if (!relation) return
    const source = nodeMapRef.current.get(relation.source_id)
    const target = nodeMapRef.current.get(relation.target_id)
    if (!source || !target) return
    setSelectedEdgeId(relationId)
    setSelectedNodeId(null)
    const selection: KnowledgeGraphEdgeSelection = {
      kind: 'edge',
      relationId: relation.stable_id,
      sourceId: source.stable_id,
      targetId: target.stable_id,
      sourceLabel: source.label,
      targetLabel: target.label,
      relationshipType: relation.type,
      qualifiers: relation.qualifiers,
      evidence: relation.evidence[0]?.source.quote,
      evidenceItems: relation.evidence,
    }
    onSelectionChange?.(selection)
  }, [onSelectionChange])

  const searchItems = useMemo<KnowledgeGraphSearchItem[]>(() => (
    searchResults.length ? searchResults : canonicalNodes
  ).slice(0, VISIBLE_NODE_CAP).map(node => ({
    id: node.stable_id,
    label: node.label,
    nodeType: node.type,
    detail: facetText(node),
    sectionId: node.evidence[0]?.source.section_id ?? undefined,
  })), [canonicalNodes, searchResults])

  const nodeTypeFilters = useMemo(() => {
    const counts = new Map<string, number>()
    canonicalNodes.forEach(node => counts.set(node.type, (counts.get(node.type) ?? 0) + 1))
    return [...counts].sort().map(([type, count]) => ({
      type, label: pluralLabel(type), count, selected: visibleNodeTypes.has(type),
    }))
  }, [canonicalNodes, visibleNodeTypes])
  const edgeTypeFilters = useMemo(() => {
    const counts = new Map<string, number>()
    canonicalRelations.forEach(relation => counts.set(relation.type, (counts.get(relation.type) ?? 0) + 1))
    return [...counts].sort().map(([type, count]) => ({
      type, label: relationshipLabel(type), count, selected: visibleEdgeTypes.has(type),
    }))
  }, [canonicalRelations, visibleEdgeTypes])

  const controller = useMemo<KnowledgeGraphController>(() => ({
    getSnapshot: () => snapshotRef.current,
    subscribe: listener => {
      listenersRef.current.add(listener)
      return () => listenersRef.current.delete(listener)
    },
    revealNode: id => actionsRef.current.revealNode(id),
    setVisibleTypes: (nodes, edges) => actionsRef.current.setVisibleTypes(nodes, edges),
    focusSelection: () => actionsRef.current.focusSelection(),
    clearFocus: () => actionsRef.current.clearFocus(),
    resetLayout: () => actionsRef.current.resetLayout(),
    revealSelectionInPaper: () => actionsRef.current.revealSelectionInPaper(),
    expandNode: id => actionsRef.current.expandNode(id),
    focusSource: source => actionsRef.current.focusSource(source),
    search: query => actionsRef.current.search(query),
  }), [])

  actionsRef.current = {
    revealNode,
    setVisibleTypes: (nodes, edges) => {
      setVisibleNodeTypes(new Set(nodes))
      setVisibleEdgeTypes(new Set(edges))
    },
    focusSelection: () => {
      if (!selectedNodeId) return
      setFocusMode(true)
      setFocusedNodeId(selectedNodeId)
      void expandNode(selectedNodeId)
    },
    clearFocus: () => {
      setFocusMode(false)
      setFocusedNodeId(null)
    },
    resetLayout: () => {
      positionCacheRef.current.clear()
      setLayoutRevision(value => value + 1)
      window.setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 300 }), 0)
    },
    revealSelectionInPaper: () => {
      if (!selectedNode) return
      const id = sourceDomId(selectedNode)
      if (id) navigateRef.current?.(id)
    },
    expandNode,
    focusSource,
    search: async query => {
      const response = await api.search(paperId, query, { limit: 10 })
      if (response.status !== 'ready') return []
      setSearchResults(response.results)
      return response.results.map(result => ({
        id: result.stable_id,
        label: result.label,
        nodeType: result.type,
        detail: facetText(result),
        sectionId: result.evidence[0]?.source.section_id ?? undefined,
      }))
    },
  }

  useEffect(() => {
    onControllerChange?.(controller)
    return () => onControllerChange?.(null)
  }, [controller, onControllerChange])

  useEffect(() => {
    const next: KnowledgeGraphControllerSnapshot = {
      status,
      searchItems,
      nodeTypeFilters,
      edgeTypeFilters,
      visibleNodeCount: visibleCanonicalNodes.length,
      totalNodeCount,
      visibleEdgeCount: visibleCanonicalRelations.length,
      totalEdgeCount,
      omittedEdgeCount: Math.max(0, totalEdgeCount - visibleCanonicalRelations.length),
      selectedNode: selectedNode ? {
        id: selectedNode.stable_id,
        label: selectedNode.label,
        nodeType: selectedNode.type,
        domNodeId: sourceDomId(selectedNode),
      } : null,
      focusMode,
      focusedNodeId,
      canFocusSelection: Boolean(selectedNode),
      canRevealSelectionInPaper: Boolean(selectedNode && sourceDomId(selectedNode)),
    }
    if (JSON.stringify(snapshotRef.current) !== JSON.stringify(next)) {
      snapshotRef.current = next
      listenersRef.current.forEach(listener => listener())
    }
  }, [
    edgeTypeFilters, focusMode, focusedNodeId, nodeTypeFilters, searchItems, selectedNode,
    status, totalEdgeCount, totalNodeCount, visibleCanonicalNodes.length,
    visibleCanonicalRelations.length,
  ])

  const handleSearchResult = async (result: KnowledgeGraphSearchResult) => {
    if (!nodeMapRef.current.has(result.stable_id)) await expandNode(result.stable_id)
    selectNode(result.stable_id)
    setShowSearchResults(false)
  }

  if (isBuilding || status === 'building') {
    return <KnowledgeGraphProgress
      paperId={paperId}
      onComplete={() => {
        setIsBuilding(false)
        clearSelection()
        void loadOverview()
      }}
      onError={message => {
        setIsBuilding(false)
        setStatus('error')
        setError(message)
      }}
    />
  }

  if (status === 'loading') {
    return <div className="h-full flex items-center justify-center text-slate-500"><Loader2 className="animate-spin mr-2" />Loading graph overview…</div>
  }

  if (status === 'error') {
    return <div className="h-full flex flex-col items-center justify-center text-red-600 gap-2"><AlertCircle />{error ?? 'Unable to load graph'}<button onClick={() => void loadOverview()} className="text-sm underline">Retry</button></div>
  }

  if (status === 'empty') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-6 text-center">
        <Network size={36} />
        <div>{rebuildRequired ? 'This graph uses the legacy format and requires a rebuild.' : 'No knowledge graph has been built yet.'}</div>
        <button
          className="px-3 py-2 rounded bg-indigo-600 text-white text-sm"
          onClick={async () => {
            await fetch(apiUrl(`/api/papers/${encodeURIComponent(paperId)}/knowledge-graph/build`), { method: 'POST' })
            window.dispatchEvent(new Event('kg-build-start'))
          }}
        >
          {rebuildRequired ? 'Rebuild graph' : 'Build graph'}
        </button>
      </div>
    )
  }

  return (
    <div className="h-full relative bg-slate-50">
      {showEmbeddedControls && (
        <div className="h-9 px-2 flex items-center gap-2 bg-white border-b border-slate-200 relative z-20">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-2 top-2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              onFocus={() => searchResults.length && setShowSearchResults(true)}
              placeholder="Search entities..."
              className="w-full h-7 pl-7 pr-7 text-xs border border-slate-200 rounded"
            />
            {searchQuery && <button className="absolute right-2 top-1.5" onClick={() => setSearchQuery('')}><X size={14} /></button>}
            {showSearchResults && (
              <div className="absolute top-8 left-0 right-0 bg-white border rounded shadow-lg max-h-64 overflow-auto">
                {searchResults.map(result => (
                  <button key={result.stable_id} onClick={() => void handleSearchResult(result)} className="block w-full text-left px-3 py-2 hover:bg-slate-50">
                    <div className="text-xs font-medium">{result.label}</div>
                    <div className="text-[10px] text-slate-500">{result.type}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <select aria-label="Expertise" value={expertise} onChange={event => setExpertise(event.target.value as KnowledgeGraphExpertise)} className="h-7 text-xs border rounded px-1">
            <option value="novice">Novice</option>
            <option value="intermediate">Intermediate</option>
            <option value="expert">Expert</option>
          </select>
          <label className="text-[10px] flex items-center gap-1 whitespace-nowrap">
            <input type="checkbox" checked={showFamiliar} onChange={event => setShowFamiliar(event.target.checked)} />
            Show familiar
          </label>
          <div className="relative">
            <button title="Filter visible nodes and relationships" onClick={() => setShowFilterMenu(value => !value)} className="p-1.5 rounded hover:bg-slate-100"><Filter size={15} /></button>
            {showFilterMenu && (
              <div className="absolute right-0 top-8 bg-white border rounded shadow-lg w-56 p-3 space-y-2">
                <div className="text-[10px] uppercase text-slate-500">Entity types</div>
                {nodeTypeFilters.map(option => (
                  <label key={option.type} className="flex gap-2 text-xs">
                    <input type="checkbox" checked={option.selected} onChange={() => setVisibleNodeTypes(previous => {
                      const next = new Set(previous)
                      next.has(option.type) ? next.delete(option.type) : next.add(option.type)
                      return next
                    })} />{option.label} ({option.count})
                  </label>
                ))}
                <div className="text-[10px] uppercase text-slate-500 pt-1">Relations</div>
                {edgeTypeFilters.map(option => (
                  <label key={option.type} className="flex gap-2 text-xs">
                    <input type="checkbox" checked={option.selected} onChange={() => setVisibleEdgeTypes(previous => {
                      const next = new Set(previous)
                      next.has(option.type) ? next.delete(option.type) : next.add(option.type)
                      return next
                    })} />{option.label} ({option.count})
                  </label>
                ))}
              </div>
            )}
          </div>
          <span className="text-[10px] text-slate-500 whitespace-nowrap">{visibleCanonicalNodes.length}/{totalNodeCount}</span>
        </div>
      )}
      <div style={{ height: showEmbeddedControls ? 'calc(100% - 36px)' : '100%' }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={(_event, node) => selectNode(node.id)}
          onEdgeClick={(_event, edge) => selectEdge(edge.id)}
          onPaneClick={clearSelection}
          fitView
          minZoom={0.1}
          maxZoom={2}
        >
          <Background />
          <Controls />
          {visibleCanonicalNodes.length <= 30 && <MiniMap />}
        </ReactFlow>
      </div>
      {showSelectionDetails && selectedNode && (
        <NodeInfoPanel
          label={selectedNode.label}
          nodeType={selectedNode.type}
          definition={selectedNode.type === 'topic' ? facetText(selectedNode) : undefined}
          statement={selectedNode.type === 'claim' ? facetText(selectedNode) : undefined}
          summary={formulaData(selectedNode).summary ?? facetText(selectedNode)}
          latex={formulaData(selectedNode).latex}
          aliases={selectedNode.aliases}
          facets={selectedNode.facets}
          signals={selectedNode.signals}
          evidence={selectedNode.evidence}
          rank={selectedNode.rank}
          incomingConnections={connectionInfo(selectedNode.stable_id).incoming}
          outgoingConnections={connectionInfo(selectedNode.stable_id).outgoing}
          onConnectionClick={revealNode}
          onClose={clearSelection}
          onNavigate={() => {
            const id = sourceDomId(selectedNode)
            if (id) navigateRef.current?.(id)
          }}
          onFocus={() => actionsRef.current.focusSelection()}
          onExpand={() => void expandNode(selectedNode.stable_id)}
          omittedRelationCount={selectedNode.omitted_relation_count}
          isFocused={focusedNodeId === selectedNode.stable_id}
        />
      )}
      {showSelectionDetails && selectedRelation && (() => {
        const source = nodeMapRef.current.get(selectedRelation.source_id)
        const target = nodeMapRef.current.get(selectedRelation.target_id)
        if (!source || !target) return null
        return <EdgeInfoPanel
          sourceLabel={source.label}
          targetLabel={target.label}
          relationshipType={selectedRelation.type}
          qualifiers={selectedRelation.qualifiers}
          evidence={selectedRelation.evidence[0]?.source.quote}
          evidenceItems={selectedRelation.evidence}
          onNavigateEvidence={evidence => {
            const id = evidence.source.dom_node_id ?? evidence.source.equation_id
            if (id) navigateRef.current?.(id)
          }}
          onClose={clearSelection}
          onClickSource={() => revealNode(source.stable_id)}
          onClickTarget={() => revealNode(target.stable_id)}
        />
      })()}
      {focusMode && showEmbeddedControls && (
        <button onClick={() => actionsRef.current.clearFocus()} className="absolute bottom-4 left-4 z-10 text-xs bg-white border rounded px-2 py-1 shadow">
          Clear focus <ChevronDown size={12} className="inline" />
        </button>
      )}
    </div>
  )
}