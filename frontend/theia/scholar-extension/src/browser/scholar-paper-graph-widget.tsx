import * as React from 'react'
import { SelectionService } from '@theia/core'
import { Message, ReactWidget } from '@theia/core/lib/browser'

import {
  KnowledgeGraphView,
  type KnowledgeGraphSelection,
} from '../../../../components/reader/KnowledgeGraphView'
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
    this.clearSelection()
    super.dispose()
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

  protected override render(): React.ReactNode {
    const { paperId } = this.options
    return (
      <KnowledgeGraphView
        key={paperId}
        paperId={paperId}
        onNavigate={dataId => navigateToPaperElement(paperId, dataId)}
        onSelectionChange={selection => this.publishSelection(selection)}
        showSelectionDetails={false}
      />
    )
  }
}
