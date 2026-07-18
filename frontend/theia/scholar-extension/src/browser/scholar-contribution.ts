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
  SingleTextInputDialog,
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

import type { Paper, PaperDetail } from '../../../../hooks/usePapers'
import type { Tooltip } from '../../../../hooks/useTooltips'
import { readUserExpertise, writeUserExpertise } from '../../../../lib/user-expertise'
import { ensureMathJax } from './mathjax-loader'
import { ScholarCommands } from './scholar-commands'
import { navigateToPaperElement, paperLabel } from './scholar-react'
import {
  SCHOLAR_ANNOTATIONS_WIDGET_ID,
  SCHOLAR_LIBRARY_CONTEXT_MENU,
  SCHOLAR_LIBRARY_WIDGET_ID,
  SCHOLAR_NAVIGATION_WIDGET_ID,
  SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID,
  ScholarLibraryWidget,
  isScholarLibraryTreeNode,
} from './scholar-side-widgets'
import {
  SCHOLAR_PAPER_CONTEXT_MENU,
  ScholarAnnotationService,
  isScholarAnnotationTarget,
} from './scholar-annotation-service'
import {
  SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID,
  SCHOLAR_TREE_CONTEXT_MENU,
  isScholarTreeNode,
} from './scholar-native-widgets'
import {
  SCHOLAR_PAPER_FACTORY_ID,
  ScholarPaperWidget,
  type ScholarPaperWidgetOptions,
} from './scholar-paper-widget'
import {
  SCHOLAR_PAPER_GRAPH_FACTORY_ID,
  ScholarPaperGraphWidget,
  type ScholarPaperGraphWidgetOptions,
} from './scholar-paper-graph-widget'
import { ScholarSuggestionService } from './scholar-suggestion-service'
import {
  SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID,
  SCHOLAR_SUGGESTIONS_CONTEXT_MENU,
  ScholarSuggestionEditorWidget,
  ScholarSuggestionsTreeWidget,
  isScholarSuggestionTarget,
  isScholarSuggestionTreeNode,
} from './scholar-suggestion-widgets'
import { ScholarWorkspaceService } from './scholar-workspace-service'

const STATUS_BAR_ID = 'scholar-agent.active-paper'
const UPLOAD_ACCEPT = '.tar.gz,.tgz,.zip,.tex'

