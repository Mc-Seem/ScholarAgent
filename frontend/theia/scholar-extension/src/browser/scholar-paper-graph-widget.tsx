import * as React from 'react'
import { Emitter, Event, SelectionService } from '@theia/core'
import { Message, ReactWidget } from '@theia/core/lib/browser'

import {
  KnowledgeGraphView,
  type KnowledgeGraphSelection,
} from '../../../../components/reader/KnowledgeGraphView'
import type {
  KnowledgeGraphController,
  KnowledgeGraphControllerSnapshot,
} from '../../../../components/reader/knowledge-graph-controller'
import {
  SCHOLAR_GRAPH_SELECTION_KIND,
  ScholarGraphSelection,
  type ScholarGraphSelectionSource,
} from './scholar-graph-selection'
import { navigateToPaperElement } from './scholar-react'

export const SCHOLAR_PAPER_GRAPH_FACTORY_ID = 'scholar-agent:paper-graph'

export interface ScholarPaperGraphWidgetOptions {
  paperId: string
}

export function isScholarPaperGraphWidgetOptions(
  value: unknown,
): value is ScholarPaperGraphWidgetOptions {
  if (!value || typeof value !== 'object') {
    return false
  }
  const options = value as Partial<ScholarPaperGraphWidgetOptions>
  return typeof options.paperId === 'string'
    && options.paperId.trim().length > 0
}

export class ScholarPaperGraphWidget extends ReactWidget {
  private readonly selectionSource: ScholarGraphSelectionSource
  private readonly graphStateChangedEmitter = new Emitter<void>()
  private graphController: KnowledgeGraphController | undefined
  private graphControllerUnsubscribe: (() => void) | undefined
  private bridgeDisposed = false

  readonly onDidChangeGraphState: Event<void> = this.graphStateChangedEmitter.event

  constructor(
    private readonly selectionService: SelectionService,
    readonly options: ScholarPaperGraphWidgetOptions,
  ) {
    super()
    this.selectionSource = {
      kind: SCHOLAR_GRAPH_SELECTION_KIND,
      paperId: options.paperId,
      owner: this,
    }
    this.id = `${SCHOLAR_PAPER_GRAPH_FACTORY_ID}:${encodeURIComponent(options.paperId)}`
    this.updateLabel(options.paperId)
    this.title.iconClass = 'codicon codicon-type-hierarchy'
    this.title.closable = true
    this.node.tabIndex = 0
    this.node.classList.add('scholar-widget', 'scholar-paper-graph-widget')
    this.update()
  }

  updateLabel(label: string): void {
    const displayLabel = label || this.options.paperId
    this.title.label = `Graph: ${displayLabel}`
    this.title.caption = `Knowledge Graph — ${displayLabel}`
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    this.node.focus({ preventScroll: true })
  }

  protected override onAfterHide(message: Message): void {
    super.onAfterHide(message)
    this.clearSelection()
  }

  protected override onCloseRequest(message: Message): void {
    this.clearSelection()
    super.onCloseRequest(message)
  }

  override dispose(): void {
    if (this.bridgeDisposed) {
      return
    }
    this.clearSelection()
    this.setGraphController(null)
    this.bridgeDisposed = true
    super.dispose()
    this.graphStateChangedEmitter.dispose()
  }

  getGraphController(): KnowledgeGraphController | undefined {
    return this.graphController
  }

  getGraphSnapshot(): KnowledgeGraphControllerSnapshot | undefined {
    return this.graphController?.getSnapshot()
  }

  revealNode(nodeId: string): void {
    this.graphController?.revealNode(nodeId)
  }

  setVisibleTypes(nodeTypes: readonly string[], edgeTypes: readonly string[]): void {
    this.graphController?.setVisibleTypes(nodeTypes, edgeTypes)
  }

  focusSelection(): void {
    this.graphController?.focusSelection()
  }

  clearFocus(): void {
    this.graphController?.clearFocus()
  }

  resetLayout(): void {
    this.graphController?.resetLayout()
  }

  revealSelectionInPaper(): void {
    this.graphController?.revealSelectionInPaper()
  }

  private publishSelection(selection: KnowledgeGraphSelection | null): void {
    if (!selection) {
      this.clearSelection()
      return
    }
    this.selectionService.selection = ScholarGraphSelection.create(
      this.options.paperId,
      this.selectionSource,
      selection,
    )
  }

  private clearSelection(): void {
    if (ScholarGraphSelection.isSource(this.selectionService.selection, this.selectionSource)) {
      this.selectionService.selection = undefined
    }
  }

  private readonly handleNavigate = (dataId: string): void => {
    navigateToPaperElement(this.options.paperId, dataId)
  }

  private readonly handleSelectionChange = (selection: KnowledgeGraphSelection | null): void => {
    this.publishSelection(selection)
  }

  private readonly handleControllerChange = (controller: KnowledgeGraphController | null): void => {
    if (this.bridgeDisposed) {
      return
    }
    this.setGraphController(controller)
  }

  private setGraphController(controller: KnowledgeGraphController | null): void {
    const nextController = controller ?? undefined
    if (this.graphController === nextController) {
      return
    }

    this.graphControllerUnsubscribe?.()
    this.graphControllerUnsubscribe = undefined
    this.graphController = nextController

    if (nextController) {
      this.graphControllerUnsubscribe = nextController.subscribe(() => {
        if (!this.bridgeDisposed && this.graphController === nextController) {
          this.graphStateChangedEmitter.fire()
        }
      })
    }
    this.graphStateChangedEmitter.fire()
  }

  protected override render(): React.ReactNode {
    const { paperId } = this.options
    return (
      <KnowledgeGraphView
        key={paperId}
        paperId={paperId}
        onNavigate={this.handleNavigate}
        onSelectionChange={this.handleSelectionChange}
        onControllerChange={this.handleControllerChange}
        showEmbeddedControls={false}
        showSelectionDetails={false}
      />
    )
  }
}
