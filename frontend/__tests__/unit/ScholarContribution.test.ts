import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Command, CommandHandler } from '@theia/core'
import type { CommonMenus, ViewContainer as TheiaViewContainer } from '@theia/core/lib/browser'
import type { Paper, PaperDetail } from '@/hooks/usePapers'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import type { ScholarCommands as ScholarCommandsNamespace } from '@/theia/scholar-extension/src/browser/scholar-commands'
import type { ScholarContribution as ScholarContributionClass } from '@/theia/scholar-extension/src/browser/scholar-contribution'
import type { ScholarPaperWidget as ScholarPaperWidgetClass } from '@/theia/scholar-extension/src/browser/scholar-paper-widget'
import type { ScholarPaperGraphWidget as ScholarPaperGraphWidgetClass } from '@/theia/scholar-extension/src/browser/scholar-paper-graph-widget'
import type {
  ScholarLibraryTreeNode,
  ScholarLibraryWidget as ScholarLibraryWidgetClass,
} from '@/theia/scholar-extension/src/browser/scholar-side-widgets'
import type { ScholarAnnotationService as ScholarAnnotationServiceClass } from '@/theia/scholar-extension/src/browser/scholar-annotation-service'

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

let CommonMenusNs: typeof CommonMenus
let ScholarCommands: typeof ScholarCommandsNamespace
let ScholarContribution: typeof ScholarContributionClass
let ScholarAnnotationService: typeof ScholarAnnotationServiceClass
let ScholarPaperWidget: typeof ScholarPaperWidgetClass
let ScholarPaperGraphWidget: typeof ScholarPaperGraphWidgetClass
let ScholarLibraryWidget: typeof ScholarLibraryWidgetClass
let ViewContainerCtor: typeof import('@theia/core/lib/browser').ViewContainer
let SCHOLAR_LIBRARY_CONTEXT_MENU: string[]
let SCHOLAR_ANNOTATIONS_WIDGET_ID: string
let SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID: string
let SCHOLAR_PAPER_FACTORY_ID: string
let SCHOLAR_PAPER_GRAPH_FACTORY_ID: string
let SCHOLAR_SUGGESTIONS_WIDGET_ID: string
let SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID: string

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
    deletePaper: vi.fn().mockResolvedValue(undefined),
    uploadPaper: vi.fn(),
    uploadArxiv: vi.fn(),
    activatePaper: vi.fn(),
    loadLibrary: vi.fn().mockResolvedValue([]),
  }
}

function createFakePaperWidget(paperId: string, isAttached = true): ScholarPaperWidgetClass {
  const widget = Object.create(ScholarPaperWidget.prototype) as ScholarPaperWidgetClass
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
  return widget
}

function createFakeGraphWidget(paperId: string, isAttached = true): ScholarPaperGraphWidgetClass {
  const widget = Object.create(ScholarPaperGraphWidget.prototype) as ScholarPaperGraphWidgetClass
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
  return widget
}

function createForeignWidget(): ScholarLibraryWidgetClass {
  return Object.create(ScholarLibraryWidget.prototype) as ScholarLibraryWidgetClass
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
  const shell: {
    activeWidget: unknown
    onDidChangeCurrentWidget: ReturnType<typeof vi.fn>
    addWidget: ReturnType<typeof vi.fn>
    activateWidget: ReturnType<typeof vi.fn>
    getCurrentWidget: ReturnType<typeof vi.fn>
    getAreaFor: ReturnType<typeof vi.fn>
  } = {
    activeWidget: undefined,
    onDidChangeCurrentWidget: vi.fn(() => ({ dispose: () => undefined })),
    addWidget: vi.fn().mockResolvedValue(undefined),
    activateWidget: vi.fn().mockResolvedValue(undefined),
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
  const annotations = new ScholarAnnotationService()
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

  const ContributionCtor = ScholarContribution as unknown as new (
    ...args: unknown[]
  ) => ScholarContributionClass
  const contribution = new ContributionCtor(
    store,
    annotations,
    suggestions,
    widgetManager,
    shell,
    statusBar,
    messageService,
  )

  return { contribution, widgetManager, shell, statusBar, messageService }
}

describe('ScholarContribution Tooltip Drafts layout migration', () => {
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
      'Could not migrate the Tooltip Drafts layout: factory failed',
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

    await commands.handlerFor(ScholarCommands.BUILD_KNOWLEDGE_GRAPH).execute(widget)
    expect(store.buildKnowledgeGraph).toHaveBeenCalledWith('paper-a')

    await commands.handlerFor(ScholarCommands.COMPILE_PAPER).execute(foreignWidget)
    await commands.handlerFor(ScholarCommands.BUILD_KNOWLEDGE_GRAPH).execute(foreignWidget)
    expect(store.compilePaper).toHaveBeenCalledTimes(1)
    expect(store.buildKnowledgeGraph).toHaveBeenCalledTimes(1)
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

  it('registers a tab-bar toolbar item for each active-paper and library command in the navigation group', () => {
    const { contribution } = createContribution(store)
    const registry = new FakeToolbarRegistry()

    contribution.registerToolbarItems(registry as unknown as Parameters<
      ScholarContributionClass['registerToolbarItems']
    >[0])

    const ids = registry.items.map(item => item.id)
    expect(ids).toEqual([
      ScholarCommands.COMPILE_PAPER.id,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH.id,
      ScholarCommands.DELETE_PAPER.id,
      ScholarCommands.OPEN_GRAPH.id,
      ScholarCommands.REFRESH_LIBRARY.id,
      ScholarCommands.UPLOAD_LATEX.id,
      ScholarCommands.IMPORT_ARXIV.id,
      ScholarCommands.GENERATE_SUGGESTIONS.id,
      ScholarCommands.APPLY_SUGGESTIONS.id,
      ScholarCommands.CREATE_MANUAL_SUGGESTION.id,
    ])
    registry.items.forEach(item => {
      expect(item.group).toBe('navigation')
      expect(item.command).toBe(item.id)
      expect(item.onDidChange).toBeInstanceOf(Function)
    })
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

  it('shows the active paper suggestion operation in the shared status bar', async () => {
    snapshot.activePaperId = 'paper-a'
    snapshot.statusByPaperId['paper-a'] = 'Applying tooltip drafts…'
    snapshot.statusByPaperId['paper-b'] = 'Generating tooltip drafts…'
    const { contribution, statusBar } = createContribution(store)

    contribution.onStart()
    await Promise.resolve()
    expect(statusBar.setElement).toHaveBeenLastCalledWith(
      'scholar-agent.active-paper',
      expect.objectContaining({
        text: '$(sync~spin) Applying tooltip drafts…',
        tooltip: 'Applying tooltip drafts…',
      }),
    )

    snapshot.activePaperId = 'paper-b'
    const storeListener = store.subscribe.mock.calls[0][0] as () => void
    storeListener()
    await Promise.resolve()
    expect(statusBar.setElement).toHaveBeenLastCalledWith(
      'scholar-agent.active-paper',
      expect.objectContaining({
        text: '$(sync~spin) Generating tooltip drafts…',
        tooltip: 'Generating tooltip drafts…',
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

  it('registers Open, Open to the Side, Recompile, Build Knowledge Graph and Delete on the library context menu', () => {
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
      ScholarCommands.DELETE_PAPER.id,
    ])
  })
})
