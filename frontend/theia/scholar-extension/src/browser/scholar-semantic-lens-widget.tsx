import * as React from 'react'
import { CommandService, Disposable, Emitter, Event, SelectionService } from '@theia/core'
import { ReactWidget } from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import type { SemanticTextEditor } from '../../../../components/reader/EditableSemanticText'
import { SemanticDetails } from '../../../../components/reader/SemanticDetails'
import type { EquationDetails, SemanticSubjectDetails } from '../../../../lib/semantic-api'
import { semanticChatContext, ScholarChatService } from './scholar-chat-service'
import { ScholarCommands } from './scholar-commands'
import { ScholarGraphSelection } from './scholar-graph-selection'
import { navigateToPaperElement } from './scholar-react'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const SCHOLAR_SEMANTIC_LENS_WIDGET_ID = 'scholar-agent:semantic-lens'

const LENS_EMPTY_MESSAGE = 'Select an equation or a highlighted term in the paper to open its lens.'

@injectable()
export class ScholarSemanticLensWidget extends ReactWidget {
  private selection: ScholarGraphSelection | undefined
  private subjectDetails: SemanticSubjectDetails | null = null
  private equationDetails: EquationDetails | null = null
  private detailsLoading = false
  private detailsError: string | null = null
  private updateVersion = 0
  private readonly selectionChangedEmitter = new Emitter<ScholarGraphSelection>()

  readonly onDidChangeSemanticSelection: Event<ScholarGraphSelection> =
    this.selectionChangedEmitter.event

  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(SelectionService) private readonly selectionService: SelectionService,
    @inject(ScholarChatService) private readonly chat: ScholarChatService,
    @inject(CommandService) private readonly commandService: CommandService,
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
        onNavigate={dataId => navigateToPaperElement(selection.paperId, dataId)}
      />
    )
  }
}
