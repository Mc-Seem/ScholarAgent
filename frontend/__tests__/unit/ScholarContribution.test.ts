import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Command, CommandHandler } from '@theia/core'
import type { CommonMenus, ViewContainer as TheiaViewContainer } from '@theia/core/lib/browser'
import type { Paper, PaperDetail } from '@/hooks/usePapers'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import type {
  KnowledgeGraphController,
  KnowledgeGraphControllerSnapshot,
} from '@/components/reader/knowledge-graph-controller'
import type {
  PaperSearchController,
  PaperSearchControllerSnapshot,
} from '@/components/reader/paper-search-controller'
import type { ScholarCommands as ScholarCommandsNamespace } from '@/theia/scholar-extension/src/browser/scholar-commands'
import type { ScholarContribution as ScholarContributionClass } from '@/theia/scholar-extension/src/browser/scholar-contribution'
import type { ScholarPaperWidget as ScholarPaperWidgetClass } from '@/theia/scholar-extension/src/browser/scholar-paper-widget'
import type { ScholarPaperGraphWidget as ScholarPaperGraphWidgetClass } from '@/theia/scholar-extension/src/browser/scholar-paper-graph-widget'
import type {
  ScholarLibraryTreeNode,
  ScholarLibraryWidget as ScholarLibraryWidgetClass,
} from '@/theia/scholar-extension/src/browser/scholar-side-widgets'
import type { ScholarAnnotationService as ScholarAnnotationServiceClass } from '@/theia/scholar-extension/src/browser/scholar-annotation-service'
import type { ScholarLlmSettingsWidget as ScholarLlmSettingsWidgetClass } from '@/theia/scholar-extension/src/browser/scholar-llm-settings-widget'

const confirmDialogOpen = vi.fn<() => Promise<boolean>>()
const singleTextInputDialogOpen = vi.fn<() => Promise<string | undefined>>()

vi.mock('@theia/core/lib/browser', async () => {
  const actual = await vi.importActual<typeof import('@theia/core/lib/browser')>(
    '@theia/core/lib/browser',
  )
  return {
    ...actual,
    ConfirmDialog: vi.fn().mockImplementation(function ConfirmDialog() {
      return { open: confirmDialogOpen }
    }),
    SingleTextInputDialog: vi.fn().mockImplementation(function SingleTextInputDialog() {
      return { open: singleTextInputDialogOpen }
    }),
  }
})

vi.mock('@/theia/scholar-extension/src/browser/scholar-arxiv-import-dialog', () => ({
  ScholarArxivImportDialog: vi.fn().mockImplementation(function ScholarArxivImportDialog() {
    return { open: singleTextInputDialogOpen }
  }),
}))

let CommonMenusNs: typeof CommonMenus
let ScholarCommands: typeof ScholarCommandsNamespace
let ScholarContribution: typeof ScholarContributionClass
let ScholarAnnotationService: typeof ScholarAnnotationServiceClass
let ScholarPaperWidget: typeof ScholarPaperWidgetClass
let ScholarPaperGraphWidget: typeof ScholarPaperGraphWidgetClass
let ScholarLibraryWidget: typeof ScholarLibraryWidgetClass
let ScholarLlmSettingsWidget: typeof ScholarLlmSettingsWidgetClass
let ViewContainerCtor: typeof import('@theia/core/lib/browser').ViewContainer
let SCHOLAR_LIBRARY_CONTEXT_MENU: string[]
let SCHOLAR_ANNOTATIONS_WIDGET_ID: string
let SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID: string
let SCHOLAR_PAPER_FACTORY_ID: string
let SCHOLAR_PAPER_GRAPH_FACTORY_ID: string
let SCHOLAR_LLM_SETTINGS_WIDGET_ID: string
let SCHOLAR_SUGGESTIONS_WIDGET_ID: string
let SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID: string
let SCHOLAR_PAPER_FIND_TOOLBAR_ID: string
let SCHOLAR_SEMANTIC_LENS_WIDGET_ID: string
let SCHOLAR_CHAT_WIDGET_ID: string
let ScholarGraphSelectionNs: typeof import(
  '@/theia/scholar-extension/src/browser/scholar-graph-selection'
).ScholarGraphSelection
let SCHOLAR_GRAPH_SELECTION_KIND: string

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ CommonMenus: CommonMenusNs, ViewContainer: ViewContainerCtor } = await import(
    '@theia/core/lib/browser'
  ))
  ;({ ScholarCommands } = await import(
    '@/theia/scholar-extension/src/browser/scholar-commands'
  ))
  ;({ ScholarContribution } = await import(
    '@/theia/scholar-extension/src/browser/scholar-contribution'
  ))
  ;({ ScholarAnnotationService } = await import(
    '@/theia/scholar-extension/src/browser/scholar-annotation-service'
  ))
  ;({ ScholarPaperWidget, SCHOLAR_PAPER_FACTORY_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-paper-widget'
  ))
  ;({ SCHOLAR_PAPER_FIND_TOOLBAR_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-paper-find-toolbar'
  ))
  ;({ ScholarLlmSettingsWidget, SCHOLAR_LLM_SETTINGS_WIDGET_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-llm-settings-widget'
  ))
  ;({
    ScholarLibraryWidget,
    SCHOLAR_LIBRARY_CONTEXT_MENU,
    SCHOLAR_ANNOTATIONS_WIDGET_ID,
    SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID,
  } = await import(
    '@/theia/scholar-extension/src/browser/scholar-side-widgets'
  ))
  ;({
    SCHOLAR_SUGGESTIONS_WIDGET_ID,
    SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID,
  } = await import(
    '@/theia/scholar-extension/src/browser/scholar-suggestion-widgets'
  ))
  ;({ ScholarPaperGraphWidget, SCHOLAR_PAPER_GRAPH_FACTORY_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-paper-graph-widget'
  ))
  ;({ SCHOLAR_SEMANTIC_LENS_WIDGET_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-semantic-lens-widget'
  ))
  ;({ SCHOLAR_CHAT_WIDGET_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-chat-widget'
  ))
  ;({
    ScholarGraphSelection: ScholarGraphSelectionNs,
    SCHOLAR_GRAPH_SELECTION_KIND,
  } = await import(
    '@/theia/scholar-extension/src/browser/scholar-graph-selection'
  ))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

class FakeCommandRegistry {
  readonly handlers = new Map<string, CommandHandler>()

  registerCommand(command: Command, handler: CommandHandler): { dispose(): void } {
    this.handlers.set(command.id, handler)
    return { dispose: () => this.handlers.delete(command.id) }
  }

  handlerFor(command: Command): CommandHandler {
    const handler = this.handlers.get(command.id)
    if (!handler) {
      throw new Error(`No handler registered for ${command.id}`)
    }
    return handler
  }
}

interface FakeToolbarItem {
  id: string
  command?: string
  group?: string
  priority?: number
  isVisible?: (widget?: unknown) => boolean
  render?: (widget?: unknown) => unknown
  onDidChange?: (listener: () => void) => { dispose(): void }
}

class FakeToolbarRegistry {
  readonly items: FakeToolbarItem[] = []

  registerItem(item: FakeToolbarItem): { dispose(): void } {
    this.items.push(item)
    return { dispose: () => undefined }
  }
}

function emptySnapshot(): ReaderWorkspaceSnapshot {
  return {
    papers: [],
    libraryLoading: false,
    libraryError: null,
    activePaperId: null,
    openPaperIds: [],
    loadingPaperIds: [],
    papersById: {},
    tooltipsByPaperId: {},
    activeEntityByPaperId: {},
    paperErrors: {},
    statusByPaperId: {},
    knowledgeGraphProgressByPaperId: {},
  }
}

function paperDetail(id: string, overrides: Partial<PaperDetail> = {}): PaperDetail {
  return {
    id,
    filename: `${id}.tar.gz`,
    arxiv_id: null,
    uploaded_at: '2026-07-15T00:00:00Z',
    compiled_at: '2026-07-15T00:01:00Z',
    has_html: true,
    html_content: `<article>${id}</article>`,
    sections: [],
    equations: [],
    citations: [],
    paper_metadata: { title: id },
    has_knowledge_graph: false,
    ...overrides,
  }
}

