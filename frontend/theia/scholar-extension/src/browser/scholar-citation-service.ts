import { MessageService } from '@theia/core'
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import { HttpReaderWorkspaceApi } from '../../../../lib/reader-workspace-api'
import type { CitationApi, CitationCard, CitationResolution } from '../../../../lib/citation-api'
import { paperLabel, revealDomNode } from './scholar-react'
import { SCHOLAR_PAPER_FACTORY_ID } from './scholar-paper-widget'
import type { ScholarPaperWidget } from './scholar-paper-widget'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const CITATION_FRAGMENT_NOT_FOUND_MESSAGE = "Couldn't locate the referenced fragment"

/**
 * Backs the citation popover: fetches bibliography cards, runs the lazy
 * resolve, and lands the reader on the referenced fragment of the cited
 * paper. When the resolution is honest about not finding an anchor
 * (`target_kind='none'`), the cited paper opens at the top with a message
 * instead of a guessed highlight.
 */
@injectable()
export class ScholarCitationService implements CitationApi {
  constructor(
    @inject(HttpReaderWorkspaceApi) private readonly api: HttpReaderWorkspaceApi,
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(WidgetManager) private readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) private readonly shell: ApplicationShell,
    @inject(MessageService) private readonly messageService: MessageService,
  ) {}

  getCitationCard(paperId: string, citeKey: string): Promise<CitationCard> {
    return this.api.getCitationCard(paperId, citeKey)
  }

  resolveCitation(
    paperId: string,
    citeKey: string,
    targetPaperId: string,
  ): Promise<CitationResolution> {
    return this.api.resolveCitation(paperId, citeKey, targetPaperId)
  }

  async openPaper(paperId: string): Promise<void> {
    const paper = this.store.getSnapshot().papers.find(entry => entry.id === paperId)
    const label = paper ? paperLabel(paper.filename, paper.title ?? undefined) : paperId
    const widget = await this.widgetManager.getOrCreateWidget<ScholarPaperWidget>(
      SCHOLAR_PAPER_FACTORY_ID,
      { paperId, label },
    )
    if (!widget.isAttached) {
      await this.shell.addWidget(widget, { area: 'main', mode: 'tab-after' })
    }
    this.store.activatePaper(paperId)
    await this.shell.activateWidget(widget.id)
  }

  async showFragment(targetPaperId: string, resolution: CitationResolution): Promise<void> {
    await this.openPaper(targetPaperId)
    const domNodeId = resolution.target_dom_node_id ?? resolution.target_section_id
    if (resolution.target_kind === 'none' || !domNodeId) {
      void this.messageService.info(CITATION_FRAGMENT_NOT_FOUND_MESSAGE)
      return
    }
    revealDomNode(targetPaperId, domNodeId, resolution.quote ?? undefined)
  }

  async importArxiv(arxivId: string): Promise<void> {
    try {
      const paper = await this.store.uploadArxiv(arxivId)
      await this.openPaper(paper.id)
    } catch (reason) {
      void this.messageService.error(
        `Could not fetch arXiv source: ${reason instanceof Error ? reason.message : String(reason)}`,
      )
    }
  }
}
