import * as React from 'react'
import { CommandService, Disposable, Emitter, Event, SelectionService } from '@theia/core'
import { ReactWidget } from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import type { SemanticNote } from '../../../../components/reader/SemanticDetails'
import { SemanticDetails } from '../../../../components/reader/SemanticDetails'
import type { Tooltip } from '../../../../hooks/useTooltips'
import type { EquationDetails, SemanticSubjectDetails } from '../../../../lib/semantic-api'
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
    @inject(CommandService) private readonly commands: CommandService,
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
    // Saved notes are rendered inside the lens, so edits made in the annotation
    // editor have to repaint it.
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
   * Finds the reader's own explanation of the current subject: an entity-wide
   * tooltip for a term, or the comment anchored to the equation node.
   */
  private resolveNote(selection: ScholarGraphSelection): Tooltip | undefined {
    const tooltips = this.store.getSnapshot().tooltipsByPaperId[selection.paperId] ?? []
    const payload = selection.payload
    if (payload.kind === 'equation') {
      return tooltips.find(tooltip => tooltip.dom_node_id === payload.equationId)
    }
    const subjectId = payload.kind === 'node'
      ? payload.id
      : payload.kind === 'occurrence'
        ? payload.subjectId
        : undefined
    return subjectId ? tooltips.find(tooltip => tooltip.entity_id === subjectId) : undefined
  }

  private editNote(paperId: string, tooltip: Tooltip): void {
    // Reuse the annotation editor rather than duplicating an editing surface:
    // the contribution reveals it as soon as a draft appears.
    void this.commands.executeCommand(ScholarCommands.EDIT_ANNOTATION.id, {
      paperId,
      domNodeId: tooltip.dom_node_id ?? '',
      tooltipIds: [tooltip.id],
    })
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
    const tooltip = this.resolveNote(selection)
    const note: SemanticNote | null = tooltip
      ? { id: tooltip.id, content: tooltip.content, targetText: tooltip.target_text }
      : null
    return (
      <SemanticDetails
        selection={selection.payload}
        subjectDetails={this.subjectDetails}
        equationDetails={this.equationDetails}
        loading={this.detailsLoading}
        error={this.detailsError}
        note={note}
        onEditNote={tooltip ? () => this.editNote(selection.paperId, tooltip) : undefined}
        onNavigate={dataId => navigateToPaperElement(selection.paperId, dataId)}
      />
    )
  }
}
