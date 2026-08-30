import * as React from 'react'
import { CommandService, Disposable, Emitter, Event, SelectionService } from '@theia/core'
import { ApplicationShell, ReactWidget, WidgetManager } from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import type { SemanticTextEditor } from '../../../../components/reader/EditableSemanticText'
import {
  SemanticDetails,
  type ExplanationShortcut,
} from '../../../../components/reader/SemanticDetails'
import type {
  OtherPaperTermLink,
  SemanticLensOtherPapersProps,
} from '../../../../components/reader/SemanticLensOtherPapers'
import type { EquationDetails, SemanticSelection, SemanticSubjectDetails } from '../../../../lib/semantic-api'
import { semanticChatContext, ScholarChatService } from './scholar-chat-service'
import { ScholarCommands } from './scholar-commands'
import { SCHOLAR_GRAPH_SELECTION_KIND, ScholarGraphSelection } from './scholar-graph-selection'
import { navigateToPaperElement, paperLabel, revealSubjectOccurrences } from './scholar-react'
import { ScholarReadingSetService } from './scholar-reading-set-service'
import { SCHOLAR_PAPER_FACTORY_ID, ScholarPaperWidget } from './scholar-paper-widget'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const SCHOLAR_SEMANTIC_LENS_WIDGET_ID = 'scholar-agent:semantic-lens'

const LENS_EMPTY_MESSAGE = 'Select an equation or a highlighted term in the paper to open its lens.'
const EXPLANATION_REQUESTS: Record<ExplanationShortcut, (label: string) => string> = {
  deeper: label => `Explain the displayed definition of ${label} in more depth.`,
  simpler: label => `Explain the displayed definition of ${label} more simply.`,
  example: label => `Give me a concrete example of ${label}.`,
  connections: label => `Explain how ${label} connects to other concepts in this paper.`,
}

@injectable()
export class ScholarSemanticLensWidget extends ReactWidget {
  private selection: ScholarGraphSelection | undefined
  private subjectDetails: SemanticSubjectDetails | null = null
  private equationDetails: EquationDetails | null = null
  private detailsLoading = false
  private detailsError: string | null = null
  private updateVersion = 0
  private otherPapersLoading = false
  private alignmentBusyId: string | null = null
  private readonly selectionChangedEmitter = new Emitter<ScholarGraphSelection>()

