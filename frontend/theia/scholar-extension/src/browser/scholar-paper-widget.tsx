import * as React from 'react'
import { FileText } from 'lucide-react'
import { Emitter, Event, MessageService, SelectionService } from '@theia/core'
import { ContextMenuRenderer, Message, ReactWidget } from '@theia/core/lib/browser'

import { HTMLRenderer } from '../../../../components/reader/HTMLRenderer'
import type { AnnotationContextMenuRequest } from '../../../../components/reader/InteractiveNode'
import {
  createPaperSearchController,
  type PaperSearchController,
  type PaperSearchControllerSnapshot,
} from '../../../../components/reader/paper-search-controller'
import type { TooltipUpdate } from '../../../../lib/reader-workspace-store'
import type { ChatContext } from '../../../../lib/chat-api'
import type { SemanticSelection } from '../../../../lib/semantic-api'
import { paperLabel, truncateLabel, useScholarSnapshot, useTooltipMaps } from './scholar-react'
import {
  SCHOLAR_PAPER_CONTEXT_MENU,
  type ScholarAnnotationService,
  type ScholarAnnotationTarget,
} from './scholar-annotation-service'
import type { ScholarWorkspaceService } from './scholar-workspace-service'
import { semanticChatContext, type ScholarChatService } from './scholar-chat-service'
import {
  SCHOLAR_GRAPH_SELECTION_KIND,
  ScholarGraphSelection,
  type ScholarGraphSelectionSource,
} from './scholar-graph-selection'

export const SCHOLAR_PAPER_FACTORY_ID = 'scholar-agent:paper'

export interface ScholarPaperWidgetOptions {
  paperId: string
  label: string
}

export function isScholarPaperWidgetOptions(value: unknown): value is ScholarPaperWidgetOptions {
  if (!value || typeof value !== 'object') {
    return false
  }
  const options = value as Partial<ScholarPaperWidgetOptions>
  return typeof options.paperId === 'string'
    && options.paperId.trim().length > 0
    && typeof options.label === 'string'
}

export class ScholarPaperWidget extends ReactWidget {
  private loadStarted = false
  private readonly searchStateChangedEmitter = new Emitter<void>()
  private readonly searchController: PaperSearchController
  private readonly searchControllerUnsubscribe: () => void
  private searchDisposed = false
  private readonly selectionSource: ScholarGraphSelectionSource

  readonly onDidChangeSearchState: Event<void> = this.searchStateChangedEmitter.event

  constructor(
    private readonly store: ScholarWorkspaceService,
    private readonly messageService: MessageService,
    private readonly contextMenuRenderer: ContextMenuRenderer,
    readonly options: ScholarPaperWidgetOptions,
    private readonly annotations: ScholarAnnotationService,
    private readonly selectionService: SelectionService,
    private readonly chat?: ScholarChatService,
  ) {
    super()
    this.selectionSource = {
      kind: SCHOLAR_GRAPH_SELECTION_KIND,
      paperId: options.paperId,
      owner: this,
    }
    this.searchController = createPaperSearchController({
      getSearchRoot: () => this.node.querySelector<HTMLElement>(
        '.scholar-reader-scroll .html-renderer',
      ),
    })
    this.searchControllerUnsubscribe = this.searchController.subscribe(() => {
      if (!this.searchDisposed) {
        this.searchStateChangedEmitter.fire()
      }
    })
    this.id = `scholar-agent:paper:${encodeURIComponent(options.paperId)}`
    this.title.label = options.label || options.paperId
    this.title.caption = options.label || options.paperId
    this.title.iconClass = 'codicon codicon-book'
    this.title.closable = true
    this.node.tabIndex = 0
    this.node.classList.add('scholar-widget', 'scholar-reader-widget')
    this.update()
  }

  protected override onAfterAttach(message: Message): void {
    super.onAfterAttach(message)
    this.loadPaper()
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    this.store.activatePaper(this.options.paperId)
    this.node.focus({ preventScroll: true })
  }

  protected override onCloseRequest(message: Message): void {
    this.clearSemanticSelection()
    this.store.closePaper(this.options.paperId)
    super.onCloseRequest(message)
  }

  override dispose(): void {
    if (this.searchDisposed) {
      return
    }
    this.searchDisposed = true
    this.clearSemanticSelection()
    this.searchControllerUnsubscribe()
    this.searchController.dispose()
    super.dispose()
    this.searchStateChangedEmitter.dispose()
  }

  getSearchController(): PaperSearchController {
    return this.searchController
  }

  getSearchSnapshot(): PaperSearchControllerSnapshot {
    return this.searchController.getSnapshot()
  }

