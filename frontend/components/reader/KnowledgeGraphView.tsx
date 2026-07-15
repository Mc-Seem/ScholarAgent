'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
  ConnectionLineType,
  EdgeMouseHandler,
  NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { GraphNode } from './GraphNode';
import { KnowledgeGraphProgress } from './KnowledgeGraphProgress';
import { EdgeInfoPanel } from './EdgeInfoPanel';
import { NodeInfoPanel, ConnectionInfo } from './NodeInfoPanel';
import { Loader2, AlertCircle, Network, Search, X, Focus, Maximize2, Filter, ChevronDown } from 'lucide-react';
import { EmptyState } from '../ui';
import { apiUrl } from '../../hooks/useApi';

// Custom node types
const nodeTypes = {
  formula: GraphNode,
  symbol: GraphNode,
  definition: GraphNode,
  theorem: GraphNode,
};

// Edge colors by relationship type
const edgeColors: Record<string, string> = {
  has_symbol: '#f59e0b', // amber
  uses: '#6366f1',       // indigo
  depends_on: '#f59e0b', // amber
  defines: '#10b981',    // emerald
  extends: '#8b5cf6',    // violet
  mentions: '#94a3b8',   // slate
};

interface KnowledgeGraphViewProps {
  paperId: string;
  onNavigate?: (domNodeId: string) => void;
  onRegisterFocusHandler?: (handler: (nodeId: string) => void) => void;
}

interface ApiNode {
  id: string;
  type: string;
  label: string;
  context?: string;
  definition?: string;
  statement?: string;
  summary?: string;
  dom_node_id: string;
  section_id: string;
  latex?: string;
}

interface ApiEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  evidence?: string;
}

interface GraphData {
  nodes: ApiNode[];
  edges: ApiEdge[];
  metadata?: {
    node_count: number;
    edge_count: number;
    formula_count?: number;
    symbol_count: number;
    definition_count: number;
    theorem_count: number;
    entity_counts?: Record<string, number>;
  };
}

/**
 * Hybrid layout: hierarchical for connected nodes, compact grid for isolated nodes.
 */
function hierarchicalLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const nodeWidth = 180;
  const nodeHeight = 80;

  // Identify which nodes are connected (have at least one edge)
  const connectedNodeIds = new Set<string>();
  edges.forEach((edge) => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });

  const connectedNodes = nodes.filter(n => connectedNodeIds.has(n.id));
  const isolatedNodes = nodes.filter(n => !connectedNodeIds.has(n.id));

  // Layout connected nodes hierarchically using dagre
  if (connectedNodes.length > 0) {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({
      rankdir: 'LR',   // Left to Right
      nodesep: 100,    // Vertical spacing between nodes
      ranksep: 200,    // Horizontal spacing between ranks
      marginx: 50,
      marginy: 50,
      ranker: 'network-simplex',
    });

    // Add connected nodes to dagre
    connectedNodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    // Add edges
    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target);
    });

    // Calculate layout
    dagre.layout(dagreGraph);

    // Apply positions
    connectedNodes.forEach((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      node.position = {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      };
    });
  }

  // Layout isolated nodes in a compact grid at the bottom-right
  if (isolatedNodes.length > 0) {
    const cols = Math.ceil(Math.sqrt(isolatedNodes.length)); // Square-ish grid
    const startX = 50;  // Start at left edge
    const startY = connectedNodes.length > 0
      ? Math.max(...connectedNodes.map(n => n.position.y)) + nodeHeight + 200  // Below connected graph
      : 50;  // Or at top if no connected nodes

    isolatedNodes.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      node.position = {
        x: startX + col * (nodeWidth + 40),
        y: startY + row * (nodeHeight + 40),
      };
    });
  }

  return { nodes, edges };
}