function createFakeStore(snapshot: ReaderWorkspaceSnapshot) {
  return {
    snapshot,
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn(() => () => undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    compilePaper: vi.fn().mockResolvedValue(undefined),
    buildKnowledgeGraph: vi.fn().mockResolvedValue(undefined),
    cancelKnowledgeGraph: vi.fn().mockResolvedValue(undefined),
    reanchorOccurrences: vi.fn().mockResolvedValue({
      status: 'reanchored',
      occurrence_count: 312,
      previous_occurrence_count: 199,
    }),
    deletePaper: vi.fn().mockResolvedValue(undefined),
    uploadPaper: vi.fn(),
    uploadArxiv: vi.fn(),
    activatePaper: vi.fn(),
    loadLibrary: vi.fn().mockResolvedValue([]),
  }
}

type FakePaperWidget = ScholarPaperWidgetClass & {
  searchSnapshot: PaperSearchControllerSnapshot
  searchListeners: Set<() => void>
  openSearch: ReturnType<typeof vi.fn>
  closeSearch: ReturnType<typeof vi.fn>
}

function createFakePaperWidget(paperId: string, isAttached = true): FakePaperWidget {
  const widget = Object.create(ScholarPaperWidget.prototype) as ScholarPaperWidgetClass
  const searchSnapshot: PaperSearchControllerSnapshot = {
    isOpen: false,
    query: '',
    currentMatchIndex: 0,
    totalMatches: 0,
    focusRequestId: 0,
  }
  const searchListeners = new Set<() => void>()
  const publishSearch = (): void => {
    for (const listener of searchListeners) {
      listener()
    }
  }
  const searchController: PaperSearchController = {
    getSnapshot: () => searchSnapshot,
    subscribe: listener => {
      searchListeners.add(listener)
      return () => searchListeners.delete(listener)
    },
    open: vi.fn(),
    close: vi.fn(),
    setQuery: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    refresh: vi.fn(),
    dispose: vi.fn(),
  }
  Object.defineProperty(widget, 'options', {
    value: { paperId, label: paperId },
    configurable: true,
  })
  Object.defineProperty(widget, 'id', {
    value: `scholar-agent:paper:${paperId}`,
    configurable: true,
  })
  Object.defineProperty(widget, 'isAttached', {
    value: isAttached,
    configurable: true,
  })
  Object.defineProperty(widget, 'close', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperties(widget, {
    searchSnapshot: { value: searchSnapshot },
    searchListeners: { value: searchListeners },
    getSearchSnapshot: { value: vi.fn(() => searchSnapshot) },
    getSearchController: { value: vi.fn(() => searchController) },
    onDidChangeSearchState: {
      value: vi.fn((listener: () => void) => {
        searchListeners.add(listener)
        return { dispose: () => searchListeners.delete(listener) }
      }),
    },
    openSearch: {
      value: vi.fn(() => {
        searchSnapshot.isOpen = true
        searchSnapshot.focusRequestId += 1
        publishSearch()
      }),
    },
    closeSearch: {
      value: vi.fn(() => {
        searchSnapshot.isOpen = false
        publishSearch()
      }),
    },
  })
  return widget as FakePaperWidget
}

function graphSnapshot(
  overrides: Partial<KnowledgeGraphControllerSnapshot> = {},
): KnowledgeGraphControllerSnapshot {
  return {
    status: 'ready',
    searchItems: [
      { id: 'node-1', label: 'Theorem One', nodeType: 'theorem', detail: 'Main result' },
      { id: 'node-2', label: 'Definition Two', nodeType: 'definition', detail: 'Supporting concept' },
    ],
    nodeTypeFilters: [
      { type: 'theorem', label: 'Theorems', count: 1, selected: true },
      { type: 'definition', label: 'Definitions', count: 1, selected: false },
    ],
    edgeTypeFilters: [
      { type: 'depends_on', label: 'Depends on', count: 2, selected: true },
      { type: 'uses', label: 'Uses', count: 1, selected: false },
    ],
    visibleNodeCount: 1,
    totalNodeCount: 2,
    visibleEdgeCount: 2,
    totalEdgeCount: 3,
    selectedNode: null,
    focusMode: false,
    focusedNodeId: null,
    canFocusSelection: false,
    canRevealSelectionInPaper: false,
    ...overrides,
  }
}

const graphStateListeners = new WeakMap<ScholarPaperGraphWidgetClass, Set<() => void>>()

function emitGraphStateChange(widget: ScholarPaperGraphWidgetClass): void {
  graphStateListeners.get(widget)?.forEach(listener => listener())
}

function createFakeGraphWidget(
  paperId: string,
  isAttached = true,
  snapshot = graphSnapshot(),
): ScholarPaperGraphWidgetClass {
  const widget = Object.create(ScholarPaperGraphWidget.prototype) as ScholarPaperGraphWidgetClass
  const stateListeners = new Set<() => void>()
  graphStateListeners.set(widget, stateListeners)
  const controller: KnowledgeGraphController = {
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn(() => () => undefined),
    revealNode: vi.fn(),
    setVisibleTypes: vi.fn(),
    focusSelection: vi.fn(),
    clearFocus: vi.fn(),
    resetLayout: vi.fn(),
    revealSelectionInPaper: vi.fn(),
    expandNode: vi.fn().mockResolvedValue(undefined),
    focusSource: vi.fn().mockResolvedValue(undefined),
    search: vi.fn(async () => snapshot.searchItems),
  }
  Object.defineProperty(widget, 'options', {
    value: { paperId },
    configurable: true,
  })
  Object.defineProperty(widget, 'id', {
    value: `scholar-agent:paper-graph:${paperId}`,
    configurable: true,
  })
  Object.defineProperty(widget, 'isAttached', {
    value: isAttached,
    configurable: true,
  })
  Object.defineProperty(widget, 'close', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperty(widget, 'updateLabel', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperties(widget, {
    getGraphController: { value: vi.fn(() => controller), configurable: true },
    getGraphSnapshot: { value: vi.fn(() => snapshot), configurable: true },
    revealNode: { value: vi.fn(), configurable: true },
    setVisibleTypes: { value: vi.fn(), configurable: true },
    focusSelection: { value: vi.fn(), configurable: true },
    clearFocus: { value: vi.fn(), configurable: true },
    resetLayout: { value: vi.fn(), configurable: true },
    revealSelectionInPaper: { value: vi.fn(), configurable: true },
    onDidChangeGraphState: {
      value: (listener: () => void) => {
        stateListeners.add(listener)
        return { dispose: () => stateListeners.delete(listener) }
      },
      configurable: true,
    },
  })
  return widget
}

interface FakeQuickPickItem {
  type?: 'item' | 'separator'
  id?: string
  label?: string
  description?: string
  detail?: string
  filterKind?: 'node' | 'edge'
  filterType?: string
}

function createFakeQuickPick() {
  const acceptListeners = new Set<() => void>()
  const hideListeners = new Set<() => void>()
  let hidden = false
  const picker = {
    title: undefined as string | undefined,
    placeholder: undefined as string | undefined,
    items: [] as FakeQuickPickItem[],
    selectedItems: [] as FakeQuickPickItem[],
    canSelectMany: false,
    matchOnDescription: false,
    matchOnDetail: false,
    show: vi.fn(),
    hide: vi.fn(() => {
      if (hidden) return
      hidden = true
      hideListeners.forEach(listener => listener())
    }),
    dispose: vi.fn(),
    onDidAccept: vi.fn((listener: () => void) => {
      acceptListeners.add(listener)
      return { dispose: () => acceptListeners.delete(listener) }
    }),
    onDidHide: vi.fn((listener: () => void) => {
      hideListeners.add(listener)
      return { dispose: () => hideListeners.delete(listener) }
    }),
    accept: () => acceptListeners.forEach(listener => listener()),
    cancel: () => picker.hide(),
  }
  return picker
}

function createForeignWidget(): ScholarLibraryWidgetClass {
  return Object.create(ScholarLibraryWidget.prototype) as ScholarLibraryWidgetClass
}

function createFakeLlmSettingsWidget(isAttached = true): ScholarLlmSettingsWidgetClass {
  const widget = Object.create(ScholarLlmSettingsWidget.prototype) as ScholarLlmSettingsWidgetClass
  Object.defineProperties(widget, {
    id: { value: SCHOLAR_LLM_SETTINGS_WIDGET_ID, configurable: true },
    isAttached: { value: isAttached, configurable: true },
  })
  return widget
}

function createFakeViewContainer(
  id: string,
  widgets: Array<{ id: string }>,
): TheiaViewContainer {
  const container = Object.create(ViewContainerCtor.prototype) as TheiaViewContainer
  const createPart = (wrapped: { id: string }) => ({
    wrapped,
    options: undefined,
    originalContainerId: id,
    originalContainerTitle: undefined,
    collapsed: false,
    isHidden: false,
    setHidden: vi.fn(),
  })
  const parts = widgets.map(createPart)
  Object.defineProperties(container, {
    id: { value: id, configurable: true },
    isAttached: { value: false, configurable: true },
    getParts: { value: vi.fn(() => parts), configurable: true },
    getPartFor: {
      value: vi.fn((widget: { id: string }) => parts.find(part => part.wrapped.id === widget.id)),
      configurable: true,
    },
    removeWidget: {
      value: vi.fn((widget: { id: string }) => {
        const index = parts.findIndex(part => part.wrapped.id === widget.id)
        if (index === -1) {
          return false
        }
        parts.splice(index, 1)
        return true
      }),
      configurable: true,
    },
    addWidget: {
      value: vi.fn((widget: { id: string }) => {
        parts.push(createPart(widget))
        return { dispose: () => undefined }
      }),
      configurable: true,
    },
    revealWidget: {
      value: vi.fn((widgetId: string) => parts.find(part => part.wrapped.id === widgetId)),
      configurable: true,
    },
  })
  return container
}

function createLibraryNode(paperId: string): ScholarLibraryTreeNode {
  return {
    id: `paper:${paperId}`,
    paperId,
    parent: undefined,
    selected: false,
  }
}

function createContribution(store: ReturnType<typeof createFakeStore>) {
  const widgetManager = {
    getOrCreateWidget: vi.fn(),
    getWidgets: vi.fn(() => [] as unknown[]),
    tryGetWidget: vi.fn(),
  }
  let currentWidgetListener: ((event: { newValue: unknown }) => void) | undefined
  const shell: {
    activeWidget: unknown
    onDidChangeCurrentWidget: ReturnType<typeof vi.fn>
    addWidget: ReturnType<typeof vi.fn>
    activateWidget: ReturnType<typeof vi.fn>
    revealWidget: ReturnType<typeof vi.fn>
    getCurrentWidget: ReturnType<typeof vi.fn>
    getAreaFor: ReturnType<typeof vi.fn>
  } = {
    activeWidget: undefined,
    onDidChangeCurrentWidget: vi.fn((listener: (event: { newValue: unknown }) => void) => {
      currentWidgetListener = listener
      return {
        dispose: () => {
          if (currentWidgetListener === listener) {
            currentWidgetListener = undefined
          }
        },
      }
    }),
    addWidget: vi.fn().mockResolvedValue(undefined),
    activateWidget: vi.fn().mockResolvedValue(undefined),
    revealWidget: vi.fn().mockResolvedValue(undefined),
    getCurrentWidget: vi.fn(() => undefined),
    getAreaFor: vi.fn(() => undefined),
  }
  const statusBar = {
    setElement: vi.fn().mockResolvedValue(undefined),
    removeElement: vi.fn().mockResolvedValue(undefined),
  }
  const messageService = {
    error: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
  }
  const quickInputService = {
    pick: vi.fn(),
    createQuickPick: vi.fn(),
    input: vi.fn().mockResolvedValue(''),
  }
  const annotations = new ScholarAnnotationService()
  const readingSets = {
    getSnapshot: vi.fn(() => ({ readingSets: [], loading: false, error: null, alignmentBuilds: {} })),
    subscribe: vi.fn(() => () => undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    readingSetOf: vi.fn(() => undefined),
    createReadingSet: vi.fn(),
    renameReadingSet: vi.fn(),
    deleteReadingSet: vi.fn().mockResolvedValue(undefined),
    addPaperToReadingSet: vi.fn(),
    removePaperFromReadingSet: vi.fn(),
    isLinkingTerms: vi.fn(() => false),
    linkTerms: vi.fn(),
    cancelLinkTerms: vi.fn().mockResolvedValue(undefined),
  }
  const suggestions = {
    getSnapshot: vi.fn(() => ({ activePaperId: null, papers: {} })),
    getPaperState: vi.fn(() => ({
      suggestions: [],
      checkedIds: new Set<string>(),
      focusedId: null,
      pending: false,
      createMode: false,
    })),
    onDidChange: vi.fn(() => ({ dispose: () => undefined })),
  }
  const llmSnapshot = {
    dirty: false,
    saving: false,
    models: { status: 'idle' },
    testByWorkflow: {
      kg_extraction: { status: 'idle' },
      html_injection: { status: 'idle' },
      tooltip_suggestion: { status: 'idle' },
    },
    validation: {
      canSave: true,
      canListModels: true,
      canTest: {
        kg_extraction: true,
        html_injection: true,
        tooltip_suggestion: true,
      },
    },
  }
  const llmSettings = {
    getSnapshot: vi.fn(() => llmSnapshot),
    onDidChange: vi.fn(() => ({ dispose: () => undefined })),
    save: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
    listModels: vi.fn().mockResolvedValue(undefined),
    testWorkflow: vi.fn().mockResolvedValue(undefined),
  }
  let selectionListener: ((selection: unknown) => void) | undefined
  const selectionService = {
    selection: undefined as unknown,
    onSelectionChanged: vi.fn((listener: (selection: unknown) => void) => {
      selectionListener = listener
      return {
        dispose: () => {
          if (selectionListener === listener) {
            selectionListener = undefined
          }
        },
      }
    }),
  }

  const chat = {
    activateReadingSet: vi.fn().mockResolvedValue(undefined),
    closeReadingSetChat: vi.fn().mockResolvedValue(undefined),
  }

  const ContributionCtor = ScholarContribution as unknown as new (
    ...args: unknown[]
  ) => ScholarContributionClass
  const contribution = new ContributionCtor(
    store,
    annotations,
    readingSets,
    suggestions,
    llmSettings,
    widgetManager,
    shell,
    statusBar,
    messageService,
    quickInputService,
    selectionService,
    chat,
  )

  return {
    contribution,
    widgetManager,
    shell,
    statusBar,
    messageService,
    quickInputService,
    readingSets,
    chat,
    fireCurrentWidgetChanged: () => currentWidgetListener?.({ newValue: shell.activeWidget }),
    publishSelection: (selection: unknown) => {
      selectionService.selection = selection
      selectionListener?.(selection)
    },
    llmSettings,
    llmSnapshot,
  }
}

describe('ScholarContribution Semantic Lens placement', () => {
  function equationSelection() {
    return ScholarGraphSelectionNs.create(
      'paper-a',
      {
        kind: SCHOLAR_GRAPH_SELECTION_KIND,
        paperId: 'paper-a',
        owner: {},
      } as Parameters<typeof ScholarGraphSelectionNs.create>[1],
      { kind: 'equation', equationId: 'eq-7' },
    )
  }

  it('docks the lens in the right side bar ahead of the authoring views', async () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const widgets = new Map<string, { id: string }>()
    context.widgetManager.getOrCreateWidget.mockImplementation(async (widgetId: string) => {
      const widget = widgets.get(widgetId) ?? { id: widgetId }
      widgets.set(widgetId, widget)
      return widget
    })

    await (context.contribution as unknown as {
      initializeLayout(app: unknown): Promise<void>
    }).initializeLayout({ shell: context.shell })

    expect(context.shell.addWidget).toHaveBeenCalledWith(
      widgets.get(SCHOLAR_SEMANTIC_LENS_WIDGET_ID),
      { area: 'right', rank: 90 },
    )
    const lensCall = context.shell.addWidget.mock.calls.findIndex(
      call => (call[0] as { id: string }).id === SCHOLAR_SEMANTIC_LENS_WIDGET_ID,
    )
    const annotationsCall = context.shell.addWidget.mock.calls.findIndex(
      call => (call[0] as { id: string }).id === SCHOLAR_ANNOTATIONS_WIDGET_ID,
    )
    expect(lensCall).toBeLessThan(annotationsCall)
    expect(context.shell.activateWidget).toHaveBeenCalledWith(SCHOLAR_CHAT_WIDGET_ID)
  })

  it('reveals the lens on a semantic selection without stealing focus from the paper', async () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const lens = { id: SCHOLAR_SEMANTIC_LENS_WIDGET_ID, isAttached: false }
    context.widgetManager.getOrCreateWidget.mockResolvedValue(lens)
    context.contribution.onStart()

    context.publishSelection(equationSelection())
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(context.shell.addWidget).toHaveBeenCalledWith(lens, { area: 'right', rank: 90 })
    expect(context.shell.revealWidget).toHaveBeenCalledWith(SCHOLAR_SEMANTIC_LENS_WIDGET_ID)
    expect(context.shell.activateWidget).not.toHaveBeenCalled()
  })

  it('ignores selections that are not semantic and never docks the lens twice', async () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const lens = { id: SCHOLAR_SEMANTIC_LENS_WIDGET_ID, isAttached: false }
    context.widgetManager.getOrCreateWidget.mockImplementation(async () => {
      lens.isAttached = true
      return lens
    })
    context.contribution.onStart()

    context.publishSelection({ id: 'tree-node' })
    await Promise.resolve()
    expect(context.shell.revealWidget).not.toHaveBeenCalled()

    context.publishSelection(equationSelection())
    context.publishSelection(equationSelection())
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(context.shell.addWidget).not.toHaveBeenCalled()
    expect(context.shell.revealWidget).toHaveBeenCalledTimes(2)
  })

  it('exposes the lens through the View menu and a keybinding', () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const commands = new FakeCommandRegistry()
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])
    const menuActions: Array<{ menuPath: unknown, commandId: string }> = []
    context.contribution.registerMenus({
      registerMenuAction: (menuPath: unknown, action: { commandId: string }) => {
        menuActions.push({ menuPath, commandId: action.commandId })
        return { dispose: () => undefined }
      },
      registerSubmenu: () => ({ dispose: () => undefined }),
    } as unknown as Parameters<ScholarContributionClass['registerMenus']>[0])
    const bindings: Array<{ command: string, keybinding: string }> = []
    context.contribution.registerKeybindings({
      registerKeybinding: (binding: { command: string, keybinding: string }) => {
        bindings.push(binding)
        return { dispose: () => undefined }
      },
    } as unknown as Parameters<ScholarContributionClass['registerKeybindings']>[0])

    expect(commands.handlerFor(ScholarCommands.SHOW_SEMANTIC_LENS)).toBeDefined()
    expect(menuActions).toContainEqual({
      menuPath: CommonMenusNs.VIEW_VIEWS,
      commandId: ScholarCommands.SHOW_SEMANTIC_LENS.id,
    })
    expect(bindings).toContainEqual({
      command: ScholarCommands.SHOW_SEMANTIC_LENS.id,
      keybinding: 'alt+shift+l',
    })
  })
})