@injectable()
export class ScholarContribution implements
  FrontendApplicationContribution,
  CommandContribution,
  MenuContribution,
  KeybindingContribution,
  TabBarToolbarContribution {
  private readonly toDispose = new DisposableCollection()
  private readonly onToolbarItemsChangedEmitter = new Emitter<void>()
  private pendingUploadInput: HTMLInputElement | undefined
  private pendingUploadCleanup: (() => void) | undefined

  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(ScholarAnnotationService) private readonly annotations: ScholarAnnotationService,
    @inject(ScholarSuggestionService) private readonly suggestions: ScholarSuggestionService,
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
    this.toDispose.push(this.suggestions.onDidChange(() => {
      this.onToolbarItemsChangedEmitter.fire()
      const paperId = this.suggestions.getSnapshot().activePaperId
      const state = paperId ? this.suggestions.getPaperState(paperId) : undefined
      if (state?.createMode || state?.focusedId) {
        void this.showSuggestionEditor(state.createMode)
      }
    }))
    void this.updateStatusBar()
  }

  async initializeLayout(app: FrontendApplication): Promise<void> {
    const [library, navigation, annotations, tooltipDrafts] = await Promise.all([
      this.widgetManager.getOrCreateWidget(SCHOLAR_LIBRARY_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_NAVIGATION_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_ANNOTATIONS_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID),
    ])

    await app.shell.addWidget(library, { area: 'left', rank: 100 })
    await app.shell.addWidget(navigation, {
      area: 'left',
      mode: 'tab-after',
      ref: library,
    })
    await app.shell.addWidget(annotations, { area: 'right', rank: 100 })
    await app.shell.addWidget(tooltipDrafts, {
      area: 'right',
      mode: 'tab-after',
      ref: annotations,
    })
  }

  onStop(): void {
    this.pendingUploadCleanup?.()
    this.toDispose.dispose()
    void this.statusBar.removeElement(STATUS_BAR_ID)
  }

  registerCommands(commands: CommandRegistry): void {
    const isLibraryCommandVisible = (argument: unknown): boolean => argument === undefined
      || argument instanceof ScholarLibraryWidget

    commands.registerCommand(ScholarCommands.SHOW_LIBRARY, {
      execute: () => this.showView(SCHOLAR_LIBRARY_WIDGET_ID, 'left'),
    })
    commands.registerCommand(ScholarCommands.SHOW_NAVIGATION, {
      execute: () => this.showView(SCHOLAR_NAVIGATION_WIDGET_ID, 'left'),
    })
    commands.registerCommand(ScholarCommands.SHOW_ANNOTATIONS, {
      execute: () => this.showView(SCHOLAR_ANNOTATIONS_WIDGET_ID, 'right'),
    })
    commands.registerCommand(ScholarCommands.SHOW_TOOLTIP_DRAFTS, {
      execute: () => this.showView(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID, 'right'),
    })
    commands.registerCommand(ScholarCommands.REFRESH_LIBRARY, {
      execute: () => this.store.loadLibrary(),
      isVisible: isLibraryCommandVisible,
    })
    commands.registerCommand(ScholarCommands.UPLOAD_LATEX, {
      execute: () => this.uploadLatexFile(),
      isVisible: isLibraryCommandVisible,
    })
    commands.registerCommand(ScholarCommands.IMPORT_ARXIV, {
      execute: () => this.importArxiv(),
      isVisible: isLibraryCommandVisible,
    })
    commands.registerCommand(ScholarCommands.OPEN_PAPER, {
      execute: (argument: unknown) => this.openPaper(argument, false),
      isEnabled: (argument: unknown) => Boolean(this.paperIdOf(argument)),
      isVisible: (argument: unknown) => Boolean(this.paperIdOf(argument)),
    })
    commands.registerCommand(ScholarCommands.OPEN_PAPER_TO_SIDE, {
      execute: (argument: unknown) => this.openPaper(argument, true),
      isEnabled: (argument: unknown) => Boolean(this.paperIdOf(argument)),
      isVisible: (argument: unknown) => Boolean(this.paperIdOf(argument)),
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
      isVisible: (argument: unknown) => Boolean(this.paperIdOf(argument)),
    })
    commands.registerCommand(ScholarCommands.BUILD_KNOWLEDGE_GRAPH, {
      execute: (argument: unknown) => this.buildKnowledgeGraphFromWidget(argument),
      isEnabled: (argument: unknown) => this.canBuildKnowledgeGraph(argument),
      isVisible: (argument: unknown) => Boolean(this.paperIdOf(argument)),
    })
    commands.registerCommand(ScholarCommands.DELETE_PAPER, {
      execute: (argument: unknown) => this.deletePaperFromWidget(argument),
      isEnabled: (argument: unknown) => Boolean(this.paperIdOf(argument)),
      isVisible: (argument: unknown) => Boolean(this.paperIdOf(argument)),
    })
    commands.registerCommand(ScholarCommands.OPEN_GRAPH, {
      execute: (argument: unknown) => this.openGraphFromWidget(argument),
      isEnabled: (argument: unknown) => this.canOpenGraph(argument),
      isVisible: (argument: unknown) => Boolean(this.paperIdOf(argument)),
    })
    commands.registerCommand(ScholarCommands.GENERATE_SUGGESTIONS, {
      execute: (argument: unknown) => this.generateSuggestions(argument),
      isEnabled: (argument: unknown) => this.canGenerateSuggestions(argument),
      isVisible: (argument: unknown) => this.isSuggestionCommandVisible(argument),
    })
    commands.registerCommand(ScholarCommands.APPLY_SUGGESTIONS, {
      execute: (argument: unknown) => this.applySuggestions(argument),
      isEnabled: (argument: unknown) => this.canApplySuggestions(argument),
      isVisible: (argument: unknown) => this.isSuggestionCommandVisible(argument),
    })
    commands.registerCommand(ScholarCommands.CREATE_MANUAL_SUGGESTION, {
      execute: (argument: unknown) => this.beginManualSuggestion(argument),
      isEnabled: (argument: unknown) => this.canCreateManualSuggestion(argument),
      isVisible: (argument: unknown) => this.isSuggestionCommandVisible(argument),
    })
    commands.registerCommand(ScholarCommands.DELETE_SUGGESTION, {
      execute: (argument: unknown) => this.deleteSuggestion(argument),
      isEnabled: (argument: unknown) => this.canDeleteSuggestion(argument),
      isVisible: (argument: unknown) => Boolean(this.resolveSuggestionTarget(argument)),
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
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.REFRESH_LIBRARY.id,
      command: ScholarCommands.REFRESH_LIBRARY.id,
      group: 'navigation',
      priority: 10,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.UPLOAD_LATEX.id,
      command: ScholarCommands.UPLOAD_LATEX.id,
      group: 'navigation',
      priority: 20,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.IMPORT_ARXIV.id,
      command: ScholarCommands.IMPORT_ARXIV.id,
      group: 'navigation',
      priority: 30,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.GENERATE_SUGGESTIONS.id,
      command: ScholarCommands.GENERATE_SUGGESTIONS.id,
      group: 'navigation',
      priority: 10,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.APPLY_SUGGESTIONS.id,
      command: ScholarCommands.APPLY_SUGGESTIONS.id,
      group: 'navigation',
      priority: 20,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.CREATE_MANUAL_SUGGESTION.id,
      command: ScholarCommands.CREATE_MANUAL_SUGGESTION.id,
      group: 'navigation',
      priority: 30,
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
      commandId: ScholarCommands.SHOW_TOOLTIP_DRAFTS.id,
      order: 'a40',
    })
    menus.registerMenuAction(CommonMenus.EDIT_FIND, {
      commandId: ScholarCommands.FIND_IN_PAPER.id,
      order: 'a10',
    })
    menus.registerMenuAction(SCHOLAR_LIBRARY_CONTEXT_MENU, {
      commandId: ScholarCommands.OPEN_PAPER.id,
      order: 'a10',
    })
    menus.registerMenuAction(SCHOLAR_LIBRARY_CONTEXT_MENU, {
      commandId: ScholarCommands.OPEN_PAPER_TO_SIDE.id,
      order: 'a20',
    })
    menus.registerMenuAction(SCHOLAR_LIBRARY_CONTEXT_MENU, {
      commandId: ScholarCommands.COMPILE_PAPER.id,
      order: 'b10',
    })
    menus.registerMenuAction(SCHOLAR_LIBRARY_CONTEXT_MENU, {
      commandId: ScholarCommands.BUILD_KNOWLEDGE_GRAPH.id,
      order: 'b20',
    })
    menus.registerMenuAction(SCHOLAR_LIBRARY_CONTEXT_MENU, {
      commandId: ScholarCommands.DELETE_PAPER.id,
      order: 'c10',
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
    menus.registerMenuAction(SCHOLAR_SUGGESTIONS_CONTEXT_MENU, {
      commandId: ScholarCommands.DELETE_SUGGESTION.id,
      order: 'a10',
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

  /**
   * Resolves a paper id from any of the objects our paper-related commands may receive:
   * a `ScholarPaperWidget` (toolbar/command palette on an open paper), a library tree node
   * (context menu / Enter / double-click in the library), or `undefined` (command palette,
   * falling back to the active paper widget). Any other object is rejected without falling
   * back to the active paper, so foreign widgets never leak into paper actions.
   */
  private paperIdOf(argument: unknown): string | undefined {
    if (argument === undefined) {
      return this.activePaperWidget?.options.paperId
    }
    if (argument instanceof ScholarPaperWidget) {
      return argument.options.paperId
    }
    if (isScholarLibraryTreeNode(argument)) {
      return argument.paperId
    }
    return undefined
  }

  private paperOf(paperId: string): Paper | PaperDetail | undefined {
    const snapshot = this.store.getSnapshot()
    return snapshot.papersById[paperId] ?? snapshot.papers.find(paper => paper.id === paperId)
  }

  private paperTitle(paper: Paper | PaperDetail): string | undefined {
    return 'paper_metadata' in paper ? paper.paper_metadata?.title : undefined
  }

  private canCompilePaper(argument: unknown): boolean {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return false
    }
    return !this.store.getSnapshot().statusByPaperId[paperId]
  }

  private canBuildKnowledgeGraph(argument: unknown): boolean {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return false
    }
    const paper = this.paperOf(paperId)
    return Boolean(paper?.has_html) && !this.store.getSnapshot().statusByPaperId[paperId]
  }

  private canOpenGraph(argument: unknown): boolean {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return false
    }
    const paper = this.store.getSnapshot().papersById[paperId]
    return Boolean(paper?.has_knowledge_graph)
  }

  private isSuggestionCommandVisible(argument: unknown): boolean {
    if (argument !== undefined
      && !(argument instanceof ScholarSuggestionsTreeWidget)
      && !(argument instanceof ScholarSuggestionEditorWidget)
      && !isScholarSuggestionTreeNode(argument)) {
      return false
    }
    return Boolean(this.suggestionPaperIdOf(argument))
  }

  private suggestionPaperIdOf(argument: unknown): string | undefined {
    if (isScholarSuggestionTreeNode(argument)) {
      return argument.paperId
    }
    if (argument === undefined
      || argument instanceof ScholarSuggestionsTreeWidget
      || argument instanceof ScholarSuggestionEditorWidget) {
      return this.suggestions.getSnapshot().activePaperId ?? undefined
    }
    return undefined
  }

  private canGenerateSuggestions(argument: unknown): boolean {
    const paperId = this.suggestionPaperIdOf(argument)
    if (!paperId || !this.isSuggestionCommandVisible(argument)) {
      return false
    }
    const state = this.suggestions.getPaperState(paperId)
    const paper = this.store.getSnapshot().papersById[paperId]
    return Boolean(paper?.has_knowledge_graph)
      && !state.pending
      && !this.store.getSnapshot().statusByPaperId[paperId]
  }

  private canApplySuggestions(argument: unknown): boolean {
    const paperId = this.suggestionPaperIdOf(argument)
    if (!paperId || !this.isSuggestionCommandVisible(argument)) {
      return false
    }
    const state = this.suggestions.getPaperState(paperId)
    return state.checkedIds.size > 0
      && !state.pending
      && !this.store.getSnapshot().statusByPaperId[paperId]
  }

  private canCreateManualSuggestion(argument: unknown): boolean {
    const paperId = this.suggestionPaperIdOf(argument)
    return Boolean(
      paperId
      && this.isSuggestionCommandVisible(argument)
      && !this.suggestions.getPaperState(paperId).pending,
    )
  }

  private resolveSuggestionTarget(argument: unknown): {
    paperId: string
    suggestionId: string
  } | undefined {
    if (isScholarSuggestionTarget(argument)) {
      return argument
    }
    if (isScholarSuggestionTreeNode(argument) && argument.suggestionId) {
      return { paperId: argument.paperId, suggestionId: argument.suggestionId }
    }
    return undefined
  }

  private canDeleteSuggestion(argument: unknown): boolean {
    const target = this.resolveSuggestionTarget(argument)
    if (!target) {
      return false
    }
    const state = this.suggestions.getPaperState(target.paperId)
    return !state.pending
      && state.suggestions.some(suggestion => suggestion.id === target.suggestionId)
  }

  private async generateSuggestions(argument: unknown): Promise<void> {
    const paperId = this.suggestionPaperIdOf(argument)
    if (!paperId) {
      return
    }
    const dialog = new SingleTextInputDialog({
      title: 'Generate AI Tooltip Suggestions',
      initialValue: readUserExpertise(),
      confirmButtonLabel: 'Generate',
      validate: input => input.trim() ? '' : 'Expertise is required.',
    })
    const value = await dialog.open()
    const expertise = value?.trim()
    if (!expertise) {
      return
    }
    writeUserExpertise(expertise)
    try {
      const result = await this.suggestions.generateSuggestions(paperId, expertise)
      await this.messageService.info(
        `Generated ${result.suggested_count} AI tooltip suggestions`,
      )
    } catch (reason) {
      await this.messageService.error(
        `Could not generate suggestions: ${errorMessage(reason)}`,
      )
    }
  }

  private async applySuggestions(argument: unknown): Promise<void> {
    const paperId = this.suggestionPaperIdOf(argument)
    if (!paperId) {
      return
    }
    try {
      const result = await this.suggestions.applySuggestions(paperId)
      if (result.success) {
        await this.messageService.info(
          `Applied ${result.tooltips_created} tooltips to ${result.spans_injected} occurrences`,
        )
      } else {
        await this.messageService.error('The backend could not apply the selected suggestions')
      }
      for (const warning of result.errors) {
        await this.messageService.warn(warning)
      }
    } catch (reason) {
      await this.messageService.error(`Could not apply suggestions: ${errorMessage(reason)}`)
    }
  }

  private async beginManualSuggestion(argument: unknown): Promise<void> {
    const paperId = this.suggestionPaperIdOf(argument)
    if (!paperId) {
      return
    }
    this.suggestions.startManualCreation(paperId)
    await this.showSuggestionEditor(true)
  }

  private async deleteSuggestion(argument: unknown): Promise<void> {
    const target = this.resolveSuggestionTarget(argument)
    if (!target) {
      return
    }
    const confirmed = await new ConfirmDialog({
      title: 'Delete Suggestion',
      msg: 'Delete this tooltip suggestion permanently?',
      ok: 'Delete',
    }).open()
    if (!confirmed) {
      return
    }
    try {
      await this.suggestions.deleteSuggestion(target.paperId, target.suggestionId)
      await this.messageService.info('Suggestion deleted')
    } catch (reason) {
      await this.messageService.error(`Could not delete suggestion: ${errorMessage(reason)}`)
    }
  }

  private async compilePaperFromWidget(argument: unknown): Promise<void> {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return
    }
    try {
      await this.store.compilePaper(paperId)
    } catch (reason) {
      await this.messageService.error(`Could not compile paper: ${errorMessage(reason)}`)
    }
  }

  private async buildKnowledgeGraphFromWidget(argument: unknown): Promise<void> {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return
    }
    try {
      await this.store.buildKnowledgeGraph(paperId)
    } catch (reason) {
      await this.messageService.error(`Could not build knowledge graph: ${errorMessage(reason)}`)
    }
  }

  private async deletePaperFromWidget(argument: unknown): Promise<void> {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
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
      await this.store.deletePaper(paperId)
      this.closePaperWidgets(paperId)
      void this.messageService.info('Paper deleted')
    } catch (reason) {
      await this.messageService.error(`Could not delete paper: ${errorMessage(reason)}`)
    }
  }

  private closePaperWidgets(paperId: string): void {
    this.widgetManager.getWidgets(SCHOLAR_PAPER_FACTORY_ID)
      .filter((widget): widget is ScholarPaperWidget => widget instanceof ScholarPaperWidget
        && widget.options.paperId === paperId)
      .forEach(widget => widget.close())
    this.widgetManager.getWidgets(SCHOLAR_PAPER_GRAPH_FACTORY_ID)
      .filter((widget): widget is ScholarPaperGraphWidget => widget instanceof ScholarPaperGraphWidget
        && widget.options.paperId === paperId)
      .forEach(widget => widget.close())
  }

  private paperWidgetFor(paperId: string): ScholarPaperWidget | undefined {
    return this.widgetManager.getWidgets(SCHOLAR_PAPER_FACTORY_ID)
      .find((widget): widget is ScholarPaperWidget => widget instanceof ScholarPaperWidget
        && widget.options.paperId === paperId)
  }

  private async openGraphFromWidget(argument: unknown): Promise<void> {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return
    }
    await this.openGraphById(paperId)
  }

  private async openGraphById(paperId: string): Promise<void> {
    const paper = this.paperOf(paperId)
    const label = paper ? paperLabel(paper.filename, this.paperTitle(paper)) : paperId
    const options: ScholarPaperGraphWidgetOptions = { paperId }
    const widget = await this.widgetManager.getOrCreateWidget<ScholarPaperGraphWidget>(
      SCHOLAR_PAPER_GRAPH_FACTORY_ID,
      options,
    )
    widget.updateLabel(label)

    if (!widget.isAttached) {
      const reference = this.paperWidgetFor(paperId) ?? this.shell.getCurrentWidget('main')
      await this.shell.addWidget(widget, {
        area: 'main',
        mode: reference ? 'open-to-right' : 'tab-after',
        ref: reference,
      })
    }

    this.store.activatePaper(paperId)
    await this.shell.activateWidget(widget.id)
  }

  private async openPaper(argument: unknown, openToSide: boolean): Promise<void> {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return
    }
    await this.openPaperById(paperId, openToSide)
  }

  private async openPaperById(paperId: string, openToSide: boolean): Promise<void> {
    const paper = this.paperOf(paperId)
    const label = paper ? paperLabel(paper.filename, this.paperTitle(paper)) : paperId
    const options: ScholarPaperWidgetOptions = { paperId, label }
    const widget = await this.widgetManager.getOrCreateWidget<ScholarPaperWidget>(
      SCHOLAR_PAPER_FACTORY_ID,
      options,
    )

    if (!widget.isAttached) {
      const reference = openToSide ? this.shell.getCurrentWidget('main') : undefined
      await this.shell.addWidget(widget, {
        area: 'main',
        mode: openToSide && reference ? 'open-to-right' : 'tab-after',
        ref: reference,
      })
    }

    this.store.activatePaper(paperId)
    await this.shell.activateWidget(widget.id)
  }

  private async importArxiv(): Promise<void> {
    const dialog = new SingleTextInputDialog({
      title: 'Import from arXiv',
      placeholder: 'arXiv id or URL',
    })
    const value = await dialog.open()
    const trimmed = value?.trim()
    if (!trimmed) {
      return
    }
    try {
      const paper = await this.store.uploadArxiv(trimmed)
      await this.openPaperById(paper.id, false)
    } catch (reason) {
      await this.messageService.error(`Could not fetch arXiv source: ${errorMessage(reason)}`)
    }
  }

  private uploadLatexFile(): void {
    this.pendingUploadCleanup?.()

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = UPLOAD_ACCEPT
    input.style.display = 'none'
    this.pendingUploadInput = input

    const cleanup = (): void => {
      input.removeEventListener('change', onChange)
      input.removeEventListener('cancel', onCancel)
      input.remove()
      if (this.pendingUploadInput === input) {
        this.pendingUploadInput = undefined
        this.pendingUploadCleanup = undefined
      }
    }
    const onCancel = (): void => {
      cleanup()
    }
    const onChange = (): void => {
      const file = input.files?.[0]
      cleanup()
      if (!file) {
        return
      }
      void this.store.uploadPaper(file)
        .then(paper => this.openPaperById(paper.id, false))
        .catch(reason => {
          void this.messageService.error(`Could not upload paper: ${errorMessage(reason)}`)
        })
    }

    this.pendingUploadCleanup = cleanup
    input.addEventListener('change', onChange)
    input.addEventListener('cancel', onCancel)
    document.body.appendChild(input)
    input.click()
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

  private async showSuggestionEditor(activate: boolean): Promise<void> {
    const container = await this.widgetManager.getOrCreateWidget(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID)
    if (!container.isAttached) {
      await this.shell.addWidget(container, { area: 'right' })
    }
    if (activate) {
      await this.shell.activateWidget(container.id)
    }
    if (container instanceof ViewContainer) {
      container.revealWidget(SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID)
      if (activate) {
        container.activateWidget(SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID)
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