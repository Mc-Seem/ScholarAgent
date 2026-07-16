import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Command, CommandHandler } from '@theia/core'
import type { ViewContainer as ViewContainerClass } from '@theia/core/lib/browser'
import type { PaperDetail } from '@/hooks/usePapers'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import type { ScholarCommands as ScholarCommandsNamespace } from '@/theia/scholar-extension/src/browser/scholar-commands'
import type { ScholarContribution as ScholarContributionClass } from '@/theia/scholar-extension/src/browser/scholar-contribution'
import type { ScholarPaperWidget as ScholarPaperWidgetClass } from '@/theia/scholar-extension/src/browser/scholar-paper-widget'
import type { ScholarLibraryWidget as ScholarLibraryWidgetClass } from '@/theia/scholar-extension/src/browser/scholar-side-widgets'
import type { ScholarAnnotationService as ScholarAnnotationServiceClass } from '@/theia/scholar-extension/src/browser/scholar-annotation-service'

const confirmDialogOpen = vi.fn<() => Promise<boolean>>()

vi.mock('@theia/core/lib/browser', async () => {
  const actual = await vi.importActual<typeof import('@theia/core/lib/browser')>(
    '@theia/core/lib/browser',
  )
  return {
    ...actual,
    ConfirmDialog: vi.fn().mockImplementation(function ConfirmDialog() {
      return { open: confirmDialogOpen }
    }),
  }
})

let ViewContainer: typeof ViewContainerClass
let ScholarCommands: typeof ScholarCommandsNamespace
let ScholarContribution: typeof ScholarContributionClass
let ScholarAnnotationService: typeof ScholarAnnotationServiceClass
let ScholarPaperWidget: typeof ScholarPaperWidgetClass
let ScholarLibraryWidget: typeof ScholarLibraryWidgetClass
let SCHOLAR_NAVIGATION_WIDGET_ID: string
let SCHOLAR_GRAPH_WIDGET_ID: string

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ViewContainer } = await import('@theia/core/lib/browser'))
  ;({ ScholarCommands } = await import(
    '@/theia/scholar-extension/src/browser/scholar-commands'
  ))
  ;({ ScholarContribution } = await import(
    '@/theia/scholar-extension/src/browser/scholar-contribution'
  ))
  ;({ ScholarAnnotationService } = await import(
    '@/theia/scholar-extension/src/browser/scholar-annotation-service'
  ))
  ;({ ScholarPaperWidget } = await import(
    '@/theia/scholar-extension/src/browser/scholar-paper-widget'
  ))
  ;({ ScholarLibraryWidget, SCHOLAR_NAVIGATION_WIDGET_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-side-widgets'
  ))
  ;({ SCHOLAR_GRAPH_WIDGET_ID } = await import(
    '@/theia/scholar-extension/src/browser/scholar-native-widgets'
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
    activatePaper: vi.fn(),
    loadLibrary: vi.fn().mockResolvedValue([]),
  }
}

function createFakePaperWidget(paperId: string): ScholarPaperWidgetClass {
  const widget = Object.create(ScholarPaperWidget.prototype) as ScholarPaperWidgetClass
  Object.defineProperty(widget, 'options', {
    value: { paperId, label: paperId },
    configurable: true,
  })
  Object.defineProperty(widget, 'close', {
    value: vi.fn(),
    configurable: true,
  })
  return widget
}

function createForeignWidget(): ScholarLibraryWidgetClass {
  return Object.create(ScholarLibraryWidget.prototype) as ScholarLibraryWidgetClass
}

function createContribution(store: ReturnType<typeof createFakeStore>) {
  const widgetManager = {
    getOrCreateWidget: vi.fn(),
  }
  const shell: {
    activeWidget: unknown
    onDidChangeCurrentWidget: ReturnType<typeof vi.fn>
    addWidget: ReturnType<typeof vi.fn>
    activateWidget: ReturnType<typeof vi.fn>
  } = {
    activeWidget: undefined,
    onDidChangeCurrentWidget: vi.fn(() => ({ dispose: () => undefined })),
    addWidget: vi.fn().mockResolvedValue(undefined),
    activateWidget: vi.fn().mockResolvedValue(undefined),
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

  const ContributionCtor = ScholarContribution as unknown as new (
    ...args: unknown[]
  ) => ScholarContributionClass
  const contribution = new ContributionCtor(
    store,
    annotations,
    widgetManager,
    shell,
    statusBar,
    messageService,
  )

  return { contribution, widgetManager, shell, statusBar, messageService }
}

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

  it('shows Compile, Build Graph, Delete and Open Graph only for a paper widget', () => {
    register()
    const paperWidget = createFakePaperWidget('paper-a')
    const foreignWidget = createForeignWidget()

    for (const command of [
      ScholarCommands.COMPILE_PAPER,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH,
      ScholarCommands.DELETE_PAPER,
      ScholarCommands.OPEN_GRAPH,
    ]) {
      const handler = commands.handlerFor(command)
      expect(handler.isVisible?.(paperWidget)).toBe(true)
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
    const { messageService } = register()
    const widget = createFakePaperWidget('paper-a')

    confirmDialogOpen.mockResolvedValueOnce(false)
    await commands.handlerFor(ScholarCommands.DELETE_PAPER).execute(widget)
    expect(store.deletePaper).not.toHaveBeenCalled()
    expect(widget.close).not.toHaveBeenCalled()
    expect(messageService.info).not.toHaveBeenCalled()

    confirmDialogOpen.mockResolvedValueOnce(true)
    await commands.handlerFor(ScholarCommands.DELETE_PAPER).execute(widget)
    expect(store.deletePaper).toHaveBeenCalledWith('paper-a')
    expect(widget.close).toHaveBeenCalledOnce()
    expect(messageService.info).toHaveBeenCalledWith('Paper deleted')
  })

  it('reports the error and skips the success message when deletion fails', async () => {
    const { messageService } = register()
    const widget = createFakePaperWidget('paper-a')
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

  it('activates the paper and reveals the graph widget when Open Graph runs', async () => {
    const { contribution, widgetManager, shell } = register()
    snapshot.papersById['paper-a'] = paperDetail('paper-a', { has_knowledge_graph: true })
    const widget = createFakePaperWidget('paper-a')

    const container = Object.create(ViewContainer.prototype) as ViewContainerClass
    Object.defineProperty(container, 'isAttached', { value: true, configurable: true })
    Object.defineProperty(container, 'id', { value: SCHOLAR_NAVIGATION_WIDGET_ID, configurable: true })
    Object.defineProperty(container, 'revealWidget', { value: vi.fn(), configurable: true })
    Object.defineProperty(container, 'activateWidget', { value: vi.fn(), configurable: true })
    widgetManager.getOrCreateWidget.mockResolvedValue(container)

    await commands.handlerFor(ScholarCommands.OPEN_GRAPH).execute(widget)

    expect(widgetManager.getOrCreateWidget).toHaveBeenCalledWith(SCHOLAR_NAVIGATION_WIDGET_ID)
    expect(store.activatePaper).toHaveBeenCalledWith('paper-a')
    expect(shell.activateWidget).toHaveBeenCalledWith(SCHOLAR_NAVIGATION_WIDGET_ID)
    expect(container.revealWidget).toHaveBeenCalledWith(SCHOLAR_GRAPH_WIDGET_ID)
    expect(container.activateWidget).toHaveBeenCalledWith(SCHOLAR_GRAPH_WIDGET_ID)
  })

  it('registers a tab-bar toolbar item for each active-paper command in the navigation group', () => {
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
})
