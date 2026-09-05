import * as React from 'react'

import {
  CommandContribution,
  CommandRegistry,
  Disposable,
  DisposableCollection,
  Emitter,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
  SelectionService,
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
import {
  QuickInputService,
  type QuickPickItem,
  type QuickPickSeparator,
} from '@theia/core/lib/browser/quick-input/quick-input-service'
import { inject, injectable, optional } from '@theia/core/shared/inversify'

import type { Paper, PaperDetail } from '../../../../hooks/usePapers'
import type { Tooltip } from '../../../../hooks/useTooltips'
import type { LlmWorkflow } from '../../../../lib/llm-settings-api'
import type { ReferenceSuggestion, ReferenceSuggestionsResult } from '../../../../lib/reading-set-api'
import { readUserExpertise, writeUserExpertise } from '../../../../lib/user-expertise'
import { ensureMathJax } from './mathjax-loader'
import { ScholarCommands } from './scholar-commands'
import { ScholarLlmSettingsService } from './scholar-llm-settings-service'
import {
  SCHOLAR_LLM_SETTINGS_WIDGET_ID,
  ScholarLlmSettingsWidget,
} from './scholar-llm-settings-widget'
import { ScholarGraphSelection } from './scholar-graph-selection'
import { navigateToPaperElement, paperLabel } from './scholar-react'
import { ScholarTextareaDialog } from './scholar-textarea-dialog'
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
import { ScholarReadingSetService } from './scholar-reading-set-service'
import { SharedTermHighlighter } from './scholar-shared-term-highlighter'
import {
  SCHOLAR_READING_SET_CONTEXT_MENU,
  SCHOLAR_READING_SETS_WIDGET_ID,
  ScholarReadingSetWidget,
  isScholarReadingSetPaperTreeNode,
  isScholarReadingSetTreeNode,
  linkTermsDescription,
} from './scholar-reading-set-widget'
import {
  SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID,
  SCHOLAR_OUTLINE_WIDGET_ID,
  SCHOLAR_TREE_CONTEXT_MENU,
  isScholarTreeNode,
} from './scholar-native-widgets'
import {
  SCHOLAR_PAPER_FACTORY_ID,
  ScholarPaperWidget,
  type ScholarPaperWidgetOptions,
} from './scholar-paper-widget'
import {
  SCHOLAR_PAPER_FIND_TOOLBAR_ID,
  ScholarPaperFindToolbar,
} from './scholar-paper-find-toolbar'
import {
  SCHOLAR_PAPER_GRAPH_FACTORY_ID,
  ScholarPaperGraphWidget,
  type ScholarPaperGraphWidgetOptions,
} from './scholar-paper-graph-widget'
import { SCHOLAR_SEMANTIC_LENS_WIDGET_ID } from './scholar-semantic-lens-widget'
import { SCHOLAR_CHAT_WIDGET_ID } from './scholar-chat-widget'
import { ScholarChatService } from './scholar-chat-service'
import { ScholarSuggestionService } from './scholar-suggestion-service'
import {
  SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID,
  SCHOLAR_SUGGESTIONS_CONTEXT_MENU,
  SCHOLAR_SUGGESTIONS_WIDGET_ID,
  ScholarSuggestionEditorWidget,
  ScholarSuggestionsTreeWidget,
  isScholarSuggestionTarget,
  isScholarSuggestionTreeNode,
} from './scholar-suggestion-widgets'
import { ScholarWorkspaceService } from './scholar-workspace-service'
import { ScholarArxivImportDialog } from './scholar-arxiv-import-dialog'

const STATUS_BAR_ID = 'scholar-agent.active-paper'
const GRAPH_STATUS_BAR_ID = 'scholar-agent.graph-status'
const READING_SET_STATUS_BAR_ID = 'scholar-agent.reading-set-status'
const UPLOAD_ACCEPT = '.tar.gz,.tgz,.zip,.tex'
// Keeps the reading lens above the authoring views in the right side bar.
const SEMANTIC_LENS_RANK = 90
const CHAT_RANK = 80

interface GraphSearchQuickPickItem extends QuickPickItem {
  id: string
}

interface GraphFilterQuickPickItem extends QuickPickItem {
  filterKind: 'node' | 'edge'
  filterType: string
}

interface ReadingSetQuickPickItem extends QuickPickItem {
  id: string
}

interface ReferenceSuggestionQuickPickItem extends QuickPickItem {
  suggestion: ReferenceSuggestion
}

@injectable()
export class ScholarContribution implements
  FrontendApplicationContribution,
  CommandContribution,
  MenuContribution,
  KeybindingContribution,
  TabBarToolbarContribution {
  private readonly toDispose = new DisposableCollection()
  private readonly onToolbarItemsChangedEmitter = new Emitter<void>()
  private activePaperSearchWidgetSubscription: Disposable = Disposable.create(() => undefined)
  private boundPaperSearchWidget: ScholarPaperWidget | undefined
  private activeGraphWidgetSubscription: Disposable = Disposable.create(() => undefined)
  private boundGraphWidget: ScholarPaperGraphWidget | undefined
  private pendingUploadInput: HTMLInputElement | undefined
  private pendingUploadCleanup: (() => void) | undefined
  private semanticLensReveal: Promise<void> = Promise.resolve()
  private readonly sharedTermHighlighter = new SharedTermHighlighter()

  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(ScholarAnnotationService) private readonly annotations: ScholarAnnotationService,
    @inject(ScholarReadingSetService) private readonly readingSets: ScholarReadingSetService,
    @inject(ScholarSuggestionService) private readonly suggestions: ScholarSuggestionService,
    @inject(ScholarLlmSettingsService) private readonly llmSettings: ScholarLlmSettingsService,
    @inject(WidgetManager) private readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) private readonly shell: ApplicationShell,
    @inject(StatusBar) private readonly statusBar: StatusBar,
    @inject(MessageService) private readonly messageService: MessageService,
    @inject(QuickInputService) private readonly quickInputService: QuickInputService,
    @inject(SelectionService) private readonly selectionService: SelectionService,
    @inject(ScholarChatService) @optional() private readonly chat?: ScholarChatService,
  ) {
    this.toDispose.push(this.onToolbarItemsChangedEmitter)
    this.toDispose.push(Disposable.create(() => this.activePaperSearchWidgetSubscription.dispose()))
    this.toDispose.push(Disposable.create(() => this.activeGraphWidgetSubscription.dispose()))
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
      this.bindActivePaperSearchWidget(newValue)
      this.bindActiveGraphWidget(newValue)
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
    this.toDispose.push(this.llmSettings.onDidChange(() => {
      this.onToolbarItemsChangedEmitter.fire()
    }))
    this.toDispose.push(Disposable.create(this.readingSets.subscribe(() => {
      this.updateReadingSetStatusBar()
      this.onToolbarItemsChangedEmitter.fire()
    })))
    this.toDispose.push(this.selectionService.onSelectionChanged(selection => {
      if (ScholarGraphSelection.is(selection)) {
        void this.revealSemanticLens()
      }
    }))
    void this.updateStatusBar()
    this.bindActivePaperSearchWidget(this.shell.activeWidget)
    this.bindActiveGraphWidget(this.shell.activeWidget)
  }

  async initializeLayout(app: FrontendApplication): Promise<void> {
    const [library, readingSets, navigation, chat, semanticLens, annotations, tooltipDrafts] = await Promise.all([
      this.widgetManager.getOrCreateWidget(SCHOLAR_LIBRARY_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_READING_SETS_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_NAVIGATION_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_CHAT_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_SEMANTIC_LENS_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_ANNOTATIONS_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID),
    ])

    await app.shell.addWidget(library, { area: 'left', rank: 100 })
    await app.shell.addWidget(readingSets, {
      area: 'left',
      mode: 'tab-after',
      ref: library,
    })
    await app.shell.addWidget(navigation, {
      area: 'left',
      mode: 'tab-after',
      ref: readingSets,
    })
    await app.shell.addWidget(chat, { area: 'right', rank: CHAT_RANK })
    await app.shell.addWidget(semanticLens, { area: 'right', rank: SEMANTIC_LENS_RANK })
    await app.shell.addWidget(annotations, { area: 'right', rank: 100 })
    await app.shell.addWidget(tooltipDrafts, {
      area: 'right',
      mode: 'tab-after',
      ref: annotations,
    })
    await app.shell.activateWidget(chat.id)
  }

  async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
    try {
      await this.migrateLegacyTooltipDraftsLayout(app)
    } catch (reason) {
      await this.messageService.warn(
        `Could not migrate the Term Highlights layout: ${errorMessage(reason)}`,
      )
    }
    try {
      await this.migratePreChatLayout(app)
    } catch (reason) {
      await this.messageService.warn(
        `Could not migrate the Chat layout: ${errorMessage(reason)}`,
      )
    }
    try {
      await this.migrateReadingSetsLayout(app)
    } catch (reason) {
      await this.messageService.warn(
        `Could not migrate the Reading Sets layout: ${errorMessage(reason)}`,
      )
    }
  }

  onStop(): void {
    this.pendingUploadCleanup?.()
    this.toDispose.dispose()
    void this.statusBar.removeElement(STATUS_BAR_ID)
    void this.statusBar.removeElement(GRAPH_STATUS_BAR_ID)
    void this.statusBar.removeElement(READING_SET_STATUS_BAR_ID)
  }

  registerCommands(commands: CommandRegistry): void {
    const isLibraryCommandVisible = (argument: unknown): boolean => argument === undefined
      || argument instanceof ScholarLibraryWidget
    const isReadingSetsCommandVisible = (argument: unknown): boolean => argument === undefined
      || argument instanceof ScholarReadingSetWidget
    const isLlmSettingsCommandVisible = (argument: unknown): boolean => argument === undefined
      || argument instanceof ScholarLlmSettingsWidget

    commands.registerCommand(ScholarCommands.SHOW_LIBRARY, {
      execute: () => this.showView(SCHOLAR_LIBRARY_WIDGET_ID, 'left'),
    })
    commands.registerCommand(ScholarCommands.SHOW_NAVIGATION, {
      execute: () => this.showView(SCHOLAR_NAVIGATION_WIDGET_ID, 'left'),
    })
    commands.registerCommand(ScholarCommands.SHOW_SEMANTIC_LENS, {
      execute: () => this.showView(SCHOLAR_SEMANTIC_LENS_WIDGET_ID, 'right'),
    })
    commands.registerCommand(ScholarCommands.SHOW_CHAT, {
      execute: () => this.showView(SCHOLAR_CHAT_WIDGET_ID, 'right'),
    })
    commands.registerCommand(ScholarCommands.SHOW_ANNOTATIONS, {
      execute: () => this.showView(SCHOLAR_ANNOTATIONS_WIDGET_ID, 'right'),
    })
    commands.registerCommand(ScholarCommands.SHOW_READING_SETS, {
      execute: () => this.showView(SCHOLAR_READING_SETS_WIDGET_ID, 'left'),
    })
    commands.registerCommand(ScholarCommands.CREATE_READING_SET, {
      execute: () => this.createReadingSet(),
      isVisible: isReadingSetsCommandVisible,
    })
    commands.registerCommand(ScholarCommands.REFRESH_READING_SETS, {
      execute: () => this.readingSets.refresh(),
      isVisible: isReadingSetsCommandVisible,
    })
    commands.registerCommand(ScholarCommands.RENAME_READING_SET, {
      execute: (argument: unknown) => this.renameReadingSetFromWidget(argument),
      isEnabled: isScholarReadingSetTreeNode,
      isVisible: isScholarReadingSetTreeNode,
    })
    commands.registerCommand(ScholarCommands.DELETE_READING_SET, {
      execute: (argument: unknown) => this.deleteReadingSetFromWidget(argument),
      isEnabled: isScholarReadingSetTreeNode,
      isVisible: isScholarReadingSetTreeNode,
    })
    commands.registerCommand(ScholarCommands.ADD_PAPER_TO_READING_SET, {
      execute: (argument: unknown) => this.addPaperToReadingSet(argument),
      isEnabled: (argument: unknown) => Boolean(this.paperIdOf(argument)),
      isVisible: (argument: unknown) => Boolean(this.paperIdOf(argument))
        && !isScholarReadingSetPaperTreeNode(argument),
    })
    commands.registerCommand(ScholarCommands.REMOVE_PAPER_FROM_READING_SET, {
      execute: (argument: unknown) => this.removePaperFromReadingSet(argument),
      isEnabled: isScholarReadingSetPaperTreeNode,
      isVisible: isScholarReadingSetPaperTreeNode,
    })
    commands.registerCommand(ScholarCommands.LINK_READING_SET_TERMS, {
      execute: (argument: unknown) => this.linkReadingSetTerms(argument),
      isEnabled: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        && !this.readingSets.isLinkingTerms(argument.readingSetId),
      isVisible: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        && !this.readingSets.isLinkingTerms(argument.readingSetId),
    })
    commands.registerCommand(ScholarCommands.STOP_READING_SET_TERMS, {
      execute: (argument: unknown) => this.stopReadingSetTerms(argument),
      isEnabled: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        && this.readingSets.isLinkingTerms(argument.readingSetId),
      isVisible: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        && this.readingSets.isLinkingTerms(argument.readingSetId),
    })
    commands.registerCommand(ScholarCommands.CONFIRM_ALL_READING_SET_TERMS, {
      execute: (argument: unknown) => this.bulkReviewReadingSetTerms(argument, 'confirm'),
      isEnabled: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        && !this.readingSets.isLinkingTerms(argument.readingSetId),
      isVisible: isScholarReadingSetTreeNode,
    })
    commands.registerCommand(ScholarCommands.REJECT_ALL_READING_SET_TERMS, {
      execute: (argument: unknown) => this.bulkReviewReadingSetTerms(argument, 'reject'),
      isEnabled: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        && !this.readingSets.isLinkingTerms(argument.readingSetId),
      isVisible: isScholarReadingSetTreeNode,
    })
    commands.registerCommand(ScholarCommands.SUGGEST_READING_SET_REFERENCES, {
      execute: (argument: unknown) => this.suggestReadingSetReferences(argument),
      isEnabled: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        || isReadingSetsCommandVisible(argument),
      isVisible: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        || isReadingSetsCommandVisible(argument),
    })
    commands.registerCommand(ScholarCommands.OPEN_READING_SET_CHAT, {
      execute: (argument: unknown) => this.openReadingSetChat(argument),
      isEnabled: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        || isReadingSetsCommandVisible(argument),
      isVisible: (argument: unknown) => isScholarReadingSetTreeNode(argument)
        || isReadingSetsCommandVisible(argument),
    })
    commands.registerCommand(ScholarCommands.HIGHLIGHT_SHARED_TERMS, {
      execute: () => this.toggleSharedTermHighlights(),
      isEnabled: () => this.canHighlightSharedTerms(),
    })
    commands.registerCommand(ScholarCommands.SHOW_TOOLTIP_DRAFTS, {
      execute: () => this.showView(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID, 'right'),
    })
    commands.registerCommand(ScholarCommands.OPEN_LLM_SETTINGS, {
      execute: () => this.showLlmSettings(),
    })
    commands.registerCommand(ScholarCommands.SAVE_LLM_SETTINGS, {
      execute: () => this.saveLlmSettings(),
      isEnabled: (argument: unknown) => isLlmSettingsCommandVisible(argument)
        && this.canSaveLlmSettings(),
      isVisible: isLlmSettingsCommandVisible,
    })
    commands.registerCommand(ScholarCommands.REVERT_LLM_SETTINGS, {
      execute: () => this.revertLlmSettings(),
      isEnabled: (argument: unknown) => isLlmSettingsCommandVisible(argument)
        && this.canRevertLlmSettings(),
      isVisible: isLlmSettingsCommandVisible,
    })
    commands.registerCommand(ScholarCommands.REFRESH_LLM_MODELS, {
      execute: () => this.refreshLlmModels(),
      isEnabled: (argument: unknown) => isLlmSettingsCommandVisible(argument)
        && this.canRefreshLlmModels(),
      isVisible: isLlmSettingsCommandVisible,
    })
    commands.registerCommand(ScholarCommands.TEST_LLM_KG_EXTRACTION, {
      execute: () => this.testLlmWorkflow('kg_extraction'),
      isEnabled: (argument: unknown) => isLlmSettingsCommandVisible(argument)
        && this.canTestLlmWorkflow('kg_extraction'),
      isVisible: isLlmSettingsCommandVisible,
    })
    commands.registerCommand(ScholarCommands.TEST_LLM_HTML_INJECTION, {
      execute: () => this.testLlmWorkflow('html_injection'),
      isEnabled: (argument: unknown) => isLlmSettingsCommandVisible(argument)
        && this.canTestLlmWorkflow('html_injection'),
      isVisible: isLlmSettingsCommandVisible,
    })
    commands.registerCommand(ScholarCommands.TEST_LLM_TOOLTIP_SUGGESTION, {
      execute: () => this.testLlmWorkflow('tooltip_suggestion'),
      isEnabled: (argument: unknown) => isLlmSettingsCommandVisible(argument)
        && this.canTestLlmWorkflow('tooltip_suggestion'),
      isVisible: isLlmSettingsCommandVisible,
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
      execute: (argument: unknown) => this.paperWidgetOf(argument)?.openSearch(),
      isEnabled: (argument: unknown) => Boolean(this.paperWidgetOf(argument)),
      isVisible: (argument: unknown) => Boolean(this.paperWidgetOf(argument)),
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
    commands.registerCommand(ScholarCommands.STOP_KNOWLEDGE_GRAPH, {
      execute: (argument: unknown) => this.stopKnowledgeGraphFromWidget(argument),
      isEnabled: (argument: unknown) => this.canStopKnowledgeGraph(argument),
      isVisible: (argument: unknown) => this.canStopKnowledgeGraph(argument),
    })
    commands.registerCommand(ScholarCommands.REANCHOR_OCCURRENCES, {
      execute: (argument: unknown) => this.reanchorOccurrencesFromWidget(argument),
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
    commands.registerCommand(ScholarCommands.SEARCH_GRAPH, {
      execute: (argument: unknown) => this.searchGraph(argument),
      isEnabled: (argument: unknown) => this.canControlGraph(argument),
      isVisible: (argument: unknown) => Boolean(this.graphWidgetOf(argument)),
    })
    commands.registerCommand(ScholarCommands.FILTER_GRAPH, {
      execute: (argument: unknown) => this.filterGraph(argument),
      isEnabled: (argument: unknown) => this.canControlGraph(argument),
      isVisible: (argument: unknown) => Boolean(this.graphWidgetOf(argument)),
    })
    commands.registerCommand(ScholarCommands.TOGGLE_GRAPH_FOCUS, {
      execute: (argument: unknown) => this.toggleGraphFocus(argument),
      isEnabled: (argument: unknown) => this.canToggleGraphFocus(argument),
      isVisible: (argument: unknown) => Boolean(this.graphWidgetOf(argument)),
      isToggled: (argument: unknown) => Boolean(
        this.graphWidgetOf(argument)?.getGraphSnapshot()?.focusMode,
      ),
    })
    commands.registerCommand(ScholarCommands.RESET_GRAPH_LAYOUT, {
      execute: (argument: unknown) => this.resetGraphLayout(argument),
      isEnabled: (argument: unknown) => this.canControlGraph(argument),
      isVisible: (argument: unknown) => Boolean(this.graphWidgetOf(argument)),
    })
    commands.registerCommand(ScholarCommands.REVEAL_GRAPH_SELECTION, {
      execute: (argument: unknown) => this.revealGraphSelection(argument),
      isEnabled: (argument: unknown) => this.canRevealGraphSelection(argument),
      isVisible: (argument: unknown) => Boolean(this.graphWidgetOf(argument)),
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
      id: ScholarCommands.FIND_IN_PAPER.id,
      command: ScholarCommands.FIND_IN_PAPER.id,
      group: 'navigation',
      priority: 5,
      isVisible: widget => {
        const paperWidget = this.paperWidgetOf(widget)
        return Boolean(paperWidget && !paperWidget.getSearchSnapshot().isOpen)
      },
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: SCHOLAR_PAPER_FIND_TOOLBAR_ID,
      group: 'navigation',
      priority: 5,
      isVisible: widget => Boolean(this.paperWidgetOf(widget)?.getSearchSnapshot().isOpen),
      render: widget => {
        const paperWidget = this.paperWidgetOf(widget)
        return paperWidget
          ? React.createElement(ScholarPaperFindToolbar, { target: paperWidget })
          : null
      },
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
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
      id: ScholarCommands.STOP_KNOWLEDGE_GRAPH.id,
      command: ScholarCommands.STOP_KNOWLEDGE_GRAPH.id,
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
      id: ScholarCommands.SEARCH_GRAPH.id,
      command: ScholarCommands.SEARCH_GRAPH.id,
      group: 'navigation',
      priority: 10,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.FILTER_GRAPH.id,
      command: ScholarCommands.FILTER_GRAPH.id,
      group: 'navigation',
      priority: 20,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.TOGGLE_GRAPH_FOCUS.id,
      command: ScholarCommands.TOGGLE_GRAPH_FOCUS.id,
      group: 'navigation',
      priority: 30,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.RESET_GRAPH_LAYOUT.id,
      command: ScholarCommands.RESET_GRAPH_LAYOUT.id,
      group: 'navigation',
      priority: 40,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.REVEAL_GRAPH_SELECTION.id,
      command: ScholarCommands.REVEAL_GRAPH_SELECTION.id,
      group: 'navigation',
      priority: 50,
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
      id: ScholarCommands.CREATE_READING_SET.id,
      command: ScholarCommands.CREATE_READING_SET.id,
      group: 'navigation',
      priority: 10,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.REFRESH_READING_SETS.id,
      command: ScholarCommands.REFRESH_READING_SETS.id,
      group: 'navigation',
      priority: 20,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.OPEN_READING_SET_CHAT.id,
      command: ScholarCommands.OPEN_READING_SET_CHAT.id,
      group: 'navigation',
      priority: 5,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.SUGGEST_READING_SET_REFERENCES.id,
      command: ScholarCommands.SUGGEST_READING_SET_REFERENCES.id,
      group: 'navigation',
      priority: 15,
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
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.SAVE_LLM_SETTINGS.id,
      command: ScholarCommands.SAVE_LLM_SETTINGS.id,
      group: 'navigation',
      priority: 10,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.REVERT_LLM_SETTINGS.id,
      command: ScholarCommands.REVERT_LLM_SETTINGS.id,
      group: 'navigation',
      priority: 20,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.REFRESH_LLM_MODELS.id,
      command: ScholarCommands.REFRESH_LLM_MODELS.id,
      group: 'navigation',
      priority: 30,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.TEST_LLM_KG_EXTRACTION.id,
      command: ScholarCommands.TEST_LLM_KG_EXTRACTION.id,
      group: 'navigation',
      priority: 40,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.TEST_LLM_HTML_INJECTION.id,
      command: ScholarCommands.TEST_LLM_HTML_INJECTION.id,
      group: 'navigation',
      priority: 50,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
    this.toDispose.push(registry.registerItem({
      id: ScholarCommands.TEST_LLM_TOOLTIP_SUGGESTION.id,
      command: ScholarCommands.TEST_LLM_TOOLTIP_SUGGESTION.id,
      group: 'navigation',
      priority: 60,
      onDidChange: this.onToolbarItemsChangedEmitter.event,
    }))
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE_SETTINGS_SUBMENU_OPEN, {
      commandId: ScholarCommands.OPEN_LLM_SETTINGS.id,
      order: 'a10',
    })
    menus.registerMenuAction(CommonMenus.MANAGE_SETTINGS, {
      commandId: ScholarCommands.OPEN_LLM_SETTINGS.id,
      order: 'a10',
    })
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.SHOW_LIBRARY.id,
      order: 'a10',
    })
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.SHOW_READING_SETS.id,
      order: 'a15',
    })
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.SHOW_NAVIGATION.id,
      order: 'a20',
    })
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.SHOW_SEMANTIC_LENS.id,
      order: 'a25',
    })
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: ScholarCommands.SHOW_CHAT.id,
      order: 'a27',
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
      commandId: ScholarCommands.STOP_KNOWLEDGE_GRAPH.id,
      order: 'b21',
    })
    menus.registerMenuAction(SCHOLAR_LIBRARY_CONTEXT_MENU, {
      commandId: ScholarCommands.REANCHOR_OCCURRENCES.id,
      order: 'b22',
    })
    menus.registerMenuAction(SCHOLAR_LIBRARY_CONTEXT_MENU, {
      commandId: ScholarCommands.ADD_PAPER_TO_READING_SET.id,
      order: 'a30',
    })
    menus.registerMenuAction(SCHOLAR_LIBRARY_CONTEXT_MENU, {
      commandId: ScholarCommands.DELETE_PAPER.id,
      order: 'c10',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.OPEN_PAPER.id,
      order: 'a10',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.OPEN_PAPER_TO_SIDE.id,
      order: 'a20',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.REMOVE_PAPER_FROM_READING_SET.id,
      order: 'b10',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.LINK_READING_SET_TERMS.id,
      order: 'b20',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.STOP_READING_SET_TERMS.id,
      order: 'b21',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.CONFIRM_ALL_READING_SET_TERMS.id,
      order: 'b22',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.REJECT_ALL_READING_SET_TERMS.id,
      order: 'b23',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.SUGGEST_READING_SET_REFERENCES.id,
      order: 'b25',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.OPEN_READING_SET_CHAT.id,
      order: 'b30',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.RENAME_READING_SET.id,
      order: 'c10',
    })
    menus.registerMenuAction(SCHOLAR_READING_SET_CONTEXT_MENU, {
      commandId: ScholarCommands.DELETE_READING_SET.id,
      order: 'c20',
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
      command: ScholarCommands.SHOW_SEMANTIC_LENS.id,
      keybinding: 'alt+shift+l',
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
    return this.shell.activeWidget instanceof ScholarPaperWidget && !this.shell.activeWidget.isDisposed
      ? this.shell.activeWidget
      : undefined
  }

  private paperWidgetOf(argument: unknown): ScholarPaperWidget | undefined {
    if (argument === undefined) {
      return this.activePaperWidget
    }
    return argument instanceof ScholarPaperWidget && !argument.isDisposed ? argument : undefined
  }

  private get activeGraphWidget(): ScholarPaperGraphWidget | undefined {
    return this.shell.activeWidget instanceof ScholarPaperGraphWidget
      ? this.shell.activeWidget
      : undefined
  }

  private graphWidgetOf(argument: unknown): ScholarPaperGraphWidget | undefined {
    if (argument === undefined) {
      return this.activeGraphWidget
    }
    return argument instanceof ScholarPaperGraphWidget ? argument : undefined
  }

  private canControlGraph(argument: unknown): boolean {
    const widget = this.graphWidgetOf(argument)
    return Boolean(widget?.getGraphController() && widget.getGraphSnapshot()?.status === 'ready')
  }

  private canToggleGraphFocus(argument: unknown): boolean {
    const widget = this.graphWidgetOf(argument)
    const snapshot = widget?.getGraphSnapshot()
    return Boolean(
      widget?.getGraphController()
      && snapshot?.status === 'ready'
      && (snapshot.focusMode || snapshot.canFocusSelection),
    )
  }

  private canRevealGraphSelection(argument: unknown): boolean {
    const widget = this.graphWidgetOf(argument)
    const snapshot = widget?.getGraphSnapshot()
    return Boolean(
      widget?.getGraphController()
      && snapshot?.status === 'ready'
      && snapshot.canRevealSelectionInPaper,
    )
  }

  private toggleGraphFocus(argument: unknown): void {
    const widget = this.graphWidgetOf(argument)
    const snapshot = widget?.getGraphSnapshot()
    if (!widget || snapshot?.status !== 'ready') {
      return
    }
    if (snapshot.focusMode) {
      widget.clearFocus()
    } else if (snapshot.canFocusSelection) {
      widget.focusSelection()
    }
  }

  private resetGraphLayout(argument: unknown): void {
    if (!this.canControlGraph(argument)) {
      return
    }
    this.graphWidgetOf(argument)?.resetLayout()
  }

  private revealGraphSelection(argument: unknown): void {
    if (!this.canRevealGraphSelection(argument)) {
      return
    }
    this.graphWidgetOf(argument)?.revealSelectionInPaper()
  }

  private async searchGraph(argument: unknown): Promise<void> {
    const widget = this.graphWidgetOf(argument)
    const controller = widget?.getGraphController()
    const snapshot = widget?.getGraphSnapshot()
    if (!widget || !controller || snapshot?.status !== 'ready') {
      return
    }

    const query = await this.quickInputService.input({
      title: 'Search Knowledge Graph',
      placeHolder: 'Search canonical entities by label, alias, or evidence',
      prompt: 'Search runs on the server and does not add results to the layout.',
    })
    if (query === undefined
      || widget.getGraphController() !== controller
      || widget.getGraphSnapshot()?.status !== 'ready') {
      return
    }
    const searchItems = query.trim()
      ? await controller.search(query.trim())
      : snapshot.searchItems
    if (widget.getGraphController() !== controller
      || widget.getGraphSnapshot()?.status !== 'ready') {
      return
    }
    const items: GraphSearchQuickPickItem[] = searchItems.map(item => ({
      id: item.id,
      label: item.label,
      description: item.nodeType,
      detail: item.detail,
    }))
    const selected = await this.quickInputService.pick(items, {
      title: 'Search Knowledge Graph',
      placeHolder: 'Choose a server-ranked entity',
      canPickMany: false,
      matchOnDescription: true,
      matchOnDetail: true,
    })

    if (!selected
      || widget.getGraphController() !== controller
      || widget.getGraphSnapshot()?.status !== 'ready') {
      return
    }
    widget.revealNode(selected.id)
  }

  private async filterGraph(argument: unknown): Promise<void> {
    const widget = this.graphWidgetOf(argument)
    const controller = widget?.getGraphController()
    const snapshot = widget?.getGraphSnapshot()
    if (!widget || !controller || snapshot?.status !== 'ready') {
      return
    }

    const nodeItems: GraphFilterQuickPickItem[] = snapshot.nodeTypeFilters.map(option => ({
      id: `node:${option.type}`,
      label: option.label,
      description: option.type,
      detail: `${option.count} node${option.count === 1 ? '' : 's'}`,
      filterKind: 'node',
      filterType: option.type,
    }))
    const edgeItems: GraphFilterQuickPickItem[] = snapshot.edgeTypeFilters.map(option => ({
      id: `edge:${option.type}`,
      label: option.label,
      description: option.type,
      detail: `${option.count} relationship${option.count === 1 ? '' : 's'}`,
      filterKind: 'edge',
      filterType: option.type,
    }))
    const items: Array<GraphFilterQuickPickItem | QuickPickSeparator> = [
      { type: 'separator', label: 'Node Types' },
      ...nodeItems,
      { type: 'separator', label: 'Relationship Types' },
      ...edgeItems,
    ]

    const picker = this.quickInputService.createQuickPick<GraphFilterQuickPickItem>()
    picker.title = 'Filter Knowledge Graph'
    picker.placeholder = 'Select visible node and relationship types'
    picker.canSelectMany = true
    picker.matchOnDescription = true
    picker.matchOnDetail = true
    picker.items = items
    picker.selectedItems = [
      ...nodeItems.filter(item => snapshot.nodeTypeFilters.some(
        option => option.type === item.filterType && option.selected,
      )),
      ...edgeItems.filter(item => snapshot.edgeTypeFilters.some(
        option => option.type === item.filterType && option.selected,
      )),
    ]

    await new Promise<void>(resolve => {
      const pickerDisposables = new DisposableCollection()
      let finished = false
      const finish = (): void => {
        if (finished) return
        finished = true
        pickerDisposables.dispose()
        picker.dispose()
        resolve()
      }

      pickerDisposables.push(picker.onDidAccept(() => {
        if (widget.getGraphController() === controller
          && widget.getGraphSnapshot()?.status === 'ready') {
          const selectedItems = [...picker.selectedItems]
          widget.setVisibleTypes(
            selectedItems
              .filter(item => item.filterKind === 'node')
              .map(item => item.filterType),
            selectedItems
              .filter(item => item.filterKind === 'edge')
              .map(item => item.filterType),
          )
        }
        picker.hide()
      }))
      pickerDisposables.push(picker.onDidHide(finish))
      picker.show()
    })
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

  private canStopKnowledgeGraph(argument: unknown): boolean {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return false
    }
    const snapshot = this.store.getSnapshot()
    const progress = snapshot.knowledgeGraphProgressByPaperId[paperId]
    return progress?.stage === 'starting'
      || progress?.stage === 'extracting'
      || snapshot.statusByPaperId[paperId] === 'Starting knowledge graph build…'
      || snapshot.statusByPaperId[paperId] === 'Stopping knowledge graph build…'
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
    const dialog = new ScholarTextareaDialog({
      title: 'Generate AI Term Highlights',
      placeholder: 'Describe your background/expertise (e.g. "graduate student in topology")…',
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
        `Generated ${result.suggested_count} AI term highlights`,
      )
    } catch (reason) {
      await this.messageService.error(
        `Could not generate term highlights: ${errorMessage(reason)}`,
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
      if (result.success && result.spans_injected === 0) {
        // Notes without anchors are invisible in the paper, so this is a failure
        // to report rather than a quiet success.
        await this.messageService.warn(
          `Applied ${result.tooltips_created} term highlights but highlighted no occurrences`,
        )
      } else if (result.success) {
        await this.messageService.info(
          `Applied ${result.tooltips_created} term highlights to ${result.spans_injected} occurrences`,
        )
      } else {
        await this.messageService.error('The backend could not apply the selected term highlights')
      }
      for (const warning of result.errors) {
        await this.messageService.warn(warning)
      }
    } catch (reason) {
      await this.messageService.error(`Could not apply term highlights: ${errorMessage(reason)}`)
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
      title: 'Delete Term Highlight',
      msg: 'Delete this term highlight permanently?',
      ok: 'Delete',
    }).open()
    if (!confirmed) {
      return
    }
    try {
      await this.suggestions.deleteSuggestion(target.paperId, target.suggestionId)
      await this.messageService.info('Term highlight deleted')
    } catch (reason) {
      await this.messageService.error(`Could not delete term highlight: ${errorMessage(reason)}`)
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
    const confirmed = await new ConfirmDialog({
      title: 'Build Knowledge Graph',
      msg: 'Build the knowledge graph now? This can take several minutes and use paid LLM tokens.',
      ok: 'Build',
    }).open()
    if (!confirmed) {
      return
    }
    try {
      await this.store.buildKnowledgeGraph(paperId)
    } catch (reason) {
      await this.messageService.error(`Could not build knowledge graph: ${errorMessage(reason)}`)
    }
  }

  private async reanchorOccurrencesFromWidget(argument: unknown): Promise<void> {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return
    }
    try {
      // No confirmation dialog: unlike a graph build this calls no LLM, it only
      // re-matches known terms against the compiled text.
      const result = await this.store.reanchorOccurrences(paperId)
      await this.messageService.info(
        `Re-anchored terms: ${result.occurrence_count} occurrences`
        + ` (was ${result.previous_occurrence_count}). Apply term highlights to show them.`,
      )
    } catch (reason) {
      await this.messageService.error(`Could not re-anchor terms: ${errorMessage(reason)}`)
    }
  }

  private async stopKnowledgeGraphFromWidget(argument: unknown): Promise<void> {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return
    }
    try {
      await this.store.cancelKnowledgeGraph(paperId)
    } catch (reason) {
      await this.messageService.error(`Could not stop knowledge graph build: ${errorMessage(reason)}`)
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

  private async createReadingSet(): Promise<string | undefined> {
    const name = await this.quickInputService.input({
      title: 'New Reading Set',
      placeHolder: 'Reading set name',
      prompt: 'Group papers to read together across multi-paper features.',
    })
    const trimmed = name?.trim()
    if (!trimmed) {
      return undefined
    }
    try {
      const created = await this.readingSets.createReadingSet(trimmed)
      return created.id
    } catch (reason) {
      await this.messageService.error(`Could not create reading set: ${errorMessage(reason)}`)
      return undefined
    }
  }

  private async renameReadingSetFromWidget(argument: unknown): Promise<void> {
    if (!isScholarReadingSetTreeNode(argument)) {
      return
    }
    const current = this.readingSets.readingSetOf(argument.readingSetId)
    const name = await this.quickInputService.input({
      title: 'Rename Reading Set',
      placeHolder: 'Reading set name',
      value: current?.name,
    })
    const trimmed = name?.trim()
    if (!trimmed || trimmed === current?.name) {
      return
    }
    try {
      await this.readingSets.renameReadingSet(argument.readingSetId, trimmed)
    } catch (reason) {
      await this.messageService.error(`Could not rename reading set: ${errorMessage(reason)}`)
    }
  }

  private async deleteReadingSetFromWidget(argument: unknown): Promise<void> {
    if (!isScholarReadingSetTreeNode(argument)) {
      return
    }
    const confirmed = await new ConfirmDialog({
      title: 'Delete Reading Set',
      msg: 'Delete this reading set? The papers themselves stay in the library.',
      ok: 'Delete',
    }).open()
    if (!confirmed) {
      return
    }
    try {
      await this.readingSets.deleteReadingSet(argument.readingSetId)
    } catch (reason) {
      await this.messageService.error(`Could not delete reading set: ${errorMessage(reason)}`)
    }
  }

  private async addPaperToReadingSet(argument: unknown): Promise<void> {
    const paperId = this.paperIdOf(argument)
    if (!paperId) {
      return
    }
    await this.readingSets.initialize()
    const readingSetId = await this.pickReadingSet(paperId)
    if (!readingSetId) {
      return
    }
    try {
      const updated = await this.readingSets.addPaperToReadingSet(readingSetId, paperId)
      void this.messageService.info(`Added to reading set "${updated.name}"`)
    } catch (reason) {
      await this.messageService.error(`Could not add paper to reading set: ${errorMessage(reason)}`)
    }
  }

  /**
   * Offers existing reading sets (marking those that already contain the
   * paper) plus a "create new" escape hatch, and resolves to the chosen
   * reading set id.
   */
  private async pickReadingSet(paperId: string): Promise<string | undefined> {
    const CREATE_NEW = 'scholar-agent:create-new-reading-set'
    const items: ReadingSetQuickPickItem[] = this.readingSets.getSnapshot().readingSets.map(set => ({
      id: set.id,
      label: set.name,
      description: set.papers.some(paper => paper.id === paperId)
        ? 'Already contains this paper'
        : `${set.papers.length} paper${set.papers.length === 1 ? '' : 's'}`,
    }))
    items.push({ id: CREATE_NEW, label: 'New Reading Set…', iconClasses: ['codicon', 'codicon-add'] })
    const selected = await this.quickInputService.pick(items, {
      title: 'Add to Reading Set',
      placeHolder: 'Choose a reading set',
      canPickMany: false,
    })
    if (!selected) {
      return undefined
    }
    return selected.id === CREATE_NEW ? this.createReadingSet() : selected.id
  }

  /**
   * Runs "Link terms" for a reading set and reports the outcome. Progress is
   * rendered by the Reading Sets tree from the service snapshot; this handler
   * only owns the terminal notification.
   */
  private async linkReadingSetTerms(argument: unknown): Promise<void> {
    if (!isScholarReadingSetTreeNode(argument)) {
      return
    }
    const name = this.readingSets.readingSetOf(argument.readingSetId)?.name ?? 'reading set'
    try {
      const prepared = await this.prepareKnowledgeGraphsForLinking(argument.readingSetId)
      if (!prepared) {
        return
      }
      const result = await this.readingSets.linkTerms(argument.readingSetId)
      if (result.stage === 'complete') {
        const counts = `${result.alignmentCount} term link${result.alignmentCount === 1 ? '' : 's'}`
        void this.messageService.info(`Linked terms in "${name}": ${counts}`)
        if (result.skippedPapers.length > 0) {
          const skipped = result.skippedPapers
            .map(paper => paper.filename)
            .join(', ')
          void this.messageService.warn(
            `Skipped papers without a knowledge graph: ${skipped}. `
            + 'Build their knowledge graphs and run Link Terms again.',
          )
        }
      } else if (result.stage === 'cancelled') {
        void this.messageService.info(`Term linking cancelled for "${name}"`)
      } else {
        await this.messageService.error(
          `Could not link terms: ${result.error ?? 'Unknown error'}`,
        )
      }
    } catch (reason) {
      await this.messageService.error(`Could not link terms: ${errorMessage(reason)}`)
    }
  }

  /**
   * Link Terms silently skips papers without a knowledge graph, so surface the
   * precondition up front: offer to build the missing graphs and start the
   * alignment only once they are ready. Resolves false when the user cancels.
   */
  private async prepareKnowledgeGraphsForLinking(readingSetId: string): Promise<boolean> {
    const readingSet = this.readingSets.readingSetOf(readingSetId)
    const missing = (readingSet?.papers ?? []).filter(paper => !paper.has_knowledge_graph)
    if (missing.length === 0) {
      return true
    }
    const count = `${missing.length} paper${missing.length === 1 ? '' : 's'}`
    const BUILD = 'scholar-agent:build-missing-graphs'
    const SKIP = 'scholar-agent:link-without-graphs'
    const choice = await this.quickInputService.pick<ReadingSetQuickPickItem>([
      {
        id: BUILD,
        label: `Build ${missing.length} missing knowledge graph${missing.length === 1 ? '' : 's'}, then link`,
        description: 'Runs LLM extraction and can take several minutes per paper',
        iconClasses: ['codicon', 'codicon-combine'],
      },
      {
        id: SKIP,
        label: 'Link terms now',
        description: `Skips ${count} without a knowledge graph`,
        iconClasses: ['codicon', 'codicon-link'],
      },
    ], {
      title: 'Link Terms',
      placeHolder: `${count} in this reading set ${missing.length === 1 ? 'has' : 'have'} no knowledge graph yet`,
      canPickMany: false,
    })
    if (!choice) {
      return false
    }
    if (choice.id === SKIP) {
      return true
    }
    void this.messageService.info(`Building knowledge graphs for ${count}…`)
    const failed = await this.buildKnowledgeGraphs(missing.map(paper => paper.id))
    await this.readingSets.refresh()
    if (failed.length > 0) {
      const labels = failed
        .map(paperId => {
          const paper = this.paperOf(paperId)
          return paper ? paperLabel(paper.filename, this.paperTitle(paper)) : paperId
        })
        .join(', ')
      void this.messageService.warn(
        `Could not build knowledge graphs for: ${labels}. Link Terms will skip them.`,
      )
    }
    return true
  }

  /**
   * Starts the missing builds and resolves once every one reached a terminal
   * state, returning the papers whose graph still failed. Progress is watched
   * through the workspace store, the same stream the status bar renders.
   */
  private async buildKnowledgeGraphs(paperIds: string[]): Promise<string[]> {
    const failed: string[] = []
    const initialProgress = new Map(paperIds.map(paperId => [
      paperId,
      this.store.getSnapshot().knowledgeGraphProgressByPaperId[paperId],
    ]))
    const pending = new Set<string>()
    await Promise.all(paperIds.map(async paperId => {
      try {
        await this.store.buildKnowledgeGraph(paperId)
        pending.add(paperId)
      } catch {
        failed.push(paperId)
      }
    }))
    if (pending.size === 0) {
      return failed
    }
    await new Promise<void>(resolve => {
      let unsubscribe = (): void => undefined
      const check = (): void => {
        const snapshot = this.store.getSnapshot()
        for (const paperId of [...pending]) {
          const paper = snapshot.papersById[paperId]
            ?? snapshot.papers.find(candidate => candidate.id === paperId)
          if (paper?.has_knowledge_graph) {
            pending.delete(paperId)
            continue
          }
          const progress = snapshot.knowledgeGraphProgressByPaperId[paperId]
          // Ignore a stale terminal event left over from an earlier build.
          if (!progress || progress === initialProgress.get(paperId)) {
            if (snapshot.paperErrors[paperId]) {
              pending.delete(paperId)
              failed.push(paperId)
            }
            continue
          }
          if (progress.stage === 'complete') {
            pending.delete(paperId)
          } else if (progress.stage === 'cancelled' || progress.stage === 'error') {
            pending.delete(paperId)
            failed.push(paperId)
          }
        }
        if (pending.size === 0) {
          unsubscribe()
          resolve()
        }
      }
      unsubscribe = this.store.subscribe(check)
      check()
    })
    return failed
  }

  /** Confirms or rejects every proposed link of the set at once. */
  private async bulkReviewReadingSetTerms(
    argument: unknown,
    action: 'confirm' | 'reject',
  ): Promise<void> {
    if (!isScholarReadingSetTreeNode(argument)) {
      return
    }
    const name = this.readingSets.readingSetOf(argument.readingSetId)?.name ?? 'reading set'
    if (action === 'reject') {
      const confirmed = await new ConfirmDialog({
        title: 'Reject All Proposed Links',
        msg: `Reject every proposed term link in "${name}"? Links you confirmed stay.`,
        ok: 'Reject All',
      }).open()
      if (!confirmed) {
        return
      }
    }
    try {
      const result = await this.readingSets.bulkReviewAlignments(argument.readingSetId, action)
      const verb = action === 'confirm' ? 'Confirmed' : 'Rejected'
      void this.messageService.info(
        `${verb} ${result.updated_count} proposed link${result.updated_count === 1 ? '' : 's'} in "${name}"`,
      )
    } catch (reason) {
      await this.messageService.error(`Could not update term links: ${errorMessage(reason)}`)
    }
  }

  /**
   * Resolves the target set for actions started without a tree selection
   * (toolbar, command palette): the only set, or a quick pick.
   */
  private async pickReadingSetForAction(title: string): Promise<string | undefined> {
    await this.readingSets.initialize()
    const sets = this.readingSets.getSnapshot().readingSets
    if (sets.length === 0) {
      void this.messageService.info(
        'Create a reading set first: group papers in the Reading Sets view.',
      )
      return undefined
    }
    if (sets.length === 1) {
      return sets[0].id
    }
    const selected = await this.quickInputService.pick<ReadingSetQuickPickItem>(
      sets.map(set => ({
        id: set.id,
        label: set.name,
        description: `${set.papers.length} paper${set.papers.length === 1 ? '' : 's'}`,
      })),
      { title, placeHolder: 'Choose a reading set', canPickMany: false },
    )
    return selected?.id
  }

  /**
   * Aggregates the set's bibliographies, lets the agent rank the referenced
   * arXiv papers, and imports the ones the user picks straight into the set.
   * The backend persists every run, so suggestions that were already imported
   * stay visible in the picker instead of silently disappearing.
   */
  private async suggestReadingSetReferences(argument: unknown): Promise<void> {
    const readingSetId = isScholarReadingSetTreeNode(argument)
      ? argument.readingSetId
      : await this.pickReadingSetForAction('Suggest Papers from References')
    if (!readingSetId) {
      return
    }
    const name = this.readingSets.readingSetOf(readingSetId)?.name ?? 'reading set'
    const progress = await this.messageService.showProgress({
      text: `Ranking referenced papers for "${name}"…`,
    })
    let result: ReferenceSuggestionsResult
    try {
      result = await this.readingSets.suggestReferences(readingSetId)
    } catch (reason) {
      await this.messageService.error(
        `Could not suggest referenced papers: ${errorMessage(reason)}`,
      )
      return
    } finally {
      progress.cancel()
    }
    const pickable = result.suggestions.filter(suggestion => !suggestion.in_reading_set)
    const alreadyInSet = result.suggestions.filter(suggestion => suggestion.in_reading_set)
    if (result.suggestions.length === 0) {
      const memberCount = this.readingSets.readingSetOf(readingSetId)?.papers.length ?? 0
      void this.messageService.info(
        memberCount > 0 && result.skipped_papers.length >= memberCount
          ? `The papers in "${name}" have no bibliographies to scan yet. `
            + 'Suggestions become available once the papers finish compiling.'
          : `No arXiv references found in the bibliographies of "${name}". `
            + 'Only references with arXiv identifiers can be suggested.',
      )
      return
    }
    const toItem = (suggestion: ReferenceSuggestion) => ({
      suggestion,
      label: suggestion.title,
      description: `${suggestion.relevance} relevance · arXiv:${suggestion.arxiv_id}`
        + (suggestion.in_reading_set
          ? ' · already in this set'
          : suggestion.library_paper_id ? ' · already in library' : ''),
      detail: suggestion.reason || suggestion.abstract.slice(0, 200),
      picked: !suggestion.in_reading_set && suggestion.relevance === 'high',
    })
    const selected = await this.quickInputService.pick<ReferenceSuggestionQuickPickItem>(
      [...pickable, ...alreadyInSet].map(toItem),
      {
        title: `Add Referenced Papers to "${name}"`,
        placeHolder: pickable.length > 0
          ? 'Pick the papers to import and add to the reading set'
          : 'All previously suggested papers are already in this reading set',
        canPickMany: true,
      },
    )
    if (!selected || selected.length === 0) {
      return
    }
    const toAdd = selected.filter(item => !item.suggestion.in_reading_set)
    if (toAdd.length === 0) {
      void this.messageService.info(`The selected papers are already in "${name}".`)
      return
    }
    let added = 0
    const failures: string[] = []
    for (const item of toAdd) {
      const suggestion = item.suggestion
      try {
        const paperId = suggestion.library_paper_id
          ?? (await this.store.uploadArxiv(suggestion.arxiv_id)).id
        await this.readingSets.addPaperToReadingSet(readingSetId, paperId)
        added += 1
      } catch {
        failures.push(suggestion.title)
      }
    }
    if (added > 0) {
      void this.messageService.info(`Added ${added} paper${added === 1 ? '' : 's'} to "${name}"`)
    }
    if (failures.length > 0) {
      await this.messageService.error(`Could not add: ${failures.join(', ')}`)
    }
  }

  /**
   * The toggle is available while a highlight is active (so it can always be
   * removed) or when at least two open papers belong to one reading set.
   */
  private canHighlightSharedTerms(): boolean {
    if (this.sharedTermHighlighter.isActive()) {
      return true
    }
    return Boolean(SharedTermHighlighter.candidateSet(
      this.readingSets.getSnapshot().readingSets,
      this.openPaperIds(),
    ))
  }

  /** Ids of the open paper widgets, the active one first. */
  private openPaperIds(): string[] {
    const ids = this.widgetManager.getWidgets(SCHOLAR_PAPER_FACTORY_ID)
      .filter((widget): widget is ScholarPaperWidget => widget instanceof ScholarPaperWidget
        && !widget.isDisposed)
      .map(widget => widget.options.paperId)
    const active = this.activePaperWidget?.options.paperId
    return active ? [active, ...ids.filter(id => id !== active)] : ids
  }

  private async toggleSharedTermHighlights(): Promise<void> {
    try {
      const outcome = await this.sharedTermHighlighter.toggle(this.readingSets, this.openPaperIds())
      if (outcome.kind === 'no-set') {
        await this.messageService.info(
          'Open at least two papers from the same reading set to highlight shared terms.',
        )
      } else if (outcome.kind === 'no-terms') {
        await this.messageService.info(
          `No linked terms to highlight in "${outcome.readingSetName}". Run Link Terms first.`,
        )
      } else if (outcome.kind === 'highlighted') {
        const groups = `${outcome.groupCount} shared term group${outcome.groupCount === 1 ? '' : 's'}`
        void this.messageService.info(
          `Highlighted ${groups} across ${outcome.paperCount} papers in "${outcome.readingSetName}". `
          + 'Run the command again to remove the highlight.',
        )
      }
    } catch (reason) {
      await this.messageService.error(`Could not highlight shared terms: ${errorMessage(reason)}`)
    }
  }

  private async openReadingSetChat(argument: unknown): Promise<void> {
    if (!this.chat) {
      return
    }
    const readingSetId = isScholarReadingSetTreeNode(argument)
      ? argument.readingSetId
      : await this.pickReadingSetForAction('Chat About Reading Set')
    if (!readingSetId) {
      return
    }
    const readingSet = this.readingSets.readingSetOf(readingSetId)
    if (!readingSet) {
      return
    }
    try {
      await this.chat.activateReadingSet(readingSet)
      await this.showView(SCHOLAR_CHAT_WIDGET_ID, 'right')
    } catch (reason) {
      await this.messageService.error(`Could not open reading set chat: ${errorMessage(reason)}`)
    }
  }

  private async stopReadingSetTerms(argument: unknown): Promise<void> {
    if (!isScholarReadingSetTreeNode(argument)) {
      return
    }
    try {
      await this.readingSets.cancelLinkTerms(argument.readingSetId)
    } catch (reason) {
      await this.messageService.error(`Could not stop term linking: ${errorMessage(reason)}`)
    }
  }

  private async removePaperFromReadingSet(argument: unknown): Promise<void> {
    if (!isScholarReadingSetPaperTreeNode(argument)) {
      return
    }
    try {
      await this.readingSets.removePaperFromReadingSet(argument.readingSetId, argument.paperId)
    } catch (reason) {
      await this.messageService.error(
        `Could not remove paper from reading set: ${errorMessage(reason)}`,
      )
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
    const dialog = new ScholarArxivImportDialog({
      title: 'Import from arXiv',
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

  private async migrateLegacyTooltipDraftsLayout(app: FrontendApplication): Promise<void> {
    const annotations = this.widgetManager.tryGetWidget<ViewContainer>(
      SCHOLAR_ANNOTATIONS_WIDGET_ID,
    )
    const existingTooltipDrafts = this.widgetManager.tryGetWidget<ViewContainer>(
      SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID,
    )
    if (!(annotations instanceof ViewContainer)
      || (existingTooltipDrafts && app.shell.getAreaFor(existingTooltipDrafts))) {
      return
    }

    const legacyParts = annotations.getParts()
      .filter(part => (
        part.wrapped.id === SCHOLAR_SUGGESTIONS_WIDGET_ID
        || part.wrapped.id === SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID
      ))
      .map(part => ({
        wrapped: part.wrapped,
        options: part.options,
        originalContainerId: part.originalContainerId,
        originalContainerTitle: part.originalContainerTitle,
        collapsed: part.collapsed,
        hidden: part.isHidden,
      }))
    if (legacyParts.length === 0) {
      return
    }

    legacyParts.forEach(part => annotations.removeWidget(part.wrapped))
    let tooltipDrafts = existingTooltipDrafts
    try {
      tooltipDrafts ??= await this.widgetManager.getOrCreateWidget<ViewContainer>(
        SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID,
      )
      if (!(tooltipDrafts instanceof ViewContainer)) {
        throw new Error('Term Highlights did not create a view container')
      }
      for (const part of legacyParts) {
        if (!tooltipDrafts.getPartFor(part.wrapped)) {
          const isTree = part.wrapped.id === SCHOLAR_SUGGESTIONS_WIDGET_ID
          tooltipDrafts.addWidget(part.wrapped, {
            order: isTree ? 10 : 20,
            weight: isTree ? 0.65 : 0.35,
            initiallyCollapsed: !isTree,
          })
        }
      }
      if (!app.shell.getAreaFor(tooltipDrafts)) {
        await app.shell.addWidget(tooltipDrafts, {
          area: 'right',
          mode: 'tab-after',
          ref: annotations,
        })
      }
      tooltipDrafts.revealWidget(SCHOLAR_SUGGESTIONS_WIDGET_ID)
    } catch (reason) {
      const failedTooltipDrafts = tooltipDrafts
      if (failedTooltipDrafts instanceof ViewContainer) {
        legacyParts.forEach(part => failedTooltipDrafts.removeWidget(part.wrapped))
      }
      for (const part of legacyParts) {
        if (!annotations.getPartFor(part.wrapped)) {
          annotations.addWidget(
            part.wrapped,
            part.options,
            part.originalContainerId,
            part.originalContainerTitle,
          )
          const restoredPart = annotations.getPartFor(part.wrapped)
          if (restoredPart) {
            restoredPart.collapsed = part.collapsed
            restoredPart.setHidden(part.hidden)
          }
        }
      }
      throw reason
    }
  }

  /**
   * Theia restores existing users' saved layouts without calling
   * `initializeLayout`, so the Reading Sets view added there never appeared
   * for them. Attach it once next to the Papers view, keeping layouts intact.
   */
  private async migrateReadingSetsLayout(app: FrontendApplication): Promise<void> {
    const existing = this.widgetManager.tryGetWidget(SCHOLAR_READING_SETS_WIDGET_ID)
    if (existing && app.shell.getAreaFor(existing)) {
      return
    }
    const readingSets = existing
      ?? await this.widgetManager.getOrCreateWidget(SCHOLAR_READING_SETS_WIDGET_ID)
    const library = this.widgetManager.tryGetWidget(SCHOLAR_LIBRARY_WIDGET_ID)
    const ref = library && app.shell.getAreaFor(library) === 'left' ? library : undefined
    await app.shell.addWidget(readingSets, ref
      ? { area: 'left', mode: 'tab-after', ref }
      : { area: 'left' })
  }

  private async migratePreChatLayout(app: FrontendApplication): Promise<void> {
    const existingChat = this.widgetManager.tryGetWidget(SCHOLAR_CHAT_WIDGET_ID)
    if (existingChat && app.shell.getAreaFor(existingChat)) {
      return
    }

    const [chat, navigation, outline] = await Promise.all([
      existingChat ?? this.widgetManager.getOrCreateWidget(SCHOLAR_CHAT_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_NAVIGATION_WIDGET_ID),
      this.widgetManager.getOrCreateWidget(SCHOLAR_OUTLINE_WIDGET_ID),
    ])
    if (!(navigation instanceof ViewContainer)) {
      throw new Error('Navigate did not create a view container')
    }

    const outlineArea = app.shell.getAreaFor(outline)
    if (outlineArea) {
      outline.close()
    }
    if (!navigation.getPartFor(outline)) {
      navigation.addWidget(outline, { order: 10, weight: 1 })
    }

    const navigationArea = app.shell.getAreaFor(navigation)
    if (navigationArea && navigationArea !== 'left') {
      navigation.close()
    }
    if (navigationArea !== 'left') {
      await app.shell.addWidget(navigation, { area: 'left' })
    }

    await app.shell.addWidget(chat, { area: 'right', rank: CHAT_RANK })
    await app.shell.activateWidget(chat.id)
  }

  private revealSemanticLens(): Promise<void> {
    this.semanticLensReveal = this.semanticLensReveal
      .catch(() => undefined)
      .then(() => this.doRevealSemanticLens())
    return this.semanticLensReveal
  }

  private async doRevealSemanticLens(): Promise<void> {
    try {
      const widget = await this.widgetManager.getOrCreateWidget(SCHOLAR_SEMANTIC_LENS_WIDGET_ID)
      if (!widget.isAttached) {
        await this.shell.addWidget(widget, { area: 'right', rank: SEMANTIC_LENS_RANK })
      }
      // Reveal instead of activate: the lens becomes visible while the caret and
      // keyboard focus stay in the paper the reader is working through.
      await this.shell.revealWidget(widget.id)
    } catch (reason) {
      await this.messageService.warn(`Could not open the Semantic Lens: ${errorMessage(reason)}`)
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

  private async showLlmSettings(): Promise<void> {
    const widget = await this.widgetManager.getOrCreateWidget(SCHOLAR_LLM_SETTINGS_WIDGET_ID)
    if (!widget.isAttached) {
      await this.shell.addWidget(widget, { area: 'main' })
    }
    await this.shell.activateWidget(widget.id)
  }

  private canSaveLlmSettings(): boolean {
    const snapshot = this.llmSettings.getSnapshot()
    return snapshot.dirty && snapshot.validation.canSave && !snapshot.saving
  }

  private canRevertLlmSettings(): boolean {
    const snapshot = this.llmSettings.getSnapshot()
    return snapshot.dirty && !snapshot.saving
  }

  private canRefreshLlmModels(): boolean {
    const snapshot = this.llmSettings.getSnapshot()
    return snapshot.validation.canListModels
      && snapshot.models.status !== 'loading'
      && !snapshot.saving
  }

  private canTestLlmWorkflow(workflow: LlmWorkflow): boolean {
    const snapshot = this.llmSettings.getSnapshot()
    return snapshot.validation.canTest[workflow]
      && snapshot.testByWorkflow[workflow].status !== 'pending'
      && !snapshot.saving
  }

  private async saveLlmSettings(): Promise<void> {
    try {
      await this.llmSettings.save()
      await this.messageService.info('LLM settings saved.')
    } catch (reason) {
      await this.messageService.error(`Could not save LLM settings: ${errorMessage(reason)}`)
    }
  }

  private async revertLlmSettings(): Promise<void> {
    try {
      await this.llmSettings.revert()
    } catch (reason) {
      await this.messageService.error(`Could not revert LLM settings: ${errorMessage(reason)}`)
    }
  }

  private async refreshLlmModels(): Promise<void> {
    try {
      await this.llmSettings.listModels()
    } catch (reason) {
      await this.messageService.error(`Could not refresh LLM models: ${errorMessage(reason)}`)
    }
  }

  private async testLlmWorkflow(workflow: LlmWorkflow): Promise<void> {
    try {
      await this.llmSettings.testWorkflow(workflow)
    } catch (reason) {
      await this.messageService.error(`Could not test LLM connection: ${errorMessage(reason)}`)
    }
  }

  private bindActivePaperSearchWidget(widget: unknown): void {
    const paperWidget = widget instanceof ScholarPaperWidget && !widget.isDisposed
      ? widget
      : undefined
    const previousPaperWidget = this.boundPaperSearchWidget
    this.activePaperSearchWidgetSubscription.dispose()
    this.boundPaperSearchWidget = paperWidget
    this.activePaperSearchWidgetSubscription = paperWidget
      ? paperWidget.onDidChangeSearchState(() => {
          if (this.boundPaperSearchWidget === paperWidget && !paperWidget.isDisposed) {
            this.onToolbarItemsChangedEmitter.fire()
          }
        })
      : Disposable.create(() => undefined)

    if (previousPaperWidget !== paperWidget) {
      this.onToolbarItemsChangedEmitter.fire()
    }
  }

  private bindActiveGraphWidget(widget: unknown): void {
    const graphWidget = widget instanceof ScholarPaperGraphWidget ? widget : undefined
    const previousGraphWidget = this.boundGraphWidget
    this.activeGraphWidgetSubscription.dispose()
    this.boundGraphWidget = graphWidget
    this.activeGraphWidgetSubscription = graphWidget
      ? graphWidget.onDidChangeGraphState(() => {
          if (this.boundGraphWidget === graphWidget && this.shell.activeWidget === graphWidget) {
            this.updateGraphStatus(graphWidget)
            this.onToolbarItemsChangedEmitter.fire()
          }
        })
      : Disposable.create(() => undefined)

    this.updateGraphStatus(graphWidget)
    if (previousGraphWidget !== graphWidget) {
      this.onToolbarItemsChangedEmitter.fire()
    }
  }

  private updateGraphStatus(widget: ScholarPaperGraphWidget | undefined): void {
    if (!widget) {
      void this.statusBar.removeElement(GRAPH_STATUS_BAR_ID)
      return
    }

    const snapshot = widget.getGraphSnapshot()
    if (!snapshot || snapshot.status !== 'ready') {
      const status = snapshot?.status ?? 'loading'
      const statusText = status === 'error'
        ? '$(error) Graph error'
        : status === 'empty'
          ? '$(type-hierarchy) Graph empty'
          : `$(sync~spin) Graph ${status}…`
      void this.statusBar.setElement(GRAPH_STATUS_BAR_ID, {
        text: statusText,
        alignment: StatusBarAlignment.LEFT,
        priority: 99,
        tooltip: `Knowledge Graph: ${status}`,
      })
      return
    }

    const nodeFilters = this.describeGraphFilters(snapshot.nodeTypeFilters)
    const edgeFilters = this.describeGraphFilters(snapshot.edgeTypeFilters)
    const focusedNode = snapshot.focusedNodeId
      ? snapshot.searchItems.find(item => item.id === snapshot.focusedNodeId)
      : undefined
    const focus = snapshot.focusMode ? focusedNode?.label ?? snapshot.focusedNodeId ?? 'on' : 'off'
    void this.statusBar.setElement(GRAPH_STATUS_BAR_ID, {
      text: `$(type-hierarchy) ${snapshot.visibleNodeCount}/${snapshot.totalNodeCount} nodes`
        + ` · ${snapshot.visibleEdgeCount}/${snapshot.totalEdgeCount} links`
        + ` · N: ${nodeFilters} · R: ${edgeFilters} · Focus: ${focus}`,
      alignment: StatusBarAlignment.LEFT,
      priority: 99,
      tooltip: `Knowledge Graph\nNodes: ${snapshot.visibleNodeCount}/${snapshot.totalNodeCount}`
        + `\nRelationships: ${snapshot.visibleEdgeCount}/${snapshot.totalEdgeCount}`
        + `\nNode filters: ${nodeFilters}`
        + `\nRelationship filters: ${edgeFilters}`
        + `\nFocus: ${focus}`,
    })
  }

  private describeGraphFilters(
    filters: readonly { label: string; selected: boolean }[],
  ): string {
    const selected = filters.filter(filter => filter.selected)
    if (selected.length === 0) {
      return 'none'
    }
    if (selected.length === filters.length) {
      return 'all'
    }
    return selected.map(filter => filter.label).join(', ')
  }

  /** Mirrors the in-flight "Link terms" builds so progress is visible outside the tree. */
  private updateReadingSetStatusBar(): void {
    const builds = Object.entries(this.readingSets.getSnapshot().alignmentBuilds)
    if (builds.length === 0) {
      void this.statusBar.removeElement(READING_SET_STATUS_BAR_ID)
      return
    }
    const [readingSetId, build] = builds[0]
    const name = this.readingSets.readingSetOf(readingSetId)?.name ?? 'Reading set'
    const suffix = builds.length > 1 ? ` (+${builds.length - 1} more)` : ''
    void this.statusBar.setElement(READING_SET_STATUS_BAR_ID, {
      text: `$(sync~spin) ${name}: ${linkTermsDescription(build)}${suffix}`,
      alignment: StatusBarAlignment.LEFT,
      priority: 98,
      tooltip: `Linking terms in "${name}"`,
      command: ScholarCommands.SHOW_READING_SETS.id,
    })
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