  readonly onDidChangeSemanticSelection: Event<ScholarGraphSelection> =
    this.selectionChangedEmitter.event

  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(SelectionService) private readonly selectionService: SelectionService,
    @inject(ScholarChatService) private readonly chat: ScholarChatService,
    @inject(CommandService) private readonly commandService: CommandService,
    @inject(ScholarReadingSetService) private readonly readingSets: ScholarReadingSetService,
    @inject(WidgetManager) private readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) private readonly shell: ApplicationShell,
  ) {
    super()
    this.id = SCHOLAR_SEMANTIC_LENS_WIDGET_ID
    this.title.label = 'Semantic Lens'
    this.title.caption = 'Semantic and Equation Lens'
    this.title.iconClass = 'codicon codicon-inspect'
    this.title.closable = true
    this.node.classList.add('scholar-widget', 'scholar-side-widget', 'scholar-semantic-lens')
    this.toDispose.push(this.selectionChangedEmitter)
    this.toDispose.push(
      this.selectionService.onSelectionChanged(selection => this.applySelection(selection)),
    )
    // Reader wording is rendered inside the lens, so saving or restoring a note
    // anywhere has to repaint it.
    this.toDispose.push(Disposable.create(this.store.subscribe(() => this.update())))
    // Alignments live in the reading-set service; a confirm/reject or a fresh
    // "Link terms" build has to repaint the "In other papers" section.
    this.toDispose.push(Disposable.create(this.readingSets.subscribe(() => this.update())))
    this.applySelection(this.selectionService.selection, false)
    this.update()
  }

  get currentSelection(): ScholarGraphSelection | undefined {
    return this.selection
  }

  private applySelection(selection: unknown, notify = true): void {
    if (ScholarGraphSelection.is(selection)) {
      this.selection = selection
      this.resetDetails()
      this.loadSemanticDetails()
      const subject = this.subjectContextOf(selection)
      if (subject) {
        this.ensureOtherPaperLinks(subject.paperId)
      }
      this.update()
      if (notify) {
        this.selectionChangedEmitter.fire(selection)
      }
      return
    }
    // Only an explicit empty selection closes the lens. Selecting a tree row or
    // another unrelated widget keeps the current reading context visible.
    if (selection === undefined || selection === null) {
      this.selection = undefined
      this.resetDetails()
      this.update()
    }
  }

  private resetDetails(): void {
    this.updateVersion += 1
    this.subjectDetails = null
    this.equationDetails = null
    this.detailsLoading = false
    this.detailsError = null
    this.otherPapersLoading = false
    this.alignmentBusyId = null
  }

  private loadSemanticDetails(): void {
    const selection = this.selection
    if (!selection) {
      return
    }
    const payload = selection.payload
    const request = payload.kind === 'equation'
      ? this.store.loadEquationDetails(selection.paperId, payload.equationId)
      : payload.kind === 'node'
        ? this.store.loadSemanticSubject(selection.paperId, payload.id)
        : payload.kind === 'occurrence'
          ? this.store.loadSemanticSubject(selection.paperId, payload.subjectId)
          : undefined
    if (!request) {
      return
    }

    const updateVersion = this.updateVersion
    this.detailsLoading = true
    void request.then(details => {
      if (updateVersion !== this.updateVersion) return
      if (payload.kind === 'equation') {
        this.equationDetails = details as EquationDetails
      } else {
        this.subjectDetails = details as SemanticSubjectDetails
      }
      this.detailsLoading = false
      this.update()
    }).catch(error => {
      if (updateVersion !== this.updateVersion) return
      this.detailsLoading = false
      this.detailsError = error instanceof Error ? error.message : String(error)
      this.update()
    })
  }

  /** The (paper, subject) pair the lens is showing, when it shows a term. */
  private subjectContextOf(
    selection: ScholarGraphSelection | undefined,
  ): { paperId: string; subjectId: string } | undefined {
    if (!selection) {
      return undefined
    }
    const payload = selection.payload
    if (payload.kind === 'node') {
      return { paperId: selection.paperId, subjectId: payload.id }
    }
    if (payload.kind === 'occurrence') {
      return { paperId: selection.paperId, subjectId: payload.subjectId }
    }
    return undefined
  }

  /**
   * Makes sure every reading set that contains the paper has its alignments in
   * the service cache. The lens itself renders synchronously from that cache,
   * so this only has to trigger the misses and repaint when they land.
   */
  private ensureOtherPaperLinks(paperId: string): void {
    const updateVersion = this.updateVersion
    void this.readingSets.initialize().then(() => {
      const memberSets = this.readingSets.getSnapshot().readingSets
        .filter(set => set.papers.some(paper => paper.id === paperId))
      const missing = memberSets.filter(set => !this.readingSets.alignmentsOf(set.id))
      if (missing.length === 0) {
        this.update()
        return undefined
      }
      if (updateVersion === this.updateVersion) {
        this.otherPapersLoading = true
        this.update()
      }
      return Promise.allSettled(missing.map(set => this.readingSets.loadAlignments(set.id)))
        .then(() => {
          if (updateVersion !== this.updateVersion) return
          this.otherPapersLoading = false
          this.update()
        })
    }).catch(() => undefined)
  }

  /**
   * Collects the visible alignments of the active subject as rendered rows.
   * Rejected and stale links stay in the database but never reach the reading
   * surface; a pair kept in two reading sets yields one row per set because
   * confirm/reject acts on that set's own record.
   */
  private otherPaperLinks(paperId: string, subjectId: string): OtherPaperTermLink[] {
    const links: OtherPaperTermLink[] = []
    for (const set of this.readingSets.getSnapshot().readingSets) {
      if (!set.papers.some(paper => paper.id === paperId)) {
        continue
      }
      const alignments = this.readingSets.alignmentsOf(set.id)
      if (!alignments) {
        continue
      }
      for (const alignment of alignments) {
        if (alignment.status === 'rejected' || alignment.status === 'stale') {
          continue
        }
        const other = alignment.paper_a_id === paperId && alignment.subject_a_id === subjectId
          ? { paperId: alignment.paper_b_id, subjectId: alignment.subject_b_id, label: alignment.label_b }
          : alignment.paper_b_id === paperId && alignment.subject_b_id === subjectId
            ? { paperId: alignment.paper_a_id, subjectId: alignment.subject_a_id, label: alignment.label_a }
            : undefined
        if (!other) {
          continue
        }
        const paper = set.papers.find(member => member.id === other.paperId)
        links.push({
          alignmentId: alignment.id,
          readingSetId: set.id,
          paperId: other.paperId,
          subjectId: other.subjectId,
          paperTitle: paper ? paperLabel(paper.filename, paper.title ?? undefined) : 'Another paper',
          label: other.label,
          confidence: alignment.confidence,
          status: alignment.status === 'confirmed' ? 'confirmed' : 'auto',
          rationale: alignment.rationale,
        })
      }
    }
    return links
  }

  /**
   * Opens (or activates) the other paper and lands the reader on the aligned
   * term: active entity, lens selection, and a scroll to the first occurrence
   * through the same `.kg-entity` anchors a click in the paper would use.
   */
  private async openOtherPaperLink(link: OtherPaperTermLink): Promise<void> {
    const widget = await this.widgetManager.getOrCreateWidget<ScholarPaperWidget>(
      SCHOLAR_PAPER_FACTORY_ID,
      { paperId: link.paperId, label: link.paperTitle },
    )
    if (!widget.isAttached) {
      await this.shell.addWidget(widget, { area: 'main', mode: 'tab-after' })
    }
    await this.shell.activateWidget(widget.id)
    this.store.setActiveEntity(link.paperId, link.subjectId)
    const payload: SemanticSelection = {
      kind: 'node',
      id: link.subjectId,
      label: link.label,
      nodeType: 'semantic subject',
      incomingConnections: [],
      outgoingConnections: [],
    }
    this.store.setSemanticSelection(link.paperId, payload)
    this.selectionService.selection = ScholarGraphSelection.create(
      link.paperId,
      { kind: SCHOLAR_GRAPH_SELECTION_KIND, paperId: link.paperId, owner: this },
      payload,
    )
    revealSubjectOccurrences(link.paperId, link.subjectId)
  }

  private async judgeOtherPaperLink(
    link: OtherPaperTermLink,
    verdict: 'confirm' | 'reject',
  ): Promise<void> {
    this.alignmentBusyId = link.alignmentId
    this.update()
    try {
      if (verdict === 'confirm') {
        await this.readingSets.confirmAlignment(link.readingSetId, link.alignmentId)
      } else {
        await this.readingSets.rejectAlignment(link.readingSetId, link.alignmentId)
      }
    } catch {
      // The row simply keeps its previous state; the next click retries.
    } finally {
      this.alignmentBusyId = null
      this.update()
    }
  }

  private otherPapersProps(
    selection: ScholarGraphSelection,
  ): SemanticLensOtherPapersProps | undefined {
    const subject = this.subjectContextOf(selection)
    if (!subject) {
      return undefined
    }
    return {
      links: this.otherPaperLinks(subject.paperId, subject.subjectId),
      loading: this.otherPapersLoading,
      busyAlignmentId: this.alignmentBusyId,
      onOpen: link => {
        void this.openOtherPaperLink(link).catch(() => undefined)
      },
      onConfirm: link => {
        void this.judgeOtherPaperLink(link, 'confirm')
      },
      onReject: link => {
        void this.judgeOtherPaperLink(link, 'reject')
      },
    }
  }

  /**
   * Collects the reader's own wording for every subject of the active paper.
   *
   * Notes are keyed by semantic subject, so an applied tooltip for a term and a
   * correction typed into a notation row are the same record; the lens shows one
   * text per subject instead of stacking the agent's and the reader's versions.
   */
  private semanticEditor(paperId: string): SemanticTextEditor {
    const tooltips = this.store.getSnapshot().tooltipsByPaperId[paperId] ?? []
    const notesBySubjectId: Record<string, string> = {}
    for (const tooltip of tooltips) {
      if (tooltip.entity_id && tooltip.is_user_override === true) {
        notesBySubjectId[tooltip.entity_id] = tooltip.content
      }
    }
    return {
      notesBySubjectId,
      onSave: (subjectId, content, targetText) =>
        this.store.saveSemanticNote(paperId, subjectId, content, targetText).then(() => undefined),
      onRestore: subjectId => this.store.clearSemanticNote(paperId, subjectId),
    }
  }

  private readonly askAboutEntity = (): void => {
    const selection = this.selection
    if (!selection) return
    const context = semanticChatContext(selection.payload)
    if (!context) return
    this.chat.setNextContextForPaper(selection.paperId, context)
    void this.commandService.executeCommand(ScholarCommands.SHOW_CHAT.id)
  }

  private readonly requestExplanation = (shortcut: ExplanationShortcut): void => {
    const selection = this.selection
    const details = this.subjectDetails
    if (!selection || !details?.explanation) return
    const context = semanticChatContext(selection.payload)
    if (!context) return
    void this.commandService.executeCommand(ScholarCommands.SHOW_CHAT.id)
    void this.chat.sendMessage(EXPLANATION_REQUESTS[shortcut](details.subject.label), context)
  }

  protected override render(): React.ReactNode {
    const selection = this.selection
    if (!selection) {
      return (
        <div className="scholar-semantic-lens-empty theia-widget-noInfo">
          {LENS_EMPTY_MESSAGE}
        </div>
      )
    }
    return (
      <SemanticDetails
        selection={selection.payload}
        subjectDetails={this.subjectDetails}
        equationDetails={this.equationDetails}
        loading={this.detailsLoading}
        error={this.detailsError}
        editor={this.semanticEditor(selection.paperId)}
        onAskAboutEntity={semanticChatContext(selection.payload) ? this.askAboutEntity : undefined}
        onRequestExplanation={semanticChatContext(selection.payload) && this.subjectDetails?.explanation
          ? this.requestExplanation
          : undefined}
        otherPapers={this.otherPapersProps(selection)}
        onNavigate={dataId => navigateToPaperElement(selection.paperId, dataId)}
      />
    )
  }
}
