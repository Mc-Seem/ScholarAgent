import * as React from 'react'
import { FileText, Network, RefreshCw, Search, Trash2 } from 'lucide-react'
import { MessageService } from '@theia/core'
import { ConfirmDialog, ContextMenuRenderer, Message, ReactWidget } from '@theia/core/lib/browser'

import { HTMLRenderer } from '../../../../components/reader/HTMLRenderer'
import type { AnnotationContextMenuRequest } from '../../../../components/reader/InteractiveNode'
import SearchBar from '../../../../components/reader/SearchBar'
import type { TooltipUpdate } from '../../../../lib/reader-workspace-store'
import { paperLabel, useScholarSnapshot, useTooltipMaps } from './scholar-react'
import {
  SCHOLAR_PAPER_CONTEXT_MENU,
  type ScholarAnnotationTarget,
} from './scholar-annotation-service'
import type { ScholarWorkspaceService } from './scholar-workspace-service'

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
  private searchOpen = false

  constructor(
    private readonly store: ScholarWorkspaceService,
    private readonly messageService: MessageService,
    private readonly contextMenuRenderer: ContextMenuRenderer,
    readonly options: ScholarPaperWidgetOptions,
  ) {
    super()
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
    this.store.closePaper(this.options.paperId)
    super.onCloseRequest(message)
  }

  openSearch(): void {
    if (!this.searchOpen) {
      this.searchOpen = true
      this.update()
    }
  }

  closeSearch(): void {
    if (this.searchOpen) {
      this.searchOpen = false
      this.update()
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
        searchOpen={this.searchOpen}
        onOpenSearch={() => this.openSearch()}
        onCloseSearch={() => this.closeSearch()}
        onAnnotationContextMenu={request => this.openAnnotationMenu(request)}
        onDeleted={() => this.close()}
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
      this.title.label = label
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
  searchOpen: boolean
  onOpenSearch: () => void
  onCloseSearch: () => void
  onAnnotationContextMenu: (request: AnnotationContextMenuRequest) => void
  onDeleted: () => void
}

function ScholarPaperContent({
  store,
  messageService,
  paperId,
  searchOpen,
  onOpenSearch,
  onCloseSearch,
  onAnnotationContextMenu,
  onDeleted,
}: ScholarPaperContentProps): React.ReactElement {
  const snapshot = useScholarSnapshot(store)
  const paper = snapshot.papersById[paperId]
  const tooltips = snapshot.tooltipsByPaperId[paperId] ?? []
  const { tooltipMap, entityTooltipMap } = useTooltipMaps(tooltips)
  const loading = snapshot.loadingPaperIds.includes(paperId)
  const error = snapshot.paperErrors[paperId]
  const status = snapshot.statusByPaperId[paperId]
  const readerRootRef = React.useRef<HTMLDivElement>(null)

  const reportFailure = React.useCallback((action: string, reason: unknown) => {
    void messageService.error(`${action}: ${errorMessage(reason)}`)
  }, [messageService])

  const updateTooltip = React.useCallback((tooltipId: string, update: TooltipUpdate) => {
    void store.updateTooltip(paperId, tooltipId, update)
      .catch(reason => reportFailure('Could not update annotation', reason))
  }, [paperId, reportFailure, store])

  const handleDeletePaper = React.useCallback(async () => {
    const confirmed = await new ConfirmDialog({
      title: 'Delete Paper',
      msg: 'Delete this paper and all its annotations?',
      ok: 'Delete',
    }).open()
    if (!confirmed) {
      return
    }
    try {
      await store.deletePaper(paperId)
      onDeleted()
      void messageService.info('Paper deleted')
    } catch (reason) {
      reportFailure('Could not delete paper', reason)
    }
  }, [messageService, onDeleted, paperId, reportFailure, store])

  return (
    <div className="scholar-widget scholar-reader-widget" data-scholar-paper-id={paperId}>
      <div className="scholar-reader-toolbar">
        <span className="codicon codicon-book" aria-hidden="true" />
        <strong className="min-w-0 flex-1 truncate">
          {paper ? paperLabel(paper.filename, paper.paper_metadata?.title) : paperId}
        </strong>
        {status && <span className="truncate text-xs text-gray-500">{status}</span>}
        {searchOpen ? (
          <SearchBar
            isOpen
            onClose={onCloseSearch}
            searchRootRef={readerRootRef}
            placement="inline"
          />
        ) : (
          <button
            type="button"
            className="scholar-toolbar-button secondary"
            onClick={onOpenSearch}
            title="Find in paper (Ctrl/Cmd+F)"
          >
            <Search size={14} />
          </button>
        )}
        <button
          type="button"
          className="scholar-toolbar-button secondary"
          disabled={Boolean(status)}
          onClick={() => {
            void store.compilePaper(paperId)
              .catch(reason => reportFailure('Could not compile paper', reason))
          }}
          title="Recompile paper"
        >
          <RefreshCw size={14} />
          Compile
        </button>
        <button
          type="button"
          className="scholar-toolbar-button secondary"
          disabled={!paper?.has_html || Boolean(status)}
          onClick={() => {
            void store.buildKnowledgeGraph(paperId)
              .catch(reason => reportFailure('Could not build knowledge graph', reason))
          }}
          title="Build knowledge graph"
        >
          <Network size={14} />
          Graph
        </button>
        <button
          type="button"
          className="scholar-toolbar-button secondary"
          onClick={() => void handleDeletePaper()}
          title="Delete paper"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div ref={readerRootRef} className="scholar-reader-scroll">
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
            onEntityClick={entityId => store.setActiveEntity(paperId, entityId)}
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