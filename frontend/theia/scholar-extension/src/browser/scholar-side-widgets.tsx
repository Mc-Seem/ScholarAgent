import * as React from 'react'
import { ExternalLink, FileText, RefreshCw, SplitSquareHorizontal, Upload } from 'lucide-react'
import { MessageService } from '@theia/core'
import {
  ApplicationShell,
  Message,
  ReactWidget,
  WidgetManager,
} from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import type { Paper } from '../../../../hooks/usePapers'
import {
  paperLabel,
  useScholarSnapshot,
} from './scholar-react'
import {
  SCHOLAR_PAPER_FACTORY_ID,
  ScholarPaperWidget,
  type ScholarPaperWidgetOptions,
} from './scholar-paper-widget'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const SCHOLAR_LIBRARY_WIDGET_ID = 'scholar-agent:library'
export const SCHOLAR_NAVIGATION_WIDGET_ID = 'scholar-agent:navigation'
export const SCHOLAR_ANNOTATIONS_WIDGET_ID = 'scholar-agent:annotations'

@injectable()
export class ScholarLibraryWidget extends ReactWidget {
  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(WidgetManager) private readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) private readonly shell: ApplicationShell,
    @inject(MessageService) private readonly messageService: MessageService,
  ) {
    super()
    this.id = SCHOLAR_LIBRARY_WIDGET_ID
    this.title.label = 'Papers'
    this.title.caption = 'Paper Library'
    this.title.iconClass = 'codicon codicon-library'
    this.title.closable = true
    this.node.tabIndex = 0
    this.node.classList.add('scholar-widget', 'scholar-side-widget')
    this.update()
  }

  async openPaper(paper: Paper, openToSide = false): Promise<void> {
    const options: ScholarPaperWidgetOptions = {
      paperId: paper.id,
      label: paperLabel(paper.filename),
    }
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

    this.store.activatePaper(paper.id)
    await this.shell.activateWidget(widget.id)
  }

  protected override render(): React.ReactNode {
    return (
      <ScholarLibraryContent
        store={this.store}
        messageService={this.messageService}
        onOpenPaper={(paper, openToSide) => this.openPaper(paper, openToSide)}
      />
    )
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    this.node.focus({ preventScroll: true })
  }
}

interface ScholarLibraryContentProps {
  store: ScholarWorkspaceService
  messageService: MessageService
  onOpenPaper: (paper: Paper, openToSide: boolean) => Promise<void>
}

function ScholarLibraryContent({
  store,
  messageService,
  onOpenPaper,
}: ScholarLibraryContentProps): React.ReactElement {
  const snapshot = useScholarSnapshot(store)
  const [arxivInput, setArxivInput] = React.useState('')
  const [working, setWorking] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)

  const reportFailure = React.useCallback((action: string, reason: unknown) => {
    void messageService.error(`${action}: ${errorMessage(reason)}`)
  }, [messageService])

  const uploadFile = React.useCallback(async (file: File) => {
    setWorking(true)
    try {
      const paper = await store.uploadPaper(file)
      await onOpenPaper(paper, false)
    } catch (reason) {
      reportFailure('Could not upload paper', reason)
    } finally {
      setWorking(false)
    }
  }, [onOpenPaper, reportFailure, store])

  const uploadArxiv = React.useCallback(async () => {
    if (!arxivInput.trim()) {
      return
    }
    setWorking(true)
    try {
      const paper = await store.uploadArxiv(arxivInput)
      setArxivInput('')
      await onOpenPaper(paper, false)
    } catch (reason) {
      reportFailure('Could not fetch arXiv source', reason)
    } finally {
      setWorking(false)
    }
  }, [arxivInput, onOpenPaper, reportFailure, store])

  return (
    <div className="scholar-widget scholar-side-widget">
      <div className="space-y-2 border-b border-slate-200 p-2">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept=".tar.gz,.tgz,.zip,.tex"
          onChange={event => {
            const file = event.target.files?.[0]
            if (file) {
              void uploadFile(file)
            }
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className="scholar-toolbar-button w-full"
          disabled={working}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} />
          Upload LaTeX
        </button>
        <form
          className="flex gap-1"
          onSubmit={event => {
            event.preventDefault()
            void uploadArxiv()
          }}
        >
          <input
            className="scholar-field min-w-0 flex-1"
            value={arxivInput}
            disabled={working}
            onChange={event => setArxivInput(event.target.value)}
            placeholder="arXiv id or URL"
            aria-label="arXiv id or URL"
          />
          <button
            type="submit"
            className="scholar-toolbar-button secondary"
            disabled={working || !arxivInput.trim()}
            title="Fetch arXiv source"
          >
            <ExternalLink size={14} />
          </button>
        </form>
      </div>

      <div className="flex items-center justify-between px-2 pt-2">
        <strong>Library</strong>
        <button
          type="button"
          className="scholar-toolbar-button secondary"
          disabled={snapshot.libraryLoading}
          onClick={() => {
            void store.loadLibrary().catch(reason => reportFailure('Could not refresh library', reason))
          }}
          title="Refresh library"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {snapshot.libraryError && <div className="scholar-error">{snapshot.libraryError}</div>}
      {snapshot.libraryLoading && snapshot.papers.length === 0 && (
        <div className="scholar-loading">Loading library…</div>
      )}
      {!snapshot.libraryLoading && snapshot.papers.length === 0 && (
        <div className="scholar-empty">
          <FileText size={32} className="mx-auto mb-2 opacity-50" />
          No papers yet
        </div>
      )}

      <div className="scholar-library-list">
        {snapshot.papers.map(paper => (
          <div
            key={paper.id}
            className="scholar-library-item"
            data-active={snapshot.activePaperId === paper.id || undefined}
          >
            <button
              type="button"
              className="scholar-library-title text-left"
              title={paper.filename}
              onClick={() => void onOpenPaper(paper, false)}
            >
              {paperLabel(paper.filename)}
            </button>
            <button
              type="button"
              className="scholar-toolbar-button secondary"
              title="Open to the right"
              onClick={() => void onOpenPaper(paper, true)}
            >
              <SplitSquareHorizontal size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}