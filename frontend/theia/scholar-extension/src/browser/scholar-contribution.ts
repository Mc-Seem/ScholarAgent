import {
  Command,
  CommandContribution,
  CommandRegistry,
  Disposable,
  DisposableCollection,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core'
import {
  ApplicationShell,
  CommonMenus,
  FrontendApplication,
  FrontendApplicationContribution,
  KeybindingContribution,
  KeybindingRegistry,
  StatusBar,
  StatusBarAlignment,
  WidgetManager,
} from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import { ensureMathJax } from './mathjax-loader'
import { paperLabel } from './scholar-react'
import {
  SCHOLAR_ANNOTATIONS_WIDGET_ID,
  SCHOLAR_LIBRARY_WIDGET_ID,
  SCHOLAR_NAVIGATION_WIDGET_ID,
  ScholarAnnotationsWidget,
  ScholarLibraryWidget,
  ScholarNavigationWidget,
} from './scholar-side-widgets'
import { ScholarPaperWidget } from './scholar-paper-widget'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const ScholarCommands = {
  SHOW_LIBRARY: {
    id: 'scholar-agent.show-library',
    label: 'Scholar Agent: Show Papers',
  } satisfies Command,
  SHOW_NAVIGATION: {
    id: 'scholar-agent.show-navigation',
    label: 'Scholar Agent: Show Navigation',
  } satisfies Command,
  SHOW_ANNOTATIONS: {
    id: 'scholar-agent.show-annotations',
    label: 'Scholar Agent: Show Annotations',
  } satisfies Command,
  REFRESH_LIBRARY: {
    id: 'scholar-agent.refresh-library',
    label: 'Scholar Agent: Refresh Paper Library',
  } satisfies Command,
}

const STATUS_BAR_ID = 'scholar-agent.active-paper'

@injectable()
export class ScholarContribution implements
  FrontendApplicationContribution,
  CommandContribution,
  MenuContribution,
  KeybindingContribution {
  private readonly toDispose = new DisposableCollection()

  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(WidgetManager) private readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) private readonly shell: ApplicationShell,
    @inject(StatusBar) private readonly statusBar: StatusBar,
    @inject(MessageService) private readonly messageService: MessageService,
  ) {}

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
    })))
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
    const label = paper
      ? paperLabel(paper.filename, paper.paper_metadata?.title)
      : paperId

    await this.statusBar.setElement(STATUS_BAR_ID, {
      text: status
        ? `$(sync~spin) ${status}`
        : label
          ? `$(book) ${label}`
          : '$(book) Scholar Agent',
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      tooltip: status || label || 'Scholar Agent paper reader',
      command: ScholarCommands.SHOW_LIBRARY.id,
    })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}