describe('ScholarContribution Term Highlights layout migration', () => {
  async function migrate(context: ReturnType<typeof createContribution>): Promise<void> {
    const contribution = context.contribution as unknown as {
      onDidInitializeLayout(app: unknown): Promise<void>
    }
    await contribution.onDidInitializeLayout({ shell: context.shell })
  }

  it('moves legacy suggestion parts into a dedicated right-side container after restore', async () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const comments = { id: 'scholar-agent:comments' }
    const suggestions = { id: SCHOLAR_SUGGESTIONS_WIDGET_ID }
    const suggestionEditor = { id: SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID }
    const annotations = createFakeViewContainer(SCHOLAR_ANNOTATIONS_WIDGET_ID, [
      comments,
      suggestions,
      suggestionEditor,
    ])
    const tooltipDrafts = createFakeViewContainer(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID, [
      suggestions,
      suggestionEditor,
    ])
    context.widgetManager.tryGetWidget.mockImplementation((widgetId: string) => {
      if (widgetId === SCHOLAR_ANNOTATIONS_WIDGET_ID) {
        return annotations
      }
      return undefined
    })
    context.widgetManager.getOrCreateWidget.mockResolvedValue(tooltipDrafts)

    await migrate(context)

    expect(annotations.getParts().map(part => part.wrapped.id)).toEqual([comments.id])
    expect(annotations.removeWidget).toHaveBeenCalledTimes(2)
    expect(context.shell.addWidget).toHaveBeenCalledWith(tooltipDrafts, {
      area: 'right',
      mode: 'tab-after',
      ref: annotations,
    })
    expect(tooltipDrafts.revealWidget).toHaveBeenCalledWith(SCHOLAR_SUGGESTIONS_WIDGET_ID)

    await migrate(context)
    expect(context.shell.addWidget).toHaveBeenCalledTimes(1)
    expect(annotations.removeWidget).toHaveBeenCalledTimes(2)
  })

  it('preserves user-moved parts when the dedicated container already belongs to the shell', async () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const suggestions = { id: SCHOLAR_SUGGESTIONS_WIDGET_ID }
    const annotations = createFakeViewContainer(SCHOLAR_ANNOTATIONS_WIDGET_ID, [suggestions])
    const tooltipDrafts = createFakeViewContainer(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID, [])
    context.widgetManager.tryGetWidget.mockImplementation((widgetId: string) => {
      if (widgetId === SCHOLAR_ANNOTATIONS_WIDGET_ID) {
        return annotations
      }
      if (widgetId === SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID) {
        return tooltipDrafts
      }
      return undefined
    })
    context.shell.getAreaFor.mockImplementation((widget: unknown) => (
      widget === tooltipDrafts ? 'right' : undefined
    ))

    await migrate(context)

    expect(annotations.removeWidget).not.toHaveBeenCalled()
    expect(context.widgetManager.getOrCreateWidget).not.toHaveBeenCalled()
    expect(context.shell.addWidget).not.toHaveBeenCalled()
  })

  it('leaves a clean layout unchanged when Annotations has no legacy suggestion parts', async () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const annotations = createFakeViewContainer(SCHOLAR_ANNOTATIONS_WIDGET_ID, [
      { id: 'scholar-agent:comments' },
    ])
    context.widgetManager.tryGetWidget.mockImplementation((widgetId: string) => (
      widgetId === SCHOLAR_ANNOTATIONS_WIDGET_ID ? annotations : undefined
    ))

    await migrate(context)

    expect(annotations.removeWidget).not.toHaveBeenCalled()
    expect(context.widgetManager.getOrCreateWidget).not.toHaveBeenCalled()
    expect(context.shell.addWidget).not.toHaveBeenCalled()
  })

  it('restores legacy parts and warns when the dedicated container cannot be created', async () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const suggestions = { id: SCHOLAR_SUGGESTIONS_WIDGET_ID }
    const suggestionEditor = { id: SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID }
    const annotations = createFakeViewContainer(SCHOLAR_ANNOTATIONS_WIDGET_ID, [
      suggestions,
      suggestionEditor,
    ])
    context.widgetManager.tryGetWidget.mockImplementation((widgetId: string) => (
      widgetId === SCHOLAR_ANNOTATIONS_WIDGET_ID ? annotations : undefined
    ))
    context.widgetManager.getOrCreateWidget.mockRejectedValue(new Error('factory failed'))

    await migrate(context)

    expect(annotations.getParts().map(part => part.wrapped.id)).toEqual([
      SCHOLAR_SUGGESTIONS_WIDGET_ID,
      SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID,
    ])
    expect(context.shell.addWidget).not.toHaveBeenCalled()
    expect(context.messageService.warn).toHaveBeenCalledWith(
      'Could not migrate the Term Highlights layout: factory failed',
    )
  })
})

describe('ScholarContribution LLM settings commands', () => {
  function register() {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const commands = new FakeCommandRegistry()
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])
    return { ...context, commands }
  }

  it('reuses and activates one central settings widget on repeated Open', async () => {
    const { commands, widgetManager, shell } = register()
    const widget = createFakeLlmSettingsWidget(false)
    widgetManager.getOrCreateWidget.mockResolvedValue(widget)

    await commands.handlerFor(ScholarCommands.OPEN_LLM_SETTINGS).execute()
    Object.defineProperty(widget, 'isAttached', { value: true, configurable: true })
    await commands.handlerFor(ScholarCommands.OPEN_LLM_SETTINGS).execute()

    expect(widgetManager.getOrCreateWidget).toHaveBeenCalledTimes(2)
    expect(widgetManager.getOrCreateWidget).toHaveBeenNthCalledWith(
      1,
      SCHOLAR_LLM_SETTINGS_WIDGET_ID,
    )
    expect(shell.addWidget).toHaveBeenCalledOnce()
    expect(shell.addWidget).toHaveBeenCalledWith(widget, { area: 'main' })
    expect(shell.activateWidget).toHaveBeenCalledTimes(2)
    expect(shell.activateWidget).toHaveBeenLastCalledWith(SCHOLAR_LLM_SETTINGS_WIDGET_ID)
  })

  it('scopes toolbar actions to the settings widget and honors dirty/pending state', () => {
    const { commands, llmSnapshot } = register()
    const settingsWidget = createFakeLlmSettingsWidget()
    const foreignWidget = createForeignWidget()
    const save = commands.handlerFor(ScholarCommands.SAVE_LLM_SETTINGS)
    const refresh = commands.handlerFor(ScholarCommands.REFRESH_LLM_MODELS)
    const testHtml = commands.handlerFor(ScholarCommands.TEST_LLM_HTML_INJECTION)

    expect(save.isVisible?.(undefined)).toBe(true)
    expect(save.isVisible?.(settingsWidget)).toBe(true)
    expect(save.isVisible?.(foreignWidget)).toBe(false)
    expect(save.isEnabled?.(settingsWidget)).toBe(false)

    llmSnapshot.dirty = true
    expect(save.isEnabled?.(settingsWidget)).toBe(true)
    llmSnapshot.validation.canSave = false
    expect(save.isEnabled?.(settingsWidget)).toBe(false)
    llmSnapshot.validation.canSave = true

    expect(refresh.isEnabled?.(settingsWidget)).toBe(true)
    llmSnapshot.models.status = 'loading'
    expect(refresh.isEnabled?.(settingsWidget)).toBe(false)
    llmSnapshot.models.status = 'idle'

    expect(testHtml.isEnabled?.(settingsWidget)).toBe(true)
    llmSnapshot.testByWorkflow.html_injection.status = 'pending'
    expect(testHtml.isEnabled?.(settingsWidget)).toBe(false)
    llmSnapshot.testByWorkflow.html_injection.status = 'idle'
    llmSnapshot.saving = true
    expect(save.isEnabled?.(settingsWidget)).toBe(false)
    expect(refresh.isEnabled?.(settingsWidget)).toBe(false)
    expect(testHtml.isEnabled?.(settingsWidget)).toBe(false)
  })

  it('executes Save, Revert, Refresh, and exactly targeted workflow tests without arguments', async () => {
    const { commands, llmSettings, messageService } = register()

    await commands.handlerFor(ScholarCommands.SAVE_LLM_SETTINGS).execute()
    await commands.handlerFor(ScholarCommands.REVERT_LLM_SETTINGS).execute()
    await commands.handlerFor(ScholarCommands.REFRESH_LLM_MODELS).execute()
    await commands.handlerFor(ScholarCommands.TEST_LLM_KG_EXTRACTION).execute()
    await commands.handlerFor(ScholarCommands.TEST_LLM_HTML_INJECTION).execute()
    await commands.handlerFor(ScholarCommands.TEST_LLM_TOOLTIP_SUGGESTION).execute()

    expect(llmSettings.save).toHaveBeenCalledOnce()
    expect(llmSettings.revert).toHaveBeenCalledOnce()
    expect(llmSettings.listModels).toHaveBeenCalledOnce()
    expect(llmSettings.testWorkflow.mock.calls.map(call => call[0])).toEqual([
      'kg_extraction',
      'html_injection',
      'tooltip_suggestion',
    ])
    expect(messageService.info).toHaveBeenCalledWith('LLM settings saved.')
  })

  it('reports action failures without exposing them as unhandled command errors', async () => {
    const { commands, llmSettings, messageService } = register()
    llmSettings.save.mockRejectedValueOnce(new Error('Save rejected'))

    await expect(commands.handlerFor(ScholarCommands.SAVE_LLM_SETTINGS).execute())
      .resolves.toBeUndefined()
    expect(messageService.error).toHaveBeenCalledWith(
      'Could not save LLM settings: Save rejected',
    )
  })
})