  openSearch(): void {
    this.searchController.open()
  }

  closeSearch(): void {
    this.searchController.close()
  }

  setSearchQuery(query: string): void {
    this.searchController.setQuery(query)
  }

  nextSearchMatch(): void {
    this.searchController.next()
  }

  previousSearchMatch(): void {
    this.searchController.previous()
  }

  refreshSearch(): void {
    this.searchController.refresh()
  }

  private readonly handleContentChanged = (): void => {
    this.refreshSearch()
  }

  private readonly handleSemanticSelection = (selection: SemanticSelection): void => {
    this.store.setSemanticSelection(this.options.paperId, selection)
    this.selectionService.selection = ScholarGraphSelection.create(
      this.options.paperId,
      this.selectionSource,
      selection,
    )
    const context = semanticChatContext(selection)
    if (context) this.chat?.setNextContextForPaper(this.options.paperId, context)
  }

  private readonly handleTextSelection = (context: ChatContext | null): void => {
    this.chat?.setNextContextForPaper(this.options.paperId, context)
  }

  private readonly handleCurrentSection = (sectionId: string | null): void => {
    this.chat?.setCurrentSection(this.options.paperId, sectionId)
  }

  private clearSemanticSelection(): void {
    this.store.setSemanticSelection(this.options.paperId, null)
    if (ScholarGraphSelection.isSource(this.selectionService.selection, this.selectionSource)) {
      this.selectionService.selection = undefined
    }
  }

  openAnnotationMenu(request: AnnotationContextMenuRequest): void {
    const semanticTooltip = request.tooltips.find(tooltip => Boolean(tooltip.entity_id))
    const target: ScholarAnnotationTarget = {
      paperId: this.options.paperId,
      domNodeId: request.dataId,
      targetText: request.targetText,
      tooltipIds: request.tooltips.map(tooltip => tooltip.id),
      semanticTooltipId: semanticTooltip?.id,
    }
    const targetBounds = request.target.getBoundingClientRect()
    this.contextMenuRenderer.render({
      menuPath: SCHOLAR_PAPER_CONTEXT_MENU,
      anchor: request.clientX || request.clientY
        ? { x: request.clientX, y: request.clientY }
        : { x: targetBounds.left, y: targetBounds.bottom },
      context: request.target,
      args: [target],
    })
  }

  protected override render(): React.ReactNode {
    return (
      <ScholarPaperContent
        store={this.store}
        messageService={this.messageService}
        paperId={this.options.paperId}
        annotations={this.annotations}
        onContentChanged={this.handleContentChanged}
        onAnnotationContextMenu={request => this.openAnnotationMenu(request)}
        onSemanticSelect={this.handleSemanticSelection}
        onTextSelection={this.handleTextSelection}
        onCurrentSection={this.handleCurrentSection}
      />
    )
  }

  private loadPaper(): void {
    if (this.loadStarted) {
      return
    }
    this.loadStarted = true
    void this.store.openPaper(this.options.paperId).then(paper => {
      const label = paperLabel(paper.filename, paper.paper_metadata?.title)
      this.title.label = truncateLabel(label)
      this.title.caption = label
    }).catch(error => {
      void this.messageService.error(`Could not load paper: ${errorMessage(error)}`)
    })
  }
}

interface ScholarPaperContentProps {
  store: ScholarWorkspaceService
  messageService: MessageService
  paperId: string
  annotations: ScholarAnnotationService
  onContentChanged: () => void
  onAnnotationContextMenu: (request: AnnotationContextMenuRequest) => void
  onSemanticSelect: (selection: SemanticSelection) => void
  onTextSelection: (context: ChatContext | null) => void
  onCurrentSection: (sectionId: string | null) => void
}

