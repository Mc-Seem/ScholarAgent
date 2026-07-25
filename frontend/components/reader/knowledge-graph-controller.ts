export type KnowledgeGraphLifecycleStatus = 'loading' | 'building' | 'ready' | 'empty' | 'error';

export interface KnowledgeGraphSearchItem {
  id: string;
  label: string;
  nodeType: string;
  detail?: string;
  sectionId?: string;
}

export interface KnowledgeGraphSourceFocus {
  section?: string;
  domNodeId?: string;
  equationId?: string;
}

export interface KnowledgeGraphFilterOption {
  type: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface KnowledgeGraphControllerNodeSelection {
  id: string;
  label: string;
  nodeType: string;
  domNodeId?: string;
}

export interface KnowledgeGraphControllerSnapshot {
  status: KnowledgeGraphLifecycleStatus;
  searchItems: readonly KnowledgeGraphSearchItem[];
  nodeTypeFilters: readonly KnowledgeGraphFilterOption[];
  edgeTypeFilters: readonly KnowledgeGraphFilterOption[];
  visibleNodeCount: number;
  totalNodeCount: number;
  visibleEdgeCount: number;
  totalEdgeCount: number;
  selectedNode: KnowledgeGraphControllerNodeSelection | null;
  focusMode: boolean;
  focusedNodeId: string | null;
  canFocusSelection: boolean;
  canRevealSelectionInPaper: boolean;
}

export interface KnowledgeGraphController {
  getSnapshot(): KnowledgeGraphControllerSnapshot;
  subscribe(listener: () => void): () => void;
  revealNode(nodeId: string): void;
  setVisibleTypes(nodeTypes: readonly string[], edgeTypes: readonly string[]): void;
  focusSelection(): void;
  clearFocus(): void;
  resetLayout(): void;
  revealSelectionInPaper(): void;
  expandNode(nodeId: string): Promise<void>;
  focusSource(source: KnowledgeGraphSourceFocus): Promise<void>;
  search(query: string): Promise<readonly KnowledgeGraphSearchItem[]>;
}