describe('ScholarContribution active-paper commands', () => {
  let snapshot: ReaderWorkspaceSnapshot
  let store: ReturnType<typeof createFakeStore>
  let commands: FakeCommandRegistry

  beforeEach(() => {
    confirmDialogOpen.mockReset()
    snapshot = emptySnapshot()
    store = createFakeStore(snapshot)
    commands = new FakeCommandRegistry()
  })

  function register(): ReturnType<typeof createContribution> {
    const context = createContribution(store)
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])
    return context
  }

  it('shows Compile, Build Graph, Delete and Open Graph for a paper widget or a library tree node', () => {
    register()
    const paperWidget = createFakePaperWidget('paper-a')
    const libraryNode = createLibraryNode('paper-a')
    const foreignWidget = createForeignWidget()

    for (const command of [
      ScholarCommands.COMPILE_PAPER,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH,
      ScholarCommands.DELETE_PAPER,
      ScholarCommands.OPEN_GRAPH,
    ]) {
      const handler = commands.handlerFor(command)
      expect(handler.isVisible?.(paperWidget)).toBe(true)
      expect(handler.isVisible?.(libraryNode)).toBe(true)
      expect(handler.isVisible?.(foreignWidget)).toBe(false)
      expect(handler.isVisible?.(undefined)).toBe(false)
    }
  })

  it('resolves the active paper widget when no argument is passed, e.g. from the command palette', async () => {
    const { shell } = register()
    const widget = createFakePaperWidget('paper-a')
    shell.activeWidget = widget

    for (const command of [
      ScholarCommands.COMPILE_PAPER,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH,
      ScholarCommands.DELETE_PAPER,
      ScholarCommands.OPEN_GRAPH,
    ]) {
      const handler = commands.handlerFor(command)
      expect(handler.isVisible?.(undefined)).toBe(true)
    }

    await commands.handlerFor(ScholarCommands.COMPILE_PAPER).execute(undefined)
    expect(store.compilePaper).toHaveBeenCalledWith('paper-a')
  })

  it('opens Find for the explicit paper target and refocuses the active paper from the palette', () => {
    const { shell } = register()
    const activeWidget = createFakePaperWidget('paper-a')
    const targetWidget = createFakePaperWidget('paper-b')
    const foreignWidget = createForeignWidget()
    shell.activeWidget = activeWidget
    const handler = commands.handlerFor(ScholarCommands.FIND_IN_PAPER)

    expect(handler.isVisible?.(activeWidget)).toBe(true)
    expect(handler.isVisible?.(foreignWidget)).toBe(false)
    expect(handler.isVisible?.(undefined)).toBe(true)

    handler.execute(targetWidget)
    expect(targetWidget.openSearch).toHaveBeenCalledOnce()
    expect(activeWidget.openSearch).not.toHaveBeenCalled()

    handler.execute(undefined)
    handler.execute(undefined)
    expect(activeWidget.openSearch).toHaveBeenCalledTimes(2)
    expect(activeWidget.searchSnapshot.focusRequestId).toBe(2)
  })

  it('binds Ctrl/Cmd+F to the native paper find command', () => {
    const { contribution } = createContribution(store)
    const bindings: Array<{ command: string; keybinding: string }> = []
    contribution.registerKeybindings({
      registerKeybinding: (binding: { command: string; keybinding: string }) => {
        bindings.push(binding)
        return { dispose: () => undefined }
      },
    } as unknown as Parameters<ScholarContributionClass['registerKeybindings']>[0])

    expect(bindings).toContainEqual({
      command: ScholarCommands.FIND_IN_PAPER.id,
      keybinding: 'ctrlcmd+f',
    })
  })

  it('does not fall back to the active paper without a widget for an inactive/missing paper', () => {
    register()

    for (const command of [
      ScholarCommands.COMPILE_PAPER,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH,
      ScholarCommands.DELETE_PAPER,
      ScholarCommands.OPEN_GRAPH,
    ]) {
      const handler = commands.handlerFor(command)
      expect(handler.isVisible?.(undefined)).toBe(false)
      expect(handler.isEnabled?.(undefined)).toBe(false)
    }
  })

  it('enables Compile only while the paper is not busy', () => {
    register()
    const widget = createFakePaperWidget('paper-a')
    const handler = commands.handlerFor(ScholarCommands.COMPILE_PAPER)

    expect(handler.isEnabled?.(widget)).toBe(true)

    snapshot.statusByPaperId['paper-a'] = 'Starting compilation…'
    expect(handler.isEnabled?.(widget)).toBe(false)
  })

  it('disables Build Graph and Open Graph for a paper that has not loaded yet', () => {
    register()
    const widget = createFakePaperWidget('missing-paper')

    expect(commands.handlerFor(ScholarCommands.BUILD_KNOWLEDGE_GRAPH).isEnabled?.(widget))
      .toBe(false)
    expect(commands.handlerFor(ScholarCommands.OPEN_GRAPH).isEnabled?.(widget))
      .toBe(false)
    // Delete never depends on paper data being loaded.
    expect(commands.handlerFor(ScholarCommands.DELETE_PAPER).isEnabled?.(widget))
      .toBe(true)
  })

  it('enables Build Graph once HTML is available and the paper is idle', () => {
    register()
    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_html: true })
    const widget = createFakePaperWidget('paper-a')

    expect(commands.handlerFor(ScholarCommands.BUILD_KNOWLEDGE_GRAPH).isEnabled?.(widget))
      .toBe(true)

    snapshot.statusByPaperId['paper-a'] = 'Building…'
    expect(commands.handlerFor(ScholarCommands.BUILD_KNOWLEDGE_GRAPH).isEnabled?.(widget))
      .toBe(false)
    expect(commands.handlerFor(ScholarCommands.STOP_KNOWLEDGE_GRAPH).isEnabled?.(widget))
      .toBe(false)
  })

  it('offers Stop only while a knowledge graph build is active', async () => {
    register()
    const widget = createFakePaperWidget('paper-a')
    snapshot.statusByPaperId['paper-a'] = 'Starting knowledge graph build…'

    const stop = commands.handlerFor(ScholarCommands.STOP_KNOWLEDGE_GRAPH)
    expect(stop.isVisible?.(widget)).toBe(true)
    expect(stop.isEnabled?.(widget)).toBe(true)

    await stop.execute(widget)
    expect(store.cancelKnowledgeGraph).toHaveBeenCalledWith('paper-a')
  })

  it('enables Open Graph only once a knowledge graph exists', () => {
    register()
    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_knowledge_graph: false })
    const widget = createFakePaperWidget('paper-a')

    expect(commands.handlerFor(ScholarCommands.OPEN_GRAPH).isEnabled?.(widget)).toBe(false)

    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_knowledge_graph: true })
    expect(commands.handlerFor(ScholarCommands.OPEN_GRAPH).isEnabled?.(widget)).toBe(true)
  })

  it('executes Compile and Build Graph against the widget paper, never a foreign widget', async () => {
    register()
    const widget = createFakePaperWidget('paper-a')
    const foreignWidget = createForeignWidget()

    await commands.handlerFor(ScholarCommands.COMPILE_PAPER).execute(widget)
    expect(store.compilePaper).toHaveBeenCalledWith('paper-a')

    confirmDialogOpen.mockResolvedValueOnce(false)
    await commands.handlerFor(ScholarCommands.BUILD_KNOWLEDGE_GRAPH).execute(widget)
    expect(store.buildKnowledgeGraph).not.toHaveBeenCalled()

    confirmDialogOpen.mockResolvedValueOnce(true)
    await commands.handlerFor(ScholarCommands.BUILD_KNOWLEDGE_GRAPH).execute(widget)
    expect(store.buildKnowledgeGraph).toHaveBeenCalledWith('paper-a')

    await commands.handlerFor(ScholarCommands.COMPILE_PAPER).execute(foreignWidget)
    await commands.handlerFor(ScholarCommands.BUILD_KNOWLEDGE_GRAPH).execute(foreignWidget)
    expect(store.compilePaper).toHaveBeenCalledTimes(1)
    expect(store.buildKnowledgeGraph).toHaveBeenCalledTimes(1)
  })

  it('re-anchors terms straight away, because no LLM tokens are spent', async () => {
    // Unlike a graph build this only re-matches known terms against text the
    // paper already has, so a confirmation dialog would be noise.
    const { messageService } = register()
    const widget = createFakePaperWidget('paper-a')

    await commands.handlerFor(ScholarCommands.REANCHOR_OCCURRENCES).execute(widget)

    expect(confirmDialogOpen).not.toHaveBeenCalled()
    expect(store.reanchorOccurrences).toHaveBeenCalledWith('paper-a')
    expect(messageService.info).toHaveBeenCalledWith(
      expect.stringContaining('312 occurrences (was 199)'),
    )
  })

  it('deletes the paper, closes its widget and reports success only after confirmation', async () => {
    const { messageService, widgetManager } = register()
    const widget = createFakePaperWidget('paper-a')
    widgetManager.getWidgets.mockReturnValue([widget])

    confirmDialogOpen.mockResolvedValueOnce(false)
    await commands.handlerFor(ScholarCommands.DELETE_PAPER).execute(widget)
    expect(store.deletePaper).not.toHaveBeenCalled()
    expect(widget.close).not.toHaveBeenCalled()
    expect(messageService.info).not.toHaveBeenCalled()

    confirmDialogOpen.mockResolvedValueOnce(true)
    await commands.handlerFor(ScholarCommands.DELETE_PAPER).execute(widget)
    expect(store.deletePaper).toHaveBeenCalledWith('paper-a')
    expect(widgetManager.getWidgets).toHaveBeenCalledWith(SCHOLAR_PAPER_FACTORY_ID)
    expect(widget.close).toHaveBeenCalledOnce()
    expect(messageService.info).toHaveBeenCalledWith('Paper deleted')
  })

  it('closes every open paper and graph widget of the deleted paper across tabs, but never a different paper', async () => {
    const { widgetManager } = register()
    const widgetA1 = createFakePaperWidget('paper-a')
    const widgetA2 = createFakePaperWidget('paper-a')
    const widgetB = createFakePaperWidget('paper-b')
    const graphA = createFakeGraphWidget('paper-a')
    const graphB = createFakeGraphWidget('paper-b')
    widgetManager.getWidgets.mockImplementation((factoryId: string) =>
      factoryId === SCHOLAR_PAPER_GRAPH_FACTORY_ID ? [graphA, graphB] : [widgetA1, widgetA2, widgetB])
    confirmDialogOpen.mockResolvedValueOnce(true)

    await commands.handlerFor(ScholarCommands.DELETE_PAPER).execute(createLibraryNode('paper-a'))

    expect(store.deletePaper).toHaveBeenCalledWith('paper-a')
    expect(widgetManager.getWidgets).toHaveBeenCalledWith(SCHOLAR_PAPER_GRAPH_FACTORY_ID)
    expect(widgetA1.close).toHaveBeenCalledOnce()
    expect(widgetA2.close).toHaveBeenCalledOnce()
    expect(widgetB.close).not.toHaveBeenCalled()
    expect(graphA.close).toHaveBeenCalledOnce()
    expect(graphB.close).not.toHaveBeenCalled()
  })

  it('reports the error and skips the success message when deletion fails', async () => {
    const { messageService, widgetManager } = register()
    const widget = createFakePaperWidget('paper-a')
    widgetManager.getWidgets.mockReturnValue([widget])
    confirmDialogOpen.mockResolvedValueOnce(true)
    store.deletePaper.mockRejectedValueOnce(new Error('network down'))

    await commands.handlerFor(ScholarCommands.DELETE_PAPER).execute(widget)

    expect(widget.close).not.toHaveBeenCalled()
    expect(messageService.info).not.toHaveBeenCalled()
    expect(messageService.error).toHaveBeenCalledWith('Could not delete paper: network down')
  })

  it('does nothing for Delete when invoked on a widget from another tab', async () => {
    register()
    const foreignWidget = createForeignWidget()

    await commands.handlerFor(ScholarCommands.DELETE_PAPER).execute(foreignWidget)

    expect(confirmDialogOpen).not.toHaveBeenCalled()
    expect(store.deletePaper).not.toHaveBeenCalled()
  })

  it('never falls back to the active paper when a foreign widget is passed explicitly', async () => {
    const { shell } = register()
    shell.activeWidget = createFakePaperWidget('paper-a')
    const foreignWidget = createForeignWidget()

    for (const command of [
      ScholarCommands.COMPILE_PAPER,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH,
      ScholarCommands.DELETE_PAPER,
      ScholarCommands.OPEN_GRAPH,
    ]) {
      expect(commands.handlerFor(command).isVisible?.(foreignWidget)).toBe(false)
    }

    await commands.handlerFor(ScholarCommands.COMPILE_PAPER).execute(foreignWidget)
    expect(store.compilePaper).not.toHaveBeenCalled()
  })

  it('creates a graph widget, opens it to the right of the matching paper widget, and activates paper + graph', async () => {
    const { widgetManager, shell } = register()
    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_knowledge_graph: true })
    const paperWidget = createFakePaperWidget('paper-a')
    const graphWidget = createFakeGraphWidget('paper-a', false)
    widgetManager.getWidgets.mockImplementation((factoryId: string) =>
      factoryId === SCHOLAR_PAPER_FACTORY_ID ? [paperWidget] : [])
    widgetManager.getOrCreateWidget.mockResolvedValue(graphWidget)

    await commands.handlerFor(ScholarCommands.OPEN_GRAPH).execute(paperWidget)

    expect(widgetManager.getOrCreateWidget).toHaveBeenCalledWith(
      SCHOLAR_PAPER_GRAPH_FACTORY_ID,
      { paperId: 'paper-a' },
    )
    expect(graphWidget.updateLabel).toHaveBeenCalledWith(expect.any(String))
    expect(shell.addWidget).toHaveBeenCalledWith(graphWidget, expect.objectContaining({
      area: 'main',
      mode: 'open-to-right',
      ref: paperWidget,
    }))
    expect(store.activatePaper).toHaveBeenCalledWith('paper-a')
    expect(shell.activateWidget).toHaveBeenCalledWith(graphWidget.id)
  })

  it('falls back to the current main widget as the split reference when no matching paper widget is open', async () => {
    const { widgetManager, shell } = register()
    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_knowledge_graph: true })
    const libraryNode = createLibraryNode('paper-a')
    const currentMainWidget = createFakePaperWidget('paper-b')
    const graphWidget = createFakeGraphWidget('paper-a', false)
    widgetManager.getWidgets.mockImplementation(() => [])
    shell.getCurrentWidget.mockReturnValue(currentMainWidget)
    widgetManager.getOrCreateWidget.mockResolvedValue(graphWidget)

    await commands.handlerFor(ScholarCommands.OPEN_GRAPH).execute(libraryNode)

    expect(shell.getCurrentWidget).toHaveBeenCalledWith('main')
    expect(shell.addWidget).toHaveBeenCalledWith(graphWidget, expect.objectContaining({
      area: 'main',
      mode: 'open-to-right',
      ref: currentMainWidget,
    }))
  })

  it('falls back to tab-after with no ref when neither a paper widget nor a current main widget exist', async () => {
    const { widgetManager, shell } = register()
    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_knowledge_graph: true })
    const libraryNode = createLibraryNode('paper-a')
    const graphWidget = createFakeGraphWidget('paper-a', false)
    widgetManager.getWidgets.mockImplementation(() => [])
    shell.getCurrentWidget.mockReturnValue(undefined)
    widgetManager.getOrCreateWidget.mockResolvedValue(graphWidget)

    await commands.handlerFor(ScholarCommands.OPEN_GRAPH).execute(libraryNode)

    expect(shell.addWidget).toHaveBeenCalledWith(graphWidget, expect.objectContaining({
      area: 'main',
      mode: 'tab-after',
      ref: undefined,
    }))
  })

  it('reuses the already attached graph widget for the same paperId instead of re-adding it', async () => {
    const { widgetManager, shell } = register()
    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_knowledge_graph: true })
    const paperWidget = createFakePaperWidget('paper-a')
    const graphWidget = createFakeGraphWidget('paper-a', true)
    widgetManager.getWidgets.mockImplementation((factoryId: string) =>
      factoryId === SCHOLAR_PAPER_FACTORY_ID ? [paperWidget] : [])
    widgetManager.getOrCreateWidget.mockResolvedValue(graphWidget)

    await commands.handlerFor(ScholarCommands.OPEN_GRAPH).execute(paperWidget)

    expect(shell.addWidget).not.toHaveBeenCalled()
    expect(shell.activateWidget).toHaveBeenCalledWith(graphWidget.id)
  })

  it('creates separate graph widgets for distinct papers', async () => {
    const { widgetManager } = register()
    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_knowledge_graph: true })
    snapshot.papersById['paper-b'] = paperDetail('paper-b', { has_knowledge_graph: true })
    widgetManager.getWidgets.mockImplementation(() => [])
    widgetManager.getOrCreateWidget.mockImplementation((_factoryId: string, options: { paperId: string }) =>
      Promise.resolve(createFakeGraphWidget(options.paperId, false)))

    await commands.handlerFor(ScholarCommands.OPEN_GRAPH).execute(createLibraryNode('paper-a'))
    await commands.handlerFor(ScholarCommands.OPEN_GRAPH).execute(createLibraryNode('paper-b'))

    const calledOptions = widgetManager.getOrCreateWidget.mock.calls.map(call => call[1])
    expect(calledOptions[0]).toEqual({ paperId: 'paper-a' })
    expect(calledOptions[1]).toEqual({ paperId: 'paper-b' })
  })

  it('does nothing for Open Graph when invoked on a widget from another tab', async () => {
    const { widgetManager } = register()
    const foreignWidget = createForeignWidget()

    await commands.handlerFor(ScholarCommands.OPEN_GRAPH).execute(foreignWidget)

    expect(widgetManager.getOrCreateWidget).not.toHaveBeenCalled()
  })

  it('registers paper find icon and field before the existing navigation toolbar actions', () => {
    const { contribution } = createContribution(store)
    const registry = new FakeToolbarRegistry()

    contribution.registerToolbarItems(registry as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])

    const ids = registry.items.map(item => item.id)
    expect(ids).toEqual([
      ScholarCommands.FIND_IN_PAPER.id,
      SCHOLAR_PAPER_FIND_TOOLBAR_ID,
      ScholarCommands.COMPILE_PAPER.id,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH.id,
      ScholarCommands.STOP_KNOWLEDGE_GRAPH.id,
      ScholarCommands.DELETE_PAPER.id,
      ScholarCommands.OPEN_GRAPH.id,
      ScholarCommands.SEARCH_GRAPH.id,
      ScholarCommands.FILTER_GRAPH.id,
      ScholarCommands.TOGGLE_GRAPH_FOCUS.id,
      ScholarCommands.RESET_GRAPH_LAYOUT.id,
      ScholarCommands.REVEAL_GRAPH_SELECTION.id,
      ScholarCommands.REFRESH_LIBRARY.id,
      ScholarCommands.CREATE_READING_SET.id,
      ScholarCommands.REFRESH_READING_SETS.id,
      ScholarCommands.UPLOAD_LATEX.id,
      ScholarCommands.IMPORT_ARXIV.id,
      ScholarCommands.GENERATE_SUGGESTIONS.id,
      ScholarCommands.APPLY_SUGGESTIONS.id,
      ScholarCommands.CREATE_MANUAL_SUGGESTION.id,
      ScholarCommands.SAVE_LLM_SETTINGS.id,
      ScholarCommands.REVERT_LLM_SETTINGS.id,
      ScholarCommands.REFRESH_LLM_MODELS.id,
      ScholarCommands.TEST_LLM_KG_EXTRACTION.id,
      ScholarCommands.TEST_LLM_HTML_INJECTION.id,
      ScholarCommands.TEST_LLM_TOOLTIP_SUGGESTION.id,
    ])
    const findField = registry.items.find(item => item.id === SCHOLAR_PAPER_FIND_TOOLBAR_ID)!
    expect(findField.command).toBeUndefined()
    expect(findField.render).toBeInstanceOf(Function)
    expect(findField.onDidChange).toBeInstanceOf(Function)

    registry.items.filter(item => item !== findField).forEach(item => {
      expect(item.group).toBe('navigation')
      expect(item.command).toBe(item.id)
      expect(item.onDidChange).toBeInstanceOf(Function)
    })
  })

  it('switches the paper find toolbar between its icon and expanded field', () => {
    const { contribution } = createContribution(store)
    const registry = new FakeToolbarRegistry()
    contribution.registerToolbarItems(registry as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])
    const paperWidget = createFakePaperWidget('paper-a')
    const foreignWidget = createForeignWidget()
    const findIcon = registry.items.find(item => item.id === ScholarCommands.FIND_IN_PAPER.id)!
    const findField = registry.items.find(item => item.id === SCHOLAR_PAPER_FIND_TOOLBAR_ID)!

    expect(findIcon.isVisible?.(paperWidget)).toBe(true)
    expect(findField.isVisible?.(paperWidget)).toBe(false)
    expect(findIcon.isVisible?.(foreignWidget)).toBe(false)
    expect(findField.isVisible?.(foreignWidget)).toBe(false)

    paperWidget.openSearch()

    expect(findIcon.isVisible?.(paperWidget)).toBe(false)
    expect(findField.isVisible?.(paperWidget)).toBe(true)
    expect(findField.render?.(paperWidget)).toBeTruthy()
  })

  it('refreshes the paper find toolbar when its click temporarily moves shell focus', () => {
    const { contribution, shell } = register()
    const registry = new FakeToolbarRegistry()
    contribution.registerToolbarItems(registry as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])
    const paperWidget = createFakePaperWidget('paper-a')
    const findField = registry.items.find(item => item.id === SCHOLAR_PAPER_FIND_TOOLBAR_ID)!
    const toolbarChanged = vi.fn()
    findField.onDidChange?.(toolbarChanged)
    shell.activeWidget = paperWidget
    contribution.onStart()
    toolbarChanged.mockClear()

    shell.activeWidget = createForeignWidget()
    commands.handlerFor(ScholarCommands.FIND_IN_PAPER).execute(paperWidget)

    expect(paperWidget.searchSnapshot.isOpen).toBe(true)
    expect(toolbarChanged).toHaveBeenCalledOnce()
    expect(findField.isVisible?.(paperWidget)).toBe(true)
    contribution.onStop()
  })

  it('tracks search state only for the current restored paper widget', () => {
    const { contribution, shell, fireCurrentWidgetChanged } = createContribution(store)
    const registry = new FakeToolbarRegistry()
    contribution.registerToolbarItems(registry as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])
    const toolbarListener = vi.fn()
    registry.items.forEach(item => item.onDidChange?.(toolbarListener))
    const paperA = createFakePaperWidget('paper-a')
    const paperB = createFakePaperWidget('paper-b')
    shell.activeWidget = paperA

    contribution.onStart()
    expect(paperA.searchListeners.size).toBe(1)
    const callsAfterStart = toolbarListener.mock.calls.length
    paperA.openSearch()
    expect(toolbarListener.mock.calls.length).toBeGreaterThan(callsAfterStart)

    shell.activeWidget = paperB
    fireCurrentWidgetChanged()
    expect(paperA.searchListeners.size).toBe(0)
    expect(paperB.searchListeners.size).toBe(1)

    contribution.onStop()
    expect(paperB.searchListeners.size).toBe(0)
  })

  it('fires onDidChange for every toolbar item whenever the underlying store updates', () => {
    const { contribution } = createContribution(store)
    const registry = new FakeToolbarRegistry()
    contribution.registerToolbarItems(registry as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])

    const listener = vi.fn()
    registry.items.forEach(item => item.onDidChange?.(listener))
    expect(listener).not.toHaveBeenCalled()

    contribution.onStart()
    const storeListener = store.subscribe.mock.calls[0][0] as () => void
    storeListener()

    expect(listener).toHaveBeenCalledTimes(registry.items.length)

    contribution.onStop()
  })

  it('fires toolbar onDidChange when LLM settings state changes', () => {
    const { contribution, llmSettings } = createContribution(store)
    const registry = new FakeToolbarRegistry()
    contribution.registerToolbarItems(registry as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])
    const listener = vi.fn()
    registry.items.forEach(item => item.onDidChange?.(listener))

    contribution.onStart()
    const llmListener = llmSettings.onDidChange.mock.calls[0][0] as () => void
    llmListener()

    expect(listener).toHaveBeenCalledTimes(registry.items.length)
    contribution.onStop()
  })

  it('shows the active paper suggestion operation in the shared status bar', async () => {
    snapshot.activePaperId = 'paper-a'
    snapshot.statusByPaperId['paper-a'] = 'Applying term highlights…'
    snapshot.statusByPaperId['paper-b'] = 'Generating term highlights…'
    const { contribution, statusBar } = createContribution(store)

    contribution.onStart()
    await Promise.resolve()
    expect(statusBar.setElement).toHaveBeenLastCalledWith(
      'scholar-agent.active-paper',
      expect.objectContaining({
        text: '$(sync~spin) Applying term highlights…',
        tooltip: 'Applying term highlights…',
      }),
    )

    snapshot.activePaperId = 'paper-b'
    const storeListener = store.subscribe.mock.calls[0][0] as () => void
    storeListener()
    await Promise.resolve()
    expect(statusBar.setElement).toHaveBeenLastCalledWith(
      'scholar-agent.active-paper',
      expect.objectContaining({
        text: '$(sync~spin) Generating term highlights…',
        tooltip: 'Generating term highlights…',
      }),
    )

    contribution.onStop()
  })

  it('exposes library commands in the command palette while scoping their toolbar buttons', () => {
    register()
    const libraryWidget = createForeignWidget()
    const paperWidget = createFakePaperWidget('paper-a')

    for (const command of [
      ScholarCommands.REFRESH_LIBRARY,
      ScholarCommands.UPLOAD_LATEX,
      ScholarCommands.IMPORT_ARXIV,
    ]) {
      const handler = commands.handlerFor(command)
      expect(handler.isVisible?.(libraryWidget)).toBe(true)
      expect(handler.isVisible?.(paperWidget)).toBe(false)
      expect(handler.isVisible?.(undefined)).toBe(true)
    }
  })

  it('refreshes the library when Refresh Library runs', async () => {
    register()
    await commands.handlerFor(ScholarCommands.REFRESH_LIBRARY).execute(createForeignWidget())
    expect(store.loadLibrary).toHaveBeenCalledOnce()
  })
})

