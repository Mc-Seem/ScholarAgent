import {
  CommandContribution,
  CommandRegistry,
  Disposable,
  DisposableCollection,
  Emitter,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core'
import {
  ApplicationShell,
  CommonMenus,
  ConfirmDialog,
  FrontendApplication,
  FrontendApplicationContribution,
  KeybindingContribution,
  KeybindingRegistry,
  StatusBar,
  StatusBarAlignment,
  ViewContainer,
  WidgetManager,
} from '@theia/core/lib/browser'
import {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { inject, injectable } from '@theia/core/shared/inversify'

import type { Tooltip } from '../../../../hooks/useTooltips'
import { ensureMathJax } from './mathjax-loader'
import { ScholarCommands } from './scholar-commands'
import { navigateToPaperElement, paperLabel } from './scholar-react'
import {
  SCHOLAR_ANNOTATIONS_WIDGET_ID,
  SCHOLAR_LIBRARY_WIDGET_ID,
  SCHOLAR_NAVIGATION_WIDGET_ID,
} from './scholar-side-widgets'
import {
  SCHOLAR_PAPER_CONTEXT_MENU,
  ScholarAnnotationService,
  isScholarAnnotationTarget,
} from './scholar-annotation-service'
import {
  SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID,
  SCHOLAR_GRAPH_WIDGET_ID,
  SCHOLAR_TREE_CONTEXT_MENU,
  isScholarTreeNode,
} from './scholar-native-widgets'
import { ScholarPaperWidget } from './scholar-paper-widget'
import { ScholarWorkspaceService } from './scholar-workspace-service'

const STATUS_BAR_ID = 'scholar-agent.active-paper'

@injectable()
export class ScholarContribution implements
  FrontendApplicationContribution,
  CommandContribution,
  MenuContribution,
  KeybindingContribution,
  TabBarToolbarContribution {
  private readonly toDispose = new DisposableCollection()
  private readonly onToolbarItemsChangedEmitter = new Emitter<void>()

  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(ScholarAnnotationService) private readonly annotations: ScholarAnnotationService,
    @inject(WidgetManager) private readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) private readonly shell: ApplicationShell,
    @inject(StatusBar) private readonly statusBar: StatusBar,
    @inject(MessageService) private readonly messageService: MessageService,
  ) {
    this.toDispose.push(this.onToolbarItemsChangedEmitter)
  }

  initialize(): void {
    ensureMathJax()
  }

  onStart(): void {
    void this.store.initialize().catch(error => {
      void this.messageService.warn(`Backend is not available: ${errorMessage(error)}`)
    })

    this.toDispose.push(this.shell.onDidChangeCurrentWidget(({ newValue }) => {
      if (newValue instanceof ScholarPaperWidget) {
        this.store.activatePaper(newValue.options.paperId)
      }
    }))
    this.toDispose.push(Disposable.create(this.store.subscribe(() => {
      void this.updateStatusBar()
      this.onToolbarItemsChangedEmitter.fire()
    })))
    this.toDispose.push(this.annotations.onDidChange(() => {
      const activate = Boolean(this.annotations.currentDraft)
      if (activate || this.annotations.currentSelection) {
        void this.showAnnotationEditor(activate)
      }
    }))
    void this.updateStatusBar()
  }

  async initializeLayout(app: FrontendApplication): Promise<void> {
    const [library, navigation, annotations] = await Promise.all([
      this.widgetManager.getOrCreateWidget(SCHOLAR_LIBRARY_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_NAVIGATION_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_ANNOTATIONS_WIDGET_ID),
    ])

    await app.shell.addWidget(library, { area: 'left', rank: 100 })
    await app.shell.addWidget(navigation, {
      area: 'left',
      mode: 'tab-after',
      ref: library,
    })
    await app.shell.addWidget(annotations, { area: 'right', rank: 100 })
  }

  onStop(): void {
    this.toDispose.dispose()
    void this.statusBar.removeElement(STATUS_BAR_ID)
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(ScholarCommands.SHOW_LIBRARY, {
      execute: () => this.showView(SCHOLAR_LIBRARY_WIDGET_ID, 'left'),
    })
    commands.registerCommand(ScholarCommands.SHOW_NAVIGATION, {
      execute: () => this.showView(SCHOLAR_NAVIGATION_WIDGET_ID, 'left'),
    })
    commands.registerCommand(ScholarCommands.SHOW_ANNOTATIONS, {
      execute: () => this.showView(SCHOLAR_ANNOTATIONS_WIDGET_ID, 'right'),
    })
    commands.registerCommand(ScholarCommands.REFRESH_LIBRARY, {
      execute: () => this.store.loadLibrary(),
    })
    commands.registerCommand(ScholarCommands.FIND_IN_PAPER, {
      execute: () => this.activePaperWidget?.openSearch(),
      isEnabled: () => Boolean(this.activePaperWidget),
      isVisible: () => Boolean(this.activePaperWidget),
    })
    commands.registerCommand(ScholarCommands.ADD_ANNOTATION, {
      execute: (argument: unknown) => {
        if (isScholarAnnotationTarget(argument)) {
          this.annotations.create(
            argument.paperId,
            argument.domNodeId,
            argument.targetText,
          )
        }
      },
      isEnabled: isScholarAnnotationTarget,
      isVisible: isScholarAnnotationTarget,
    })
    commands.registerCommand(ScholarCommands.EDIT_ANNOTATION, {
      execute: (argument: unknown) => this.editAnnotation(argument),
      isEnabled: (argument: unknown) => Boolean(this.resolveTooltip(argument)),
      isVisible: (argument: unknown) => Boolean(this.resolveTooltip(argument)),
    })
    commands.registerCommand(ScholarCommands.TOGGLE_ANNOTATION_PIN, {
      execute: (argument: unknown) => this.toggleAnnotationPin(argument),
      isEnabled: (argument: unknown) => Boolean(this.resolveTooltip(argument)),
      isVisible: (argument: unknown) => isScholarTreeNode(argument)
        && Boolean(argument.entry.tooltipId),
    })
    commands.registerCommand(ScholarCommands.OPEN_ANNOTATION, {
      execute: (argument: unknown) => {
        const location = this.resolveAnnotationLocation(argument)
        if (location) {
          navigateToPaperElement(location.paperId, location.sourceId)
        }
      },
      isEnabled: (argument: unknown) => Boolean(this.resolveAnnotationLocation(argument)),
      isVisible: (argument: unknown) => Boolean(this.resolveAnnotationLocation(argument)),
    })
    commands.registerCommand(ScholarCommands.DELETE_ANNOTATION, {
      execute: (argument: unknown) => this.deleteAnnotation(argument),
      isEnabled: (argument: unknown) => Boolean(this.resolveTooltip(argument)),
      isVisible: (argument: unknown) => isScholarTreeNode(argument)
        && Boolean(argument.entry.tooltipId),
    })
    commands.registerCommand(ScholarCommands.REMOVE_ANNOTATION_OCCURRENCE, {
      execute: (argument: unknown) => this.removeAnnotationOccurrence(argument),
      isEnabled: (argument: unknown) => isScholarAnnotationTarget(argument)
        && Boolean(argument.semanticTooltipId),
      isVisible: (argument: unknown) => isScholarAnnotationTarget(argument)
        && Boolean(argument.semanticTooltipId),
    })
    commands.registerCommand(ScholarCommands.COMPILE_PAPER, {
      execute: (argument: unknown) => this.compilePaperFromWidget(argument),
      isEnabled: (argument: unknown) => this.canCompilePaper(argument),
      isVisible: (argument: unknown) => Boolean(this.paperWidgetOf(argument)),
    })
    commands.registerCommand(ScholarCommands.BUILD_KNOWLEDGE_GRAPH, {
      execute: (argument: unknown) => this.buildKnowledgeGraphFromWidget(argument),
      isEnabled: (argument: unknown) => this.canBuildKnowledgeGraph(argument),
      isVisible: (argument: unknown) => Boolean(this.paperWidgetOf(argument)),
    })
    commands.registerCommand(ScholarCommands.DELETE_PAPER, {
      execute: (argument: unknown) => this.deletePaperFromWidget(argument),
      isEnabled: (argument: unknown) => Boolean(this.paperWidgetOf(argument)),
      isVisible: (argument: unknown) => Boolean(this.paperWidgetOf(argument)),
    })
    commands.registerCommand(ScholarCommands.OPEN_GRAPH, {
      execute: (argument: unknown) => this.openGraphFromWidget(argument),
      isEnabled: (argument: unknown) => this.canOpenGraph(argument),
      isVisible: (argument: unknown) => Boolean(this.paperWidgetOf(argument)),
    })
  }

  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.COMPILE_PAPER.id,
      command: ScholarCommands.COMPILE_PAPER.id,
      group: 'navigation',
      priority: 10,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.BUILD_KNOWLEDGE_GRAPH.id,
      command: ScholarCommands.BUILD_KNOWLEDGE_GRAPH.id,
      group: 'navigation',
      priority: 20,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.DELETE_PAPER.id,
      command: ScholarCommands.DELETE_PAPER.id,
      group: 'navigation',
      priority: 30,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.OPEN_GRAPH.id,
      command: ScholarCommands.OPEN_GRAPH.id,
      group: 'navigation',
      priority: 40,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.SHOW_LIBRARY.id,
      order: 'a10',
    })
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.SHOW_NAVIGATION.id,
      order: 'a20',
    })
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.SHOW_ANNOTATIONS.id,
      order: 'a30',
    })
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.REFRESH_LIBRARY.id,
      order: 'b10',
    })
    menus.registerMenuAction(CommonMenus.EDIT_FIND, {
      commandId: ScholarCommands.FIND_IN_PAPER.id,
      order: 'a10',
    })
    menus.registerMenuAction(SCHOLAR_PAPER_CONTEXT_MENU, {
      commandId: ScholarCommands.ADD_ANNOTATION.id,
      order: 'a10',
    })
    menus.registerMenuAction(SCHOLAR_PAPER_CONTEXT_MENU, {
      commandId: ScholarCommands.EDIT_ANNOTATION.id,
      order: 'a20',
    })
    menus.registerMenuAction(SCHOLAR_PAPER_CONTEXT_MENU, {
      commandId: ScholarCommands.REMOVE_ANNOTATION_OCCURRENCE.id,
      order: 'b10',
    })
    menus.registerMenuAction(SCHOLAR_TREE_CONTEXT_MENU, {
      commandId: ScholarCommands.OPEN_ANNOTATION.id,
      order: 'a07',
    })
    menus.registerMenuAction(SCHOLAR_TREE_CONTEXT_MENU, {
      commandId: ScholarCommands.EDIT_ANNOTATION.id,
      order: 'a10',
    })
    menus.registerMenuAction(SCHOLAR_TREE_CONTEXT_MENU, {
      commandId: ScholarCommands.TOGGLE_ANNOTATION_PIN.id,
      order: 'a20',
    })
    menus.registerMenuAction(SCHOLAR_TREE_CONTEXT_MENU, {
      commandId: ScholarCommands.DELETE_ANNOTATION.id,
      order: 'b10',
    })
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: ScholarCommands.SHOW_LIBRARY.id,
      keybinding: 'alt+shift+p',
    })
    keybindings.registerKeybinding({
      command: ScholarCommands.SHOW_NAVIGATION.id,
      keybinding: 'alt+shift+n',
    })
    keybindings.registerKeybinding({
      command: ScholarCommands.SHOW_ANNOTATIONS.id,
      keybinding: 'alt+shift+a',
    })
    keybindings.registerKeybinding({
      command: ScholarCommands.FIND_IN_PAPER.id,
      keybinding: 'ctrlcmd+f',
    })
  }

  private get activePaperWidget(): ScholarPaperWidget | undefined {
    return this.shell.activeWidget instanceof ScholarPaperWidget
      ? this.shell.activeWidget
      : undefined
  }

  private paperWidgetOf(argument: unknown): ScholarPaperWidget | undefined {
    if (argument === undefined) {
      return this.activePaperWidget
    }
    return argument instanceof ScholarPaperWidget ? argument : undefined
  }

  private canCompilePaper(argument: unknown): boolean {
    const widget = this.paperWidgetOf(argument)
    if (!widget) {
      return false
    }
    return !this.store.getSnapshot().statusByPaperId[widget.options.paperId]
  }

  private canBuildKnowledgeGraph(argument: unknown): boolean {
    const widget = this.paperWidgetOf(argument)
    if (!widget) {
      return false
    }
    const snapshot = this.store.getSnapshot()
    const paper = snapshot.papersById[widget.options.paperId]
    return Boolean(paper?.has_html) && !snapshot.statusByPaperId[widget.options.paperId]
  }

  private canOpenGraph(argument: unknown): boolean {
    const widget = this.paperWidgetOf(argument)
    if (!widget) {
      return false
    }
    const paper = this.store.getSnapshot().papersById[widget.options.paperId]
    return Boolean(paper?.has_knowledge_graph)
  }

  private async compilePaperFromWidget(argument: unknown): Promise<void> {
    const widget = this.paperWidgetOf(argument)
    if (!widget) {
      return
    }
    try {
      await this.store.compilePaper(widget.options.paperId)
    } catch (reason) {
      await this.messageService.error(`Could not compile paper: ${errorMessage(reason)}`)
    }
  }

  private async buildKnowledgeGraphFromWidget(argument: unknown): Promise<void> {
    const widget = this.paperWidgetOf(argument)
    if (!widget) {
      return
    }
    try {
      await this.store.buildKnowledgeGraph(widget.options.paperId)
    } catch (reason) {
      await this.messageService.error(`Could not build knowledge graph: ${errorMessage(reason)}`)
    }
  }

  private async deletePaperFromWidget(argument: unknown): Promise<void> {
    const widget = this.paperWidgetOf(argument)
    if (!widget) {
      return
    }
    const confirmed = await new ConfirmDialog({
      title: 'Delete Paper',
      msg: 'Delete this paper and all its annotations?',
      ok: 'Delete',
    }).open()
    if (!confirmed) {
      return
    }
    try {
      await this.store.deletePaper(widget.options.paperId)
      widget.close()
      void this.messageService.info('Paper deleted')
    } catch (reason) {
      await this.messageService.error(`Could not delete paper: ${errorMessage(reason)}`)
    }
  }

  private async openGraphFromWidget(argument: unknown): Promise<void> {
    const widget = this.paperWidgetOf(argument)
    if (!widget) {
      return
    }
    this.store.activatePaper(widget.options.paperId)
    await this.revealGraph()
  }

  private async revealGraph(): Promise<void> {
    const container = await this.widgetManager.getOrCreateWidget(SCHOLAR_NAVIGATION_WIDGET_ID)
    if (!container.isAttached) {
      await this.shell.addWidget(container, { area: 'left' })
    }
    await this.shell.activateWidget(container.id)
    if (container instanceof ViewContainer) {
      container.revealWidget(SCHOLAR_GRAPH_WIDGET_ID)
      container.activateWidget(SCHOLAR_GRAPH_WIDGET_ID)
    }
  }

  private resolveTooltip(argument: unknown): { paperId: string; tooltip: Tooltip } | undefined {
    const snapshot = this.store.getSnapshot()
    const paperId = isScholarAnnotationTarget(argument)
      ? argument.paperId
      : snapshot.activePaperId
    if (!paperId) {
      return undefined
    }
    const tooltipId = isScholarAnnotationTarget(argument)
      ? argument.tooltipIds[0]
      : isScholarTreeNode(argument)
        ? argument.entry.tooltipId
        : undefined
    const tooltip = snapshot.tooltipsByPaperId[paperId]?.find(item => item.id === tooltipId)
    return tooltip ? { paperId, tooltip } : undefined
  }

  private resolveAnnotationLocation(
    argument: unknown,
  ): { paperId: string; sourceId: string } | undefined {
    const paperId = isScholarAnnotationTarget(argument)
      ? argument.paperId
      : this.store.getSnapshot().activePaperId
    const sourceId = isScholarAnnotationTarget(argument)
      ? argument.domNodeId
      : isScholarTreeNode(argument)
        ? argument.entry.sourceId
        : undefined
    return paperId && sourceId ? { paperId, sourceId } : undefined
  }

  private editAnnotation(argument: unknown): void {
    const resolved = this.resolveTooltip(argument)
    if (resolved) {
      this.annotations.edit(
        resolved.paperId,
        resolved.tooltip.id,
        resolved.tooltip.content,
        resolved.tooltip.target_text ?? undefined,
      )
    }
  }

  private async toggleAnnotationPin(argument: unknown): Promise<void> {
    const resolved = this.resolveTooltip(argument)
    if (!resolved) {
      return
    }
    try {
      await this.store.updateTooltip(resolved.paperId, resolved.tooltip.id, {
        content: resolved.tooltip.content,
        targetText: resolved.tooltip.target_text ?? undefined,
        isPinned: !resolved.tooltip.is_pinned,
      })
    } catch (reason) {
      await this.messageService.error(`Could not update annotation: ${errorMessage(reason)}`)
    }
  }

  private async deleteAnnotation(argument: unknown): Promise<void> {
    const resolved = this.resolveTooltip(argument)
    if (!resolved) {
      return
    }
    const confirmed = await new ConfirmDialog({
      title: 'Delete Annotation',
      msg: 'Delete this annotation permanently?',
      ok: 'Delete',
    }).open()
    if (!confirmed) {
      return
    }
    try {
      await this.store.deleteTooltip(resolved.paperId, resolved.tooltip.id)
      if (this.annotations.currentDraft?.tooltipId === resolved.tooltip.id
        || this.annotations.currentSelection?.tooltipId === resolved.tooltip.id) {
        this.annotations.clear()
      }
    } catch (reason) {
      await this.messageService.error(`Could not delete annotation: ${errorMessage(reason)}`)
    }
  }

  private async removeAnnotationOccurrence(argument: unknown): Promise<void> {
    if (!isScholarAnnotationTarget(argument) || !argument.semanticTooltipId) {
      return
    }
    try {
      await this.store.removeTooltipOccurrence(
        argument.paperId,
        argument.semanticTooltipId,
        argument.domNodeId,
      )
    } catch (reason) {
      await this.messageService.error(`Could not remove annotation occurrence: ${errorMessage(reason)}`)
    }
  }

  private async showAnnotationEditor(activate: boolean): Promise<void> {
    const container = await this.widgetManager.getOrCreateWidget(SCHOLAR_ANNOTATIONS_WIDGET_ID)
    if (!container.isAttached) {
      await this.shell.addWidget(container, { area: 'right' })
    }
    if (activate) {
      await this.shell.activateWidget(container.id)
    }
    if (container instanceof ViewContainer) {
      container.revealWidget(SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID)
      if (activate) {
        container.activateWidget(SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID)
      }
    }
  }

  private async showView(
    widgetId: string,
    area: 'left' | 'right',
  ): Promise<void> {
    const widget = await this.widgetManager.getOrCreateWidget(widgetId)
    if (!widget.isAttached) {
      await this.shell.addWidget(widget, { area })
    }
    await this.shell.activateWidget(widget.id)
  }

  private async updateStatusBar(): Promise<void> {
    const snapshot = this.store.getSnapshot()
    const paperId = snapshot.activePaperId
    const paper = paperId ? snapshot.papersById[paperId] : undefined
    const status = paperId ? snapshot.statusByPaperId[paperId] : undefined
    const error = paperId ? snapshot.paperErrors[paperId] : undefined
    const label = paper
      ? paperLabel(paper.filename, paper.paper_metadata?.title)
      : paperId

    await this.statusBar.setElement(STATUS_BAR_ID, {
      text: status
        ? `$(sync~spin) ${status}`
        : error
          ? `$(error) ${error}`
        : label
          ? `$(book) ${label}`
          : '$(book) Scholar Agent',
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      tooltip: status || error || label || 'Scholar Agent paper reader',
      command: ScholarCommands.SHOW_LIBRARY.id,
    })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}