function ScholarPaperContent({
  store,
  messageService,
  paperId,
  annotations,
  onContentChanged,
  onAnnotationContextMenu,
  onSemanticSelect,
  onTextSelection,
  onCurrentSection,
}: ScholarPaperContentProps): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const snapshot = useScholarSnapshot(store)
  const paper = snapshot.papersById[paperId]
  const tooltips = snapshot.tooltipsByPaperId[paperId] ?? []
  const { tooltipMap, entityTooltipMap } = useTooltipMaps(tooltips)
  const loading = snapshot.loadingPaperIds.includes(paperId)
  const error = snapshot.paperErrors[paperId]

  React.useLayoutEffect(() => {
    onContentChanged()
  }, [error, loading, onContentChanged, paper?.html_content, tooltips])

  React.useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !paper?.html_content) return
    const renderer = scroll.querySelector<HTMLElement>('.html-renderer')
    if (!renderer) return

    const captureSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        onTextSelection(null)
        return
      }
      const range = selection.getRangeAt(0)
      if (!renderer.contains(range.startContainer) || !renderer.contains(range.endContainer)) {
        onTextSelection(null)
        return
      }
      const quote = selection.toString().trim()
      if (!quote) {
        onTextSelection(null)
        return
      }
      const startElement = range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
      const source = startElement?.closest<HTMLElement>('[data-id]')
      if (!source || !renderer.contains(source)) {
        onTextSelection(null)
        return
      }
      const section = source.matches('section[data-id]')
        ? source
        : source.closest<HTMLElement>('section[data-id]')
      onTextSelection({
        kind: 'selection',
        data_id: source.dataset.id,
        section_id: section?.dataset.id,
        quote,
      })
    }

    const reportCurrentSection = () => {
      const sections = Array.from(renderer.querySelectorAll<HTMLElement>('section[data-id]'))
      if (sections.length === 0) {
        onCurrentSection(null)
        return
      }
      const scrollTop = scroll.getBoundingClientRect().top
      const current = sections.reduce((best, section) => {
        const distance = Math.abs(section.getBoundingClientRect().top - scrollTop)
        return distance < best.distance ? { section, distance } : best
      }, { section: sections[0], distance: Number.POSITIVE_INFINITY }).section
      onCurrentSection(current.dataset.id ?? null)
    }

    renderer.addEventListener('mouseup', captureSelection)
    renderer.addEventListener('keyup', captureSelection)
    scroll.addEventListener('scroll', reportCurrentSection, { passive: true })
    reportCurrentSection()
    return () => {
      renderer.removeEventListener('mouseup', captureSelection)
      renderer.removeEventListener('keyup', captureSelection)
      scroll.removeEventListener('scroll', reportCurrentSection)
    }
  }, [onCurrentSection, onTextSelection, paper?.html_content])

  const reportFailure = React.useCallback((action: string, reason: unknown) => {
    void messageService.error(`${action}: ${errorMessage(reason)}`)
  }, [messageService])

  const updateTooltip = React.useCallback((tooltipId: string, update: TooltipUpdate) => {
    void store.updateTooltip(paperId, tooltipId, update)
      .catch(reason => reportFailure('Could not update annotation', reason))
  }, [paperId, reportFailure, store])

  return (
    <div className="scholar-widget scholar-reader-widget" data-scholar-paper-id={paperId}>
      <div ref={scrollRef} className="scholar-reader-scroll">
        {loading && !paper && <div className="scholar-loading">Loading paper…</div>}
        {error && !paper && (
          <div className="scholar-error">
            <p>{error}</p>
            <button
              type="button"
              className="scholar-toolbar-button"
              onClick={() => {
                void store.openPaper(paperId)
                  .catch(reason => reportFailure('Could not load paper', reason))
              }}
            >
              Retry
            </button>
          </div>
        )}
        {paper && !paper.html_content && (
          <div className="scholar-empty">
            <FileText size={40} className="mx-auto mb-3 opacity-50" />
            <p>This paper has not been compiled yet.</p>
          </div>
        )}
        {paper?.html_content && (
          <HTMLRenderer
            html={paper.html_content}
            paperId={paperId}
            tooltips={tooltipMap}
            entityTooltipMap={entityTooltipMap}
            onTooltipCreate={(domNodeId, content, targetText) => {
              void store.createTooltip(paperId, domNodeId, content, targetText)
                .catch(reason => reportFailure('Could not create annotation', reason))
            }}
            onTooltipUpdate={(tooltipId, content, targetText) => {
              updateTooltip(tooltipId, { content, targetText })
            }}
            onTooltipDelete={tooltipId => {
              void store.deleteTooltip(paperId, tooltipId)
                .catch(reason => reportFailure('Could not delete annotation', reason))
            }}
            onTooltipRemoveOccurrence={(tooltipId, domNodeId) => {
              void store.removeTooltipOccurrence(paperId, tooltipId, domNodeId)
                .catch(reason => reportFailure('Could not remove annotation occurrence', reason))
            }}
            onEntityClick={entityId => {
              store.setActiveEntity(paperId, entityId)
              const tooltip = entityTooltipMap[entityId]
              if (tooltip) {
                annotations.select(paperId, tooltip.id)
              }
            }}
            onSemanticSelect={onSemanticSelect}
            annotationActivation="context-menu"
            onAnnotationContextMenu={onAnnotationContextMenu}
          />
        )}
      </div>
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}