describe('ScholarContribution graph search and filters', () => {
  function register() {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const commands = new FakeCommandRegistry()
    const toolbar = new FakeToolbarRegistry()
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])
    context.contribution.registerToolbarItems(toolbar as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])
    return { ...context, commands, toolbar }
  }

  it('registers native search/filter commands and scopes them to a ready graph target', () => {
    const { commands, toolbar, shell } = register()
    const snapshot = graphSnapshot()
    const graphWidget = createFakeGraphWidget('paper-a', true, snapshot)
    const foreignWidget = createForeignWidget()

    for (const command of [ScholarCommands.SEARCH_GRAPH, ScholarCommands.FILTER_GRAPH]) {
      const handler = commands.handlerFor(command)
      expect(handler.isVisible?.(graphWidget)).toBe(true)
      expect(handler.isEnabled?.(graphWidget)).toBe(true)
      expect(handler.isVisible?.(foreignWidget)).toBe(false)
      expect(handler.isVisible?.(undefined)).toBe(false)
      expect(toolbar.items.some(item => item.command === command.id)).toBe(true)
      expect(command.iconClass).toMatch(/^codicon codicon-/)
    }

    shell.activeWidget = graphWidget
    expect(commands.handlerFor(ScholarCommands.SEARCH_GRAPH).isVisible?.(undefined)).toBe(true)

    snapshot.status = 'loading'
    expect(commands.handlerFor(ScholarCommands.SEARCH_GRAPH).isEnabled?.(graphWidget)).toBe(false)
    expect(commands.handlerFor(ScholarCommands.FILTER_GRAPH).isEnabled?.(graphWidget)).toBe(false)
    snapshot.status = 'error'
    expect(commands.handlerFor(ScholarCommands.SEARCH_GRAPH).isEnabled?.(graphWidget)).toBe(false)
  })

  it('opens fuzzy node search over label, type, and detail and reveals the accepted node', async () => {
    const { commands, quickInputService } = register()
    const graphWidget = createFakeGraphWidget('paper-a')
    quickInputService.pick.mockImplementation(async (items: FakeQuickPickItem[]) => items[1])

    await commands.handlerFor(ScholarCommands.SEARCH_GRAPH).execute(graphWidget)

    expect(quickInputService.pick).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'node-1',
          label: 'Theorem One',
          description: 'theorem',
          detail: 'Main result',
        }),
        expect.objectContaining({
          id: 'node-2',
          label: 'Definition Two',
          description: 'definition',
          detail: 'Supporting concept',
        }),
      ],
      expect.objectContaining({
        canPickMany: false,
        matchOnDescription: true,
        matchOnDetail: true,
      }),
    )
    expect(graphWidget.revealNode).toHaveBeenCalledWith('node-2')
  })

  it('queries the bounded controller before presenting canonical search results', async () => {
    const { commands, quickInputService } = register()
    const graphWidget = createFakeGraphWidget('paper-a')
    const controller = graphWidget.getGraphController()!
    quickInputService.input.mockResolvedValueOnce('remote concept')
    vi.mocked(controller.search).mockResolvedValueOnce([
      { id: 'remote-1', label: 'Remote Concept', nodeType: 'concept', detail: 'Server result' },
    ])
    quickInputService.pick.mockImplementation(async (items: FakeQuickPickItem[]) => items[0])

    await commands.handlerFor(ScholarCommands.SEARCH_GRAPH).execute(graphWidget)

    expect(controller.search).toHaveBeenCalledWith('remote concept')
    expect(quickInputService.pick).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'remote-1', label: 'Remote Concept' })],
      expect.any(Object),
    )
    expect(graphWidget.revealNode).toHaveBeenCalledWith('remote-1')
  })

  it('does not reveal a search result after cancellation or controller replacement', async () => {
    const { commands, quickInputService } = register()
    const graphWidget = createFakeGraphWidget('paper-a')
    const handler = commands.handlerFor(ScholarCommands.SEARCH_GRAPH)

    quickInputService.pick.mockResolvedValueOnce(undefined)
    await handler.execute(graphWidget)
    expect(graphWidget.revealNode).not.toHaveBeenCalled()

    let resolvePick: ((item: FakeQuickPickItem) => void) | undefined
    let firstItem: FakeQuickPickItem | undefined
    quickInputService.pick.mockImplementationOnce((items: FakeQuickPickItem[]) => {
      firstItem = items[0]
      return new Promise(resolve => {
        resolvePick = resolve
      })
    })
    const pending = handler.execute(graphWidget)
    vi.mocked(graphWidget.getGraphController).mockReturnValue(undefined)
    resolvePick?.(firstItem!)
    await pending

    expect(graphWidget.revealNode).not.toHaveBeenCalled()
  })

  it('preselects current filters and applies node/relationship choices atomically on Accept', async () => {
    const { commands, quickInputService } = register()
    const graphWidget = createFakeGraphWidget('paper-a')
    const picker = createFakeQuickPick()
    quickInputService.createQuickPick.mockReturnValue(picker)

    const pending = commands.handlerFor(ScholarCommands.FILTER_GRAPH).execute(graphWidget)

    expect(picker.canSelectMany).toBe(true)
    expect(picker.items.filter(item => item.type === 'separator').map(item => item.label)).toEqual([
      'Node Types',
      'Relationship Types',
    ])
    expect(picker.selectedItems.map(item => item.filterType)).toEqual([
      'theorem',
      'depends_on',
    ])
    expect(graphWidget.setVisibleTypes).not.toHaveBeenCalled()

    picker.selectedItems = [
      picker.items.find(item => item.filterKind === 'node' && item.filterType === 'definition')!,
      picker.items.find(item => item.filterKind === 'edge' && item.filterType === 'uses')!,
    ]
    picker.accept()
    await pending

    expect(graphWidget.setVisibleTypes).toHaveBeenCalledOnce()
    expect(graphWidget.setVisibleTypes).toHaveBeenCalledWith(['definition'], ['uses'])
  })

  it('leaves filters untouched on Escape and ignores Accept from a replaced controller', async () => {
    const { commands, quickInputService } = register()
    const graphWidget = createFakeGraphWidget('paper-a')
    const handler = commands.handlerFor(ScholarCommands.FILTER_GRAPH)

    const cancelledPicker = createFakeQuickPick()
    quickInputService.createQuickPick.mockReturnValueOnce(cancelledPicker)
    const cancelled = handler.execute(graphWidget)
    cancelledPicker.selectedItems = []
    cancelledPicker.cancel()
    await cancelled
    expect(graphWidget.setVisibleTypes).not.toHaveBeenCalled()

    const stalePicker = createFakeQuickPick()
    quickInputService.createQuickPick.mockReturnValueOnce(stalePicker)
    const stale = handler.execute(graphWidget)
    vi.mocked(graphWidget.getGraphController).mockReturnValue(undefined)
    stalePicker.selectedItems = []
    stalePicker.accept()
    await stale
    expect(graphWidget.setVisibleTypes).not.toHaveBeenCalled()
  })

  it('keeps filtering enabled when every type is hidden so filters can be restored', async () => {
    const { commands, quickInputService } = register()
    const snapshot = graphSnapshot({
      nodeTypeFilters: graphSnapshot().nodeTypeFilters.map(option => ({ ...option, selected: false })),
      edgeTypeFilters: graphSnapshot().edgeTypeFilters.map(option => ({ ...option, selected: false })),
      visibleNodeCount: 0,
      visibleEdgeCount: 0,
    })
    const graphWidget = createFakeGraphWidget('paper-a', true, snapshot)
    const handler = commands.handlerFor(ScholarCommands.FILTER_GRAPH)
    const picker = createFakeQuickPick()
    quickInputService.createQuickPick.mockReturnValue(picker)

    expect(handler.isEnabled?.(graphWidget)).toBe(true)
    const pending = handler.execute(graphWidget)
    expect(picker.selectedItems).toEqual([])
    picker.selectedItems = [
      picker.items.find(item => item.filterKind === 'node' && item.filterType === 'theorem')!,
    ]
    picker.accept()
    await pending

    expect(graphWidget.setVisibleTypes).toHaveBeenCalledWith(['theorem'], [])
  })
})