function KnowledgeGraphViewInner({ paperId, onNavigate, onRegisterFocusHandler }: KnowledgeGraphViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<{
    sourceId: string;
    targetId: string;
    sourceLabel: string;
    targetLabel: string;
    type: string;
    evidence?: string;
  } | null>(null);
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    label: string;
    nodeType: string;
    context?: string;
    definition?: string;
    statement?: string;
    summary?: string;
    latex?: string;
    onNavigate: () => void;
  } | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Node[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Focus mode (subgraph view) state
  const [focusMode, setFocusMode] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // Store the full graph data for filtering
  const [allNodes, setAllNodes] = useState<Node[]>([]);
  const [allEdges, setAllEdges] = useState<Edge[]>([]);

  // Filter state
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const defaultNodeTypes = ['formula', 'symbol', 'definition', 'theorem'];
  const defaultEdgeTypes = ['has_symbol', 'uses', 'depends_on', 'defines', 'extends', 'mentions'];
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<Set<string>>(new Set(defaultNodeTypes));
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(new Set(defaultEdgeTypes));
  const filterMenuRef = useRef<HTMLDivElement>(null);

  // React Flow instance for programmatic control
  const reactFlowInstance = useReactFlow();

  // Store onNavigate in a ref to avoid re-fetching when it changes
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  // Fetch graph data
  const fetchGraphData = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch(apiUrl(`/api/papers/${paperId}/knowledge-graph`))
      .then(res => {
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('not_built');
          }
          throw new Error(`Failed to load graph: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data: GraphData) => {
        setGraphData(data);

        // Convert API nodes to React Flow nodes
        const flowNodes: Node[] = data.nodes.map((n) => ({
          id: n.id,
          type: n.type, // This maps to our custom node types
          data: {
            label: n.label,
            nodeType: n.type,
            context: n.context,
            definition: n.definition,
            statement: n.statement,
            summary: n.summary,
            latex: n.latex,
            domNodeId: n.dom_node_id,
            onNavigate: () => onNavigateRef.current?.(n.dom_node_id),
          },
          position: { x: 0, y: 0 }, // Will be set by autoLayout
        }));

        // Convert API edges to React Flow edges
        const flowEdges: Edge[] = data.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.type,
          type: 'smoothstep',
          animated: e.type === 'uses' || e.type === 'depends_on',
          style: { stroke: edgeColors[e.type] || '#94a3b8' },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColors[e.type] || '#94a3b8',
          },
          data: { evidence: e.evidence },
        }));

        // Apply hierarchical layout
        const layouted = hierarchicalLayout(flowNodes, flowEdges);

        // Store full graph for filtering
        setAllNodes(layouted.nodes);
        setAllEdges(layouted.edges);

        // Note: Don't set nodes/edges directly here - let the effect handle it
        // to preserve focus mode and filters
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [paperId]);

  // Initial fetch
  useEffect(() => {
    fetchGraphData();
  }, [fetchGraphData]);

  // Listen for build events from parent (PaperLoader)
  useEffect(() => {
    const handleBuildStart = () => {
      setIsBuilding(true);
      setError(null);
    };

    window.addEventListener('kg-build-start', handleBuildStart);
    return () => window.removeEventListener('kg-build-start', handleBuildStart);
  }, []);

  const handleBuildComplete = useCallback(() => {
    setIsBuilding(false);
    // Reset focus and filters when rebuilding graph
    setFocusMode(false);
    setFocusedNodeId(null);
    setVisibleNodeTypes(new Set(defaultNodeTypes));
    setVisibleEdgeTypes(new Set(defaultEdgeTypes));
    fetchGraphData();
  }, [fetchGraphData]);

  const handleBuildError = useCallback((errorMsg: string) => {
    setIsBuilding(false);
    setError(errorMsg);
  }, []);

  // Compute subgraph: all ancestors and descendants of a node
  const computeSubgraph = useCallback((nodeId: string, nodes: Node[], edges: Edge[]) => {
    const connectedNodeIds = new Set<string>([nodeId]);

    // Build adjacency lists for traversal
    const children = new Map<string, string[]>(); // parent -> children
    const parents = new Map<string, string[]>();  // child -> parents

    edges.forEach(edge => {
      // edge.source -> edge.target (source depends on / uses target, or target defines source)
      if (!children.has(edge.source)) children.set(edge.source, []);
      children.get(edge.source)!.push(edge.target);

      if (!parents.has(edge.target)) parents.set(edge.target, []);
      parents.get(edge.target)!.push(edge.source);
    });

    // BFS to find all descendants (children, grandchildren, etc.)
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const childNodes = children.get(current) || [];
      for (const child of childNodes) {
        if (!connectedNodeIds.has(child)) {
          connectedNodeIds.add(child);
          queue.push(child);
        }
      }
    }

    // BFS to find all ancestors (parents, grandparents, etc.)
    const ancestorQueue = [nodeId];
    while (ancestorQueue.length > 0) {
      const current = ancestorQueue.shift()!;
      const parentNodes = parents.get(current) || [];
      for (const parent of parentNodes) {
        if (!connectedNodeIds.has(parent)) {
          connectedNodeIds.add(parent);
          ancestorQueue.push(parent);
        }
      }
    }

    // Filter nodes and edges
    const filteredNodes = nodes.filter(n => connectedNodeIds.has(n.id));
    const filteredEdges = edges.filter(e =>
      connectedNodeIds.has(e.source) && connectedNodeIds.has(e.target)
    );

    return { nodes: filteredNodes, edges: filteredEdges };
  }, []);

  // Update displayed graph when focus mode, focused node, or filters change
  useEffect(() => {
    if (allNodes.length === 0) return;

    let workingNodes = allNodes;
    let workingEdges = allEdges;

    // Apply focus mode first (if active)
    if (focusMode && focusedNodeId) {
      const subgraph = computeSubgraph(focusedNodeId, allNodes, allEdges);
      workingNodes = subgraph.nodes;
      workingEdges = subgraph.edges;
    }

    // Apply node type filters
    workingNodes = workingNodes.filter(n => visibleNodeTypes.has(n.data.nodeType));
    const visibleNodeIds = new Set(workingNodes.map(n => n.id));

    // Apply edge type filters and ensure both endpoints are visible
    workingEdges = workingEdges.filter(e =>
      visibleEdgeTypes.has(e.label as string) &&
      visibleNodeIds.has(e.source) &&
      visibleNodeIds.has(e.target)
    );

    // Mark the focused node
    const nodesWithFocus = workingNodes.map(n => ({
      ...n,
      data: { ...n.data, isFocused: focusMode && n.id === focusedNodeId }
    }));

    // Re-layout
    const layouted = hierarchicalLayout([...nodesWithFocus], [...workingEdges]);

    setNodes(layouted.nodes);
    setEdges(layouted.edges);

    // Fit view when focus mode changes
    if (focusMode && focusedNodeId) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
      }, 50);
    }
  }, [focusMode, focusedNodeId, allNodes, allEdges, visibleNodeTypes, visibleEdgeTypes, computeSubgraph, setNodes, setEdges, reactFlowInstance]);

  // Handle node click to show full details
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    event.stopPropagation();

    setSelectedNode({
      id: node.id,
      label: node.data.label,
      nodeType: node.data.nodeType,
      context: node.data.context,
      definition: node.data.definition,
      statement: node.data.statement,
      summary: node.data.summary,
      latex: node.data.latex,
      onNavigate: node.data.onNavigate,
    });

    // Close edge panel and menus if open
    setSelectedEdge(null);
    setShowFilterMenu(false);
    setShowSearchResults(false);
  }, []);

  // Handle edge click to show evidence
  const onEdgeClick: EdgeMouseHandler = useCallback((event, edge) => {
    event.stopPropagation();

    // Find source and target nodes to get their labels
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);

    if (sourceNode && targetNode) {
      setSelectedEdge({
        sourceId: edge.source,
        targetId: edge.target,
        sourceLabel: sourceNode.data.label,
        targetLabel: targetNode.data.label,
        type: (edge.label as string) || edge.type || 'unknown',
        evidence: edge.data?.evidence,
      });

      // Close node panel and menus if open
      setSelectedNode(null);
      setShowFilterMenu(false);
      setShowSearchResults(false);
    }
  }, [nodes]);

  // Helper to show node info by ID and optionally center on it
  const showNodeById = useCallback((nodeId: string, centerOnNode = false, activateFocus = false) => {
    // Look in allNodes to find node data (in case we're in focus mode and node isn't displayed)
    const nodeData = allNodes.find(n => n.id === nodeId);
    if (nodeData) {
      setSelectedNode({
        id: nodeData.id,
        label: nodeData.data.label,
        nodeType: nodeData.data.nodeType,
        context: nodeData.data.context,
        definition: nodeData.data.definition,
        statement: nodeData.data.statement,
        summary: nodeData.data.summary,
        latex: nodeData.data.latex,
        onNavigate: nodeData.data.onNavigate,
      });
      setSelectedEdge(null);

      // Activate focus mode if requested (shows subgraph with neighbors)
      if (activateFocus) {
        setFocusMode(true);
        setFocusedNodeId(nodeId);
      }

      if (centerOnNode) {
        // Find the node in current display
        const displayedNode = nodes.find(n => n.id === nodeId);
        if (displayedNode) {
          reactFlowInstance.setCenter(
            displayedNode.position.x + 90,
            displayedNode.position.y + 40,
            { zoom: 1, duration: 500 }
          );
        }
      }
    }
  }, [allNodes, nodes, reactFlowInstance]);

  // Register the focus handler with parent
  useEffect(() => {
    if (onRegisterFocusHandler && reactFlowInstance) {
      const focusHandler = (nodeId: string) => {
        // Activate focus mode (show subgraph), center view, and open node panel
        showNodeById(nodeId, true, true);
      };
      onRegisterFocusHandler(focusHandler);
    }
  }, [onRegisterFocusHandler, reactFlowInstance, showNodeById]);

  // Search functionality - always search all nodes, not just displayed ones
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const query = searchQuery.toLowerCase();
    const results = allNodes.filter(node => {
      const label = node.data.label?.toLowerCase() || '';
      const context = node.data.context?.toLowerCase() || '';
      const definition = node.data.definition?.toLowerCase() || '';
      const statement = node.data.statement?.toLowerCase() || '';
      const summary = node.data.summary?.toLowerCase() || '';
      return label.includes(query) || context.includes(query) || definition.includes(query) || statement.includes(query) || summary.includes(query);
    });

    // Sort results:
    // 1. Label matches first, then content matches
    // 2. Within each group: definitions > theorems > formulas > symbols
    const typePriority: Record<string, number> = {
      definition: 0,
      theorem: 1,
      formula: 2,
      symbol: 3,
    };

    results.sort((a, b) => {
      const aLabelMatch = (a.data.label?.toLowerCase() || '').includes(query);
      const bLabelMatch = (b.data.label?.toLowerCase() || '').includes(query);

      // Label matches come first
      if (aLabelMatch && !bLabelMatch) return -1;
      if (!aLabelMatch && bLabelMatch) return 1;

      // Within same match type, sort by node type priority
      const aPriority = typePriority[a.data.nodeType] ?? 3;
      const bPriority = typePriority[b.data.nodeType] ?? 3;
      return aPriority - bPriority;
    });

    setSearchResults(results.slice(0, 10)); // Limit to 10 results
    setShowSearchResults(true);
  }, [searchQuery, allNodes]);

  // Close search results and filter menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setShowSearchResults(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(target)) {
        setShowFilterMenu(false);
      }
    };

    // Only add listener if menus are open
    if (showSearchResults || showFilterMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSearchResults, showFilterMenu]);

  // Handle search result selection
  const selectSearchResult = useCallback((node: Node) => {
    showNodeById(node.id, true);
    setSearchQuery('');
    setShowSearchResults(false);
  }, [showNodeById]);

  // Close info panels and menus when clicking on the background
  const onPaneClick = useCallback(() => {
    setSelectedEdge(null);
    setSelectedNode(null);
    setShowFilterMenu(false);
    setShowSearchResults(false);
  }, []);

  // Toggle filter helpers
  const toggleNodeType = (type: string) => {
    setVisibleNodeTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const toggleEdgeType = (type: string) => {
    setVisibleEdgeTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Check if any filters are active
  const hasActiveFilters = visibleNodeTypes.size < defaultNodeTypes.length || visibleEdgeTypes.size < defaultEdgeTypes.length;

  // Compute connections for a node
  const getNodeConnections = useCallback((nodeId: string): { incoming: ConnectionInfo[], outgoing: ConnectionInfo[] } => {
    const incoming: ConnectionInfo[] = [];
    const outgoing: ConnectionInfo[] = [];

    allEdges.forEach(edge => {
      if (edge.target === nodeId) {
        // Incoming edge: source -> this node
        const sourceNode = allNodes.find(n => n.id === edge.source);
        if (sourceNode) {
          incoming.push({
            nodeId: sourceNode.id,
            nodeLabel: sourceNode.data.label,
            nodeType: sourceNode.data.nodeType,
            relationshipType: edge.label as string,
          });
        }
      }
      if (edge.source === nodeId) {
        // Outgoing edge: this node -> target
        const targetNode = allNodes.find(n => n.id === edge.target);
        if (targetNode) {
          outgoing.push({
            nodeId: targetNode.id,
            nodeLabel: targetNode.data.label,
            nodeType: targetNode.data.nodeType,
            relationshipType: edge.label as string,
          });
        }
      }
    });

    return { incoming, outgoing };
  }, [allNodes, allEdges]);

  // Show progress during build
  if (isBuilding) {
    return (
      <KnowledgeGraphProgress
        paperId={paperId}
        onComplete={handleBuildComplete}
        onError={handleBuildError}
      />
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3 p-4">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm">Loading knowledge graph...</span>
      </div>
    );
  }

  // Error state - graph not built yet
  if (error === 'not_built') {
    return (
      <EmptyState
        icon={Network}
        title="Knowledge graph not built yet"
        description='Use the "Build Graph" button to extract concepts and relationships from this paper.'
        variant="sidebar"
      />
    );
  }

  // Error state - other errors
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-500 gap-3 p-4">
        <AlertCircle size={24} />
        <span className="text-sm">Error: {error}</span>
      </div>
    );
  }

  // Empty state
  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No entities extracted"
        variant="sidebar"
      />
    );
  }

  // Get node type color for search results
  const getNodeTypeColor = (nodeType: string) => {
    switch (nodeType) {
      case 'symbol': return 'bg-blue-100 text-blue-700';
      case 'definition': return 'bg-emerald-100 text-emerald-700';
      case 'theorem': return 'bg-violet-100 text-violet-700';
      case 'formula': return 'bg-amber-100 text-amber-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="w-full h-full">
      {/* Search and stats bar */}
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-4">
        {/* Search bar */}
        <div ref={searchContainerRef} className="relative flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery && setShowSearchResults(true)}
              placeholder="Search entities..."
              className="w-48 pl-7 pr-7 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setShowSearchResults(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Search results dropdown */}
          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-md shadow-lg border border-slate-200 z-50 max-h-64 overflow-y-auto">
              {searchResults.map((node) => (
                <button
                  key={node.id}
                  onClick={() => selectSearchResult(node)}
                  className="w-full px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${getNodeTypeColor(node.data.nodeType)}`}>
                      {node.data.nodeType}
                    </span>
                    <span className="text-sm font-medium text-slate-800 truncate">
                      {node.data.label}
                    </span>
                  </div>
                  {node.data.context && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {node.data.context}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* No results message */}
          {showSearchResults && searchQuery && searchResults.length === 0 && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-md shadow-lg border border-slate-200 z-50 p-3">
              <p className="text-xs text-slate-500 text-center">No entities found</p>
            </div>
          )}
        </div>

        {/* Filter menu */}
        <div ref={filterMenuRef} className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded border transition-colors ${
              hasActiveFilters
                ? 'bg-amber-100 text-amber-700 border-amber-300'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
            title="Filter visible nodes and relationships"
          >
            <Filter size={12} />
            Filter
            <ChevronDown size={10} className={`transition-transform ${showFilterMenu ? 'rotate-180' : ''}`} />
          </button>

          {showFilterMenu && (
            <div className="absolute top-full right-0 mt-1 w-56 bg-white rounded-md shadow-lg border border-slate-200 z-50 py-2">
              {/* Node types */}
              <div className="px-3 py-1">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Node Types</div>
                {[
                  { type: 'formula', label: 'Formulas', color: 'bg-amber-500' },
                  { type: 'symbol', label: 'Symbols', color: 'bg-blue-500' },
                  { type: 'definition', label: 'Definitions', color: 'bg-emerald-500' },
                  { type: 'theorem', label: 'Theorems', color: 'bg-violet-500' },
                ].map(({ type, label, color }) => (
                  <label key={type} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-slate-50 -mx-3 px-3">
                    <input
                      type="checkbox"
                      checked={visibleNodeTypes.has(type)}
                      onChange={() => toggleNodeType(type)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className={`w-2 h-2 rounded-full ${color}`} />
                    <span className="text-xs text-slate-700">{label}</span>
                  </label>
                ))}
              </div>

              <div className="border-t border-slate-100 my-1" />

              {/* Edge types */}
              <div className="px-3 py-1">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Relationship Types</div>
                {[
                  { type: 'has_symbol', label: 'Has symbol', color: 'bg-amber-500' },
                  { type: 'uses', label: 'Uses', color: 'bg-indigo-500' },
                  { type: 'depends_on', label: 'Depends on', color: 'bg-amber-500' },
                  { type: 'defines', label: 'Defines', color: 'bg-emerald-500' },
                  { type: 'extends', label: 'Extends', color: 'bg-violet-500' },
                  { type: 'mentions', label: 'Mentions', color: 'bg-slate-400' },
                ].map(({ type, label, color }) => (
                  <label key={type} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-slate-50 -mx-3 px-3">
                    <input
                      type="checkbox"
                      checked={visibleEdgeTypes.has(type)}
                      onChange={() => toggleEdgeType(type)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className={`w-2 h-2 rounded-full ${color}`} />
                    <span className="text-xs text-slate-700">{label}</span>
                  </label>
                ))}
              </div>

              {hasActiveFilters && (
                <>
                  <div className="border-t border-slate-100 my-1" />
                  <div className="px-3 py-1">
                    <button
                      onClick={() => {
                        setVisibleNodeTypes(new Set(defaultNodeTypes));
                        setVisibleEdgeTypes(new Set(defaultEdgeTypes));
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      Reset filters
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        {graphData?.metadata && (
          <div className="text-xs text-slate-500 ml-auto" title="Formulas / Symbols / Definitions / Theorems / Relationships">
            {(graphData.metadata.formula_count ?? graphData.metadata.entity_counts?.formula ?? 0)}F · {graphData.metadata.symbol_count}S · {graphData.metadata.definition_count}D · {graphData.metadata.theorem_count}T · {graphData.metadata.edge_count}R
          </div>
        )}
      </div>

      {/* Graph */}
      <div className="w-full relative" style={{ height: 'calc(100% - 36px)' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background color="#e2e8f0" gap={16} />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              switch (node.data?.nodeType) {
                case 'symbol': return '#3b82f6';
                case 'definition': return '#10b981';
                case 'theorem': return '#8b5cf6';
                case 'formula': return '#f59e0b';
                default: return '#94a3b8';
              }
            }}
            maskColor="rgba(255, 255, 255, 0.8)"
          />
        </ReactFlow>

        {/* Focus mode indicator - top left overlay */}
        {focusMode && (
          <div className="absolute top-4 left-4 z-10">
            {focusedNodeId ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-white rounded-lg shadow-md border border-indigo-200">
                <Focus size={12} className="text-indigo-500" />
                <span className="text-slate-600">Focusing on:</span>
                <button
                  onClick={() => showNodeById(focusedNodeId, true)}
                  className="font-medium text-indigo-700 hover:text-indigo-900 hover:underline max-w-[150px] truncate"
                  title={allNodes.find(n => n.id === focusedNodeId)?.data.label}
                >
                  {allNodes.find(n => n.id === focusedNodeId)?.data.label}
                </button>
                <button
                  onClick={() => {
                    setFocusMode(false);
                    setFocusedNodeId(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 ml-0.5"
                  title="Exit focus mode"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-white rounded-lg shadow-md border border-amber-200">
                <Focus size={12} className="text-amber-500" />
                <span className="text-amber-700 italic">Select a node to focus</span>
                <button
                  onClick={() => setFocusMode(false)}
                  className="text-amber-400 hover:text-amber-600 ml-0.5"
                  title="Exit focus mode"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Node info panel */}
        {selectedNode && (() => {
          const connections = getNodeConnections(selectedNode.id);
          return (
            <NodeInfoPanel
              label={selectedNode.label}
              nodeType={selectedNode.nodeType}
              context={selectedNode.context}
              definition={selectedNode.definition}
              statement={selectedNode.statement}
              summary={selectedNode.summary}
              latex={selectedNode.latex}
              onNavigate={() => {
                selectedNode.onNavigate();
                setSelectedNode(null);
              }}
              onClose={() => setSelectedNode(null)}
              onFocus={() => {
                setFocusMode(true);
                setFocusedNodeId(selectedNode.id);
              }}
              isFocused={focusMode && focusedNodeId === selectedNode.id}
              incomingConnections={connections.incoming}
              outgoingConnections={connections.outgoing}
              onConnectionClick={(nodeId) => showNodeById(nodeId, true)}
            />
          );
        })()}

        {/* Edge info panel */}
        {selectedEdge && (
          <EdgeInfoPanel
            sourceLabel={selectedEdge.sourceLabel}
            targetLabel={selectedEdge.targetLabel}
            relationshipType={selectedEdge.type}
            evidence={selectedEdge.evidence}
            onClickSource={() => showNodeById(selectedEdge.sourceId)}
            onClickTarget={() => showNodeById(selectedEdge.targetId)}
            onClose={() => setSelectedEdge(null)}
          />
        )}
      </div>
    </div>
  );
}

// Wrapper component that provides ReactFlow context
export function KnowledgeGraphView(props: KnowledgeGraphViewProps) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