describe('ScholarContribution graph focus, layout, source, and status', () => {
  function register(snapshot = graphSnapshot()) {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const commands = new FakeCommandRegistry()
    const toolbar = new FakeToolbarRegistry()
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])
    context.contribution.registerToolbarItems(toolbar as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])
    const widget = createFakeGraphWidget('paper-a', true, snapshot)
    return { ...context, commands, toolbar, widget, snapshot }
  }

  function start(context: ReturnType<typeof register>): void {
    ;(context.contribution as unknown as { onStart(app: unknown): void }).onStart({})
  }

  it('registers focus, layout, and source commands only for graph targets', () => {
    const context = register()
    const foreignWidget = createForeignWidget()

    for (const command of [
      ScholarCommands.TOGGLE_GRAPH_FOCUS,
      ScholarCommands.RESET_GRAPH_LAYOUT,
      ScholarCommands.REVEAL_GRAPH_SELECTION,
    ]) {
      const handler = context.commands.handlerFor(command)
      expect(handler.isVisible?.(context.widget)).toBe(true)
      expect(handler.isVisible?.(foreignWidget)).toBe(false)
      expect(context.toolbar.items.some(item => item.command === command.id)).toBe(true)
      expect(command.iconClass).toMatch(/^codicon codicon-/)
    }
  })

  it('focuses a selected node, remains enabled while toggled, and clears focus on repeat', async () => {
    const snapshot = graphSnapshot({
      selectedNode: {
        id: 'node-1',
        label: 'Theorem One',
        nodeType: 'theorem',
        domNodeId: 'dom-node-1',
      },
      canFocusSelection: true,
      canRevealSelectionInPaper: true,
    })
    const { commands, widget } = register(snapshot)
    const handler = commands.handlerFor(ScholarCommands.TOGGLE_GRAPH_FOCUS)

    expect(handler.isEnabled?.(widget)).toBe(true)
    expect(handler.isToggled?.(widget)).toBe(false)
    await handler.execute(widget)
    expect(widget.focusSelection).toHaveBeenCalledOnce()

    snapshot.focusMode = true
    snapshot.focusedNodeId = 'node-1'
    snapshot.selectedNode = null
    snapshot.canFocusSelection = false
    expect(handler.isEnabled?.(widget)).toBe(true)
    expect(handler.isToggled?.(widget)).toBe(true)
    await handler.execute(widget)
    expect(widget.clearFocus).toHaveBeenCalledOnce()
  })

  it('resets layout when ready and reveals only DOM-backed node selections', async () => {
    const snapshot = graphSnapshot({
      selectedNode: {
        id: 'node-1',
        label: 'Theorem One',
        nodeType: 'theorem',
        domNodeId: 'dom-node-1',
      },
      canRevealSelectionInPaper: true,
    })
    const { commands, widget } = register(snapshot)
    const layout = commands.handlerFor(ScholarCommands.RESET_GRAPH_LAYOUT)
    const reveal = commands.handlerFor(ScholarCommands.REVEAL_GRAPH_SELECTION)

    expect(layout.isEnabled?.(widget)).toBe(true)
    await layout.execute(widget)
    expect(widget.resetLayout).toHaveBeenCalledOnce()

    expect(reveal.isEnabled?.(widget)).toBe(true)
    await reveal.execute(widget)
    expect(widget.revealSelectionInPaper).toHaveBeenCalledOnce()

    snapshot.selectedNode = null
    snapshot.canRevealSelectionInPaper = false
    expect(reveal.isEnabled?.(widget)).toBe(false)
    snapshot.status = 'error'
    expect(layout.isEnabled?.(widget)).toBe(false)
  })

  it('shows native counts, active filters, and focus for the current graph only', () => {
    const snapshot = graphSnapshot({
      selectedNode: {
        id: 'node-1',
        label: 'Theorem One',
        nodeType: 'theorem',
        domNodeId: 'dom-node-1',
      },
      focusMode: true,
      focusedNodeId: 'node-1',
    })
    const context = register(snapshot)
    context.shell.activeWidget = context.widget
    const toolbarChanged = vi.fn()
    context.toolbar.items
      .find(item => item.id === ScholarCommands.TOGGLE_GRAPH_FOCUS.id)
      ?.onDidChange?.(toolbarChanged)

    start(context)
    toolbarChanged.mockClear()

    const graphStatusCall = context.statusBar.setElement.mock.calls.findLast(
      ([id]) => id === 'scholar-agent.graph-status',
    )
    expect(graphStatusCall).toBeDefined()
    const graphStatus = graphStatusCall?.[1] as { text: string; tooltip: string }
    expect(graphStatus.text).toContain('1/2 nodes')
    expect(graphStatus.text).toContain('2/3 links')
    expect(graphStatus.tooltip).toContain('Theorems')
    expect(graphStatus.tooltip).toContain('Depends on')
    expect(graphStatus.tooltip).toContain('Theorem One')

    snapshot.visibleNodeCount = 2
    snapshot.focusMode = false
    snapshot.focusedNodeId = null
    emitGraphStateChange(context.widget)

    expect(toolbarChanged).toHaveBeenCalledOnce()
    expect(context.statusBar.setElement.mock.calls.findLast(
      ([id]) => id === 'scholar-agent.graph-status',
    )?.[1]).toEqual(expect.objectContaining({ text: expect.stringContaining('2/2 nodes') }))

    const statusUpdateCount = context.statusBar.setElement.mock.calls.filter(
      ([id]) => id === 'scholar-agent.graph-status',
    ).length
    context.shell.activeWidget = createForeignWidget()
    context.fireCurrentWidgetChanged()
    expect(context.statusBar.removeElement).toHaveBeenCalledWith('scholar-agent.graph-status')

    emitGraphStateChange(context.widget)
    expect(context.statusBar.setElement.mock.calls.filter(
      ([id]) => id === 'scholar-agent.graph-status',
    )).toHaveLength(statusUpdateCount)
  })

  it('enables controls when a restored graph becomes ready', () => {
    const snapshot = graphSnapshot({
      status: 'loading',
      visibleNodeCount: 0,
      visibleEdgeCount: 0,
    })
    const context = register(snapshot)
    context.shell.activeWidget = context.widget
    const toolbarChanged = vi.fn()
    context.toolbar.items
      .find(item => item.id === ScholarCommands.RESET_GRAPH_LAYOUT.id)
      ?.onDidChange?.(toolbarChanged)
    start(context)
    toolbarChanged.mockClear()

    expect(context.commands.handlerFor(ScholarCommands.RESET_GRAPH_LAYOUT).isEnabled?.(
      context.widget,
    )).toBe(false)
    expect(context.statusBar.setElement).toHaveBeenCalledWith(
      'scholar-agent.graph-status',
      expect.objectContaining({ text: expect.stringContaining('loading') }),
    )

    snapshot.status = 'ready'
    snapshot.visibleNodeCount = 1
    snapshot.visibleEdgeCount = 2
    emitGraphStateChange(context.widget)

    expect(context.commands.handlerFor(ScholarCommands.RESET_GRAPH_LAYOUT).isEnabled?.(
      context.widget,
    )).toBe(true)
    expect(toolbarChanged).toHaveBeenCalledOnce()
    expect(context.statusBar.setElement.mock.calls.findLast(
      ([id]) => id === 'scholar-agent.graph-status',
    )?.[1]).toEqual(expect.objectContaining({ text: expect.stringContaining('1/2 nodes') }))
  })

  it('subscribes only to the active graph when split tabs have independent state', () => {
    const context = register(graphSnapshot({ visibleNodeCount: 1, totalNodeCount: 2 }))
    const secondSnapshot = graphSnapshot({
      visibleNodeCount: 3,
      totalNodeCount: 4,
      visibleEdgeCount: 4,
      totalEdgeCount: 5,
    })
    const secondWidget = createFakeGraphWidget('paper-b', true, secondSnapshot)
    context.shell.activeWidget = context.widget
    start(context)

    context.shell.activeWidget = secondWidget
    context.fireCurrentWidgetChanged()
    expect(context.statusBar.setElement.mock.calls.findLast(
      ([id]) => id === 'scholar-agent.graph-status',
    )?.[1]).toEqual(expect.objectContaining({ text: expect.stringContaining('3/4 nodes') }))

    const updateCount = context.statusBar.setElement.mock.calls.filter(
      ([id]) => id === 'scholar-agent.graph-status',
    ).length
    emitGraphStateChange(context.widget)
    expect(context.statusBar.setElement.mock.calls.filter(
      ([id]) => id === 'scholar-agent.graph-status',
    )).toHaveLength(updateCount)

    secondSnapshot.visibleNodeCount = 4
    emitGraphStateChange(secondWidget)
    expect(context.statusBar.setElement.mock.calls.findLast(
      ([id]) => id === 'scholar-agent.graph-status',
    )?.[1]).toEqual(expect.objectContaining({ text: expect.stringContaining('4/4 nodes') }))
  })
})

describe('ScholarContribution Open / Open to the Side', () => {
  let snapshot: ReaderWorkspaceSnapshot
  let store: ReturnType<typeof createFakeStore>
  let commands: FakeCommandRegistry

  beforeEach(() => {
    confirmDialogOpen.mockReset()
    singleTextInputDialogOpen.mockReset()
    snapshot = emptySnapshot()
    store = createFakeStore(snapshot)
    commands = new FakeCommandRegistry()
  })

  function register(): ReturnType<typeof createContribution> {
    const context = createContribution(store)
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])
    return context
  }

  function paper(id: string, overrides: Partial<Paper> = {}): Paper {
    return {
      id,
      filename: `${id}.tar.gz`,
      arxiv_id: null,
      uploaded_at: '2026-07-15T00:00:00Z',
      compiled_at: '2026-07-15T00:01:00Z',
      has_html: true,
      ...overrides,
    }
  }

  it('opens a new paper widget, activates it, and marks the paper active', async () => {
    const { widgetManager, shell } = register()
    snapshot.papers = [paper('paper-a', { filename: 'alpha.tar.gz' })]
    const widget = createFakePaperWidget('paper-a', false)
    widgetManager.getOrCreateWidget.mockResolvedValue(widget)

    await commands.handlerFor(ScholarCommands.OPEN_PAPER).execute(createLibraryNode('paper-a'))

    expect(widgetManager.getOrCreateWidget).toHaveBeenCalledWith(
      SCHOLAR_PAPER_FACTORY_ID,
      { paperId: 'paper-a', label: 'alpha' },
    )
    expect(shell.addWidget).toHaveBeenCalledWith(widget, expect.objectContaining({
      area: 'main',
      mode: 'tab-after',
    }))
    expect(store.activatePaper).toHaveBeenCalledWith('paper-a')
    expect(shell.activateWidget).toHaveBeenCalledWith(widget.id)
  })

  it('opens to the side using open-to-right with a reference widget', async () => {
    const { widgetManager, shell } = register()
    snapshot.papers = [paper('paper-a')]
    const widget = createFakePaperWidget('paper-a', false)
    widgetManager.getOrCreateWidget.mockResolvedValue(widget)
    const reference = {}
    shell.getCurrentWidget.mockReturnValue(reference)

    await commands.handlerFor(ScholarCommands.OPEN_PAPER_TO_SIDE).execute(createLibraryNode('paper-a'))

    expect(shell.addWidget).toHaveBeenCalledWith(widget, expect.objectContaining({
      mode: 'open-to-right',
      ref: reference,
    }))
  })

  it('does not re-add an already attached widget but still activates it', async () => {
    const { widgetManager, shell } = register()
    snapshot.papers = [paper('paper-a')]
    const widget = createFakePaperWidget('paper-a', true)
    widgetManager.getOrCreateWidget.mockResolvedValue(widget)

    await commands.handlerFor(ScholarCommands.OPEN_PAPER).execute(createLibraryNode('paper-a'))

    expect(shell.addWidget).not.toHaveBeenCalled()
    expect(shell.activateWidget).toHaveBeenCalledWith(widget.id)
  })

  it('does nothing when no paper can be resolved', async () => {
    const { widgetManager } = register()

    await commands.handlerFor(ScholarCommands.OPEN_PAPER).execute(undefined)

    expect(widgetManager.getOrCreateWidget).not.toHaveBeenCalled()
  })

  it('is visible and enabled for a library tree node or a paper widget, but not for a foreign object', () => {
    register()
    const node = createLibraryNode('paper-a')
    const paperWidget = createFakePaperWidget('paper-a')
    const foreignWidget = createForeignWidget()

    for (const command of [ScholarCommands.OPEN_PAPER, ScholarCommands.OPEN_PAPER_TO_SIDE]) {
      const handler = commands.handlerFor(command)
      expect(handler.isVisible?.(node)).toBe(true)
      expect(handler.isVisible?.(paperWidget)).toBe(true)
      expect(handler.isVisible?.(foreignWidget)).toBe(false)
    }
  })
})

describe('ScholarContribution Import from arXiv', () => {
  let snapshot: ReaderWorkspaceSnapshot
  let store: ReturnType<typeof createFakeStore>
  let commands: FakeCommandRegistry

  beforeEach(() => {
    confirmDialogOpen.mockReset()
    singleTextInputDialogOpen.mockReset()
    snapshot = emptySnapshot()
    store = createFakeStore(snapshot)
    commands = new FakeCommandRegistry()
  })

  function register(): ReturnType<typeof createContribution> {
    const context = createContribution(store)
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])
    return context
  }

  it('is a no-op when the dialog is cancelled', async () => {
    register()
    singleTextInputDialogOpen.mockResolvedValueOnce(undefined)

    await commands.handlerFor(ScholarCommands.IMPORT_ARXIV).execute(undefined)

    expect(store.uploadArxiv).not.toHaveBeenCalled()
  })

  it('is a no-op when the trimmed input is empty', async () => {
    register()
    singleTextInputDialogOpen.mockResolvedValueOnce('   ')

    await commands.handlerFor(ScholarCommands.IMPORT_ARXIV).execute(undefined)

    expect(store.uploadArxiv).not.toHaveBeenCalled()
  })

  it('trims the input, uploads via the store, and opens/activates the returned paper', async () => {
    const { widgetManager, shell } = register()
    const paper = paperDetail('paper-a')
    store.uploadArxiv.mockResolvedValue(paper)
    const widget = createFakePaperWidget('paper-a', false)
    widgetManager.getOrCreateWidget.mockResolvedValue(widget)
    singleTextInputDialogOpen.mockResolvedValueOnce('  2401.12345  ')

    await commands.handlerFor(ScholarCommands.IMPORT_ARXIV).execute(undefined)

    expect(store.uploadArxiv).toHaveBeenCalledWith('2401.12345')
    expect(store.activatePaper).toHaveBeenCalledWith('paper-a')
    expect(shell.activateWidget).toHaveBeenCalledWith(widget.id)
  })

  it('reports the error via MessageService and does not open a widget when the import fails', async () => {
    const { messageService, widgetManager } = register()
    store.uploadArxiv.mockRejectedValue(new Error('bad arXiv id'))
    singleTextInputDialogOpen.mockResolvedValueOnce('2401.12345')

    await commands.handlerFor(ScholarCommands.IMPORT_ARXIV).execute(undefined)

    expect(messageService.error).toHaveBeenCalledWith('Could not fetch arXiv source: bad arXiv id')
    expect(widgetManager.getOrCreateWidget).not.toHaveBeenCalled()
  })
})

describe('ScholarContribution Upload LaTeX', () => {
  let snapshot: ReaderWorkspaceSnapshot
  let store: ReturnType<typeof createFakeStore>
  let commands: FakeCommandRegistry

  beforeEach(() => {
    document.body.querySelectorAll('input[type="file"]').forEach(input => input.remove())
    confirmDialogOpen.mockReset()
    snapshot = emptySnapshot()
    store = createFakeStore(snapshot)
    commands = new FakeCommandRegistry()
  })

  function register(): ReturnType<typeof createContribution> {
    const context = createContribution(store)
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])
    return context
  }

  function currentFileInput(): HTMLInputElement {
    const input = document.querySelector('input[type="file"]')
    if (!input) {
      throw new Error('No file input was created')
    }
    return input as HTMLInputElement
  }

  async function flushMicrotasks(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  it('creates a hidden file input that accepts LaTeX archives', () => {
    register()

    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)

    const input = currentFileInput()
    expect(input.type).toBe('file')
    expect(input.accept).toBe('.tar.gz,.tgz,.zip,.tex')
    expect(input.hidden || input.style.display === 'none').toBe(true)
  })

  it('uploads the selected File via the store and opens the resulting paper, then cleans up the input', async () => {
    const { widgetManager, shell } = register()
    const paper = paperDetail('paper-a')
    store.uploadPaper.mockResolvedValue(paper)
    const widget = createFakePaperWidget('paper-a', false)
    widgetManager.getOrCreateWidget.mockResolvedValue(widget)

    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)
    const input = currentFileInput()
    const file = new File(['abc'], 'paper.tar.gz')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flushMicrotasks()

    expect(store.uploadPaper).toHaveBeenCalledWith(file)
    expect(store.activatePaper).toHaveBeenCalledWith('paper-a')
    expect(shell.activateWidget).toHaveBeenCalledWith(widget.id)
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('is a no-op and cleans up the input when the file dialog is cancelled', () => {
    register()

    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)
    const input = currentFileInput()
    input.dispatchEvent(new Event('cancel'))

    expect(store.uploadPaper).not.toHaveBeenCalled()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('reports an error via MessageService and cleans up the input when the upload fails', async () => {
    const { messageService } = register()
    store.uploadPaper.mockRejectedValue(new Error('network down'))

    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)
    const input = currentFileInput()
    const file = new File(['abc'], 'paper.tar.gz')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flushMicrotasks()

    expect(messageService.error).toHaveBeenCalledWith('Could not upload paper: network down')
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('is safe to invoke repeatedly without leaking hidden inputs', () => {
    register()

    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)
    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)
    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)

    expect(document.querySelectorAll('input[type="file"]').length).toBe(1)
  })

  it('detaches the previous file input listeners when invoked repeatedly', () => {
    register()
    store.uploadPaper.mockResolvedValue(paperDetail('stale-paper'))

    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)
    const staleInput = currentFileInput()
    const staleFile = new File(['stale'], 'stale-paper.tex')
    Object.defineProperty(staleInput, 'files', { value: [staleFile], configurable: true })

    commands.handlerFor(ScholarCommands.UPLOAD_LATEX).execute(undefined)
    staleInput.dispatchEvent(new Event('change'))

    expect(store.uploadPaper).not.toHaveBeenCalled()
    expect(document.querySelectorAll('input[type="file"]').length).toBe(1)
  })
})

describe('ScholarContribution menus', () => {
  it('registers Open LLM Settings in File and Manage settings menus only', () => {
    const store = createFakeStore(emptySnapshot())
    const { contribution } = createContribution(store)
    const registered: { path: string[], commandId: string }[] = []
    const menus = {
      registerMenuAction: (path: string[], action: { commandId: string }) => {
        registered.push({ path, commandId: action.commandId })
        return { dispose: () => undefined }
      },
    }

    contribution.registerMenus(menus as unknown as Parameters<
      ScholarContributionClass['registerMenus']
    >[0])

    const pathsForOpen = registered
      .filter(entry => entry.commandId === ScholarCommands.OPEN_LLM_SETTINGS.id)
      .map(entry => entry.path)
    expect(pathsForOpen).toEqual([
      CommonMenusNs.FILE_SETTINGS_SUBMENU_OPEN,
      CommonMenusNs.MANAGE_SETTINGS,
    ])
    const fileSaveIds = registered
      .filter(entry => JSON.stringify(entry.path) === JSON.stringify(CommonMenusNs.FILE_SAVE))
      .map(entry => entry.commandId)
    expect(fileSaveIds).not.toContain(ScholarCommands.SAVE_LLM_SETTINGS.id)
    expect(fileSaveIds).not.toContain(ScholarCommands.REVERT_LLM_SETTINGS.id)
  })

  it('no longer registers Refresh Library in the View > Views menu (moved to the library toolbar)', () => {
    const store = createFakeStore(emptySnapshot())
    const { contribution } = createContribution(store)
    const registered: { path: string[], commandId: string }[] = []
    const menus = {
      registerMenuAction: (path: string[], action: { commandId: string }) => {
        registered.push({ path, commandId: action.commandId })
        return { dispose: () => undefined }
      },
    }

    contribution.registerMenus(menus as unknown as Parameters<
      ScholarContributionClass['registerMenus']
    >[0])

    const viewViewsIds = registered
      .filter(entry => JSON.stringify(entry.path) === JSON.stringify(CommonMenusNs.VIEW_VIEWS))
      .map(entry => entry.commandId)
    expect(viewViewsIds).not.toContain(ScholarCommands.REFRESH_LIBRARY.id)
  })

  it('registers Open, Open to the Side, Recompile, Build/Stop Knowledge Graph and Delete on the library context menu', () => {
    const store = createFakeStore(emptySnapshot())
    const { contribution } = createContribution(store)
    const registered: { path: string[], commandId: string }[] = []
    const menus = {
      registerMenuAction: (path: string[], action: { commandId: string }) => {
        registered.push({ path, commandId: action.commandId })
        return { dispose: () => undefined }
      },
    }

    contribution.registerMenus(menus as unknown as Parameters<
      ScholarContributionClass['registerMenus']
    >[0])

    const libraryMenuIds = registered
      .filter(entry => JSON.stringify(entry.path) === JSON.stringify(SCHOLAR_LIBRARY_CONTEXT_MENU))
      .map(entry => entry.commandId)
    expect(libraryMenuIds).toEqual([
      ScholarCommands.OPEN_PAPER.id,
      ScholarCommands.OPEN_PAPER_TO_SIDE.id,
      ScholarCommands.COMPILE_PAPER.id,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH.id,
      ScholarCommands.STOP_KNOWLEDGE_GRAPH.id,
      ScholarCommands.REANCHOR_OCCURRENCES.id,
      ScholarCommands.ADD_PAPER_TO_READING_SET.id,
      ScholarCommands.DELETE_PAPER.id,
    ])
  })
})

describe('ScholarContribution reading set chat', () => {
  it('pins the reading-set chat and reveals the chat view from the context menu command', async () => {
    const context = createContribution(createFakeStore(emptySnapshot()))
    const readingSet = {
      id: 'set-1', name: 'Set One',
      created_at: '2026-08-29T10:00:00Z', updated_at: '2026-08-29T10:00:00Z', papers: [],
    }
    context.readingSets.readingSetOf.mockReturnValue(readingSet as never)
    context.widgetManager.getOrCreateWidget.mockResolvedValue({
      id: 'scholar-agent:chat', isAttached: true,
    })
    const commands = new FakeCommandRegistry()
    context.contribution.registerCommands(commands as unknown as Parameters<
      ScholarContributionClass['registerCommands']
    >[0])

    const node = {
      id: 'reading-set:set-1', parent: undefined, selected: false, expanded: false,
      children: [], readingSetId: 'set-1',
    }
    const handler = commands.handlerFor(ScholarCommands.OPEN_READING_SET_CHAT)
    expect(handler.isVisible?.(node)).toBe(true)
    expect(handler.isVisible?.({ paperId: 'paper-a' })).toBeFalsy()
    await handler.execute(node)

    expect(context.chat.activateReadingSet).toHaveBeenCalledWith(readingSet)
    expect(context.shell.activateWidget).toHaveBeenCalledWith('scholar-agent:chat')
    expect(context.messageService.error).not.toHaveBeenCalled()
  })
})
