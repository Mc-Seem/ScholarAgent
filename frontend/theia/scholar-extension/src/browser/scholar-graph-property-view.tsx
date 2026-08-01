import * as React from 'react'
import { ReactWidget } from '@theia/core/lib/browser'
import { PropertyDataService } from '@theia/property-view/lib/browser/property-data-service'
import { PropertyViewContentWidget } from '@theia/property-view/lib/browser/property-view-content-widget'
import { PropertyViewWidgetProvider } from '@theia/property-view/lib/browser/property-view-widget-provider'
import { inject, injectable, interfaces, optional } from '@theia/core/shared/inversify'

import type { ConnectionInfo } from '../../../../components/reader/NodeInfoPanel'
import { SemanticDetails } from '../../../../components/reader/SemanticDetails'
import type { EquationDetails, SemanticSubjectDetails } from '../../../../lib/semantic-api'
import { ScholarGraphSelection } from './scholar-graph-selection'
import { navigateToPaperElement } from './scholar-react'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export interface ScholarGraphPropertyRow {
  key: string
  label: string
  value: string
}

function connectionLabel(connection: ConnectionInfo, direction: 'incoming' | 'outgoing'): string {
  const arrow = direction === 'incoming' ? '←' : '→'
  return `${arrow} ${connection.nodeLabel} (${connection.relationshipType})`
}

export function buildScholarGraphPropertyRows(selection: unknown): ScholarGraphPropertyRow[] {
  if (!ScholarGraphSelection.is(selection)) {
    return []
  }

  const { payload } = selection
  if (payload.kind === 'node') {
    const connections = [
      ...payload.incomingConnections.map(connection => connectionLabel(connection, 'incoming')),
      ...payload.outgoingConnections.map(connection => connectionLabel(connection, 'outgoing')),
    ]
    const description = payload.definition
      ?? payload.statement
      ?? payload.summary
      ?? payload.context
      ?? '—'
    const evidence = payload.evidence?.map(item => {
      const location = item.source.section_title ?? item.source.section_id ?? 'Source'
      return `${location}: ${item.source.quote}`
    }).join('\n') || '—'
    return [
      { key: 'paper', label: 'Paper', value: selection.paperId },
      { key: 'label', label: 'Label', value: payload.label },
      { key: 'type', label: 'Type', value: payload.nodeType },
      { key: 'description', label: 'Definition / Description', value: description },
      { key: 'aliases', label: 'Aliases', value: payload.aliases?.join(', ') || '—' },
      { key: 'rank', label: 'View Rank', value: payload.rank === undefined ? '—' : payload.rank.toFixed(3) },
      {
        key: 'omitted',
        label: 'Omitted Relations',
        value: payload.omittedRelationCount === undefined ? '—' : String(payload.omittedRelationCount),
      },
      {
        key: 'facets',
        label: 'Facets',
        value: payload.facets?.map(item => item.kind).join(', ') || '—',
      },
      { key: 'evidence', label: 'Evidence', value: evidence },
      { key: 'connections', label: 'Connections', value: connections.join('\n') || '—' },
    ]
  }

  if (payload.kind === 'edge') return [
    { key: 'paper', label: 'Paper', value: selection.paperId },
    {
      key: 'relation',
      label: 'Relation',
      value: `${payload.sourceLabel} → ${payload.targetLabel} (${payload.relationshipType})`,
    },
    {
      key: 'qualifiers',
      label: 'Qualifiers',
      value: payload.qualifiers?.join(', ') || '—',
    },
    {
      key: 'evidence',
      label: 'Evidence',
      value: payload.evidenceItems?.map(item => item.source.quote).join('\n') || payload.evidence || '—',
    },
  ]
  if (payload.kind === 'occurrence') return [
    { key: 'paper', label: 'Paper', value: selection.paperId },
    { key: 'label', label: 'Label', value: payload.label },
    { key: 'type', label: 'Type', value: payload.subjectKind ?? 'semantic occurrence' },
    { key: 'scope', label: 'Scope', value: payload.scopeId },
    { key: 'source', label: 'Source', value: payload.domNodeId ?? payload.equationId ?? '—' },
  ]
  if (payload.kind === 'equation') return [
    { key: 'paper', label: 'Paper', value: selection.paperId },
    { key: 'type', label: 'Type', value: 'Equation' },
    { key: 'equation', label: 'Equation ID', value: payload.equationId },
  ]
  const evidence = payload.evidence
  return [
    { key: 'paper', label: 'Paper', value: selection.paperId },
    { key: 'type', label: 'Type', value: 'Evidence' },
    { key: 'label', label: 'Label', value: evidence.label },
    { key: 'source', label: 'Source', value: evidence.source.dom_node_id ?? evidence.source.equation_id ?? '—' },
    { key: 'quote', label: 'Quote', value: evidence.source.quote },
  ]
}

@injectable()
export class ScholarGraphPropertyDataService implements PropertyDataService {
  readonly id = 'scholar-agent.graph-properties'
  readonly label = 'Semantic Details'

  canHandleSelection(selection: Object | undefined): number {
    return ScholarGraphSelection.is(selection) ? 100 : 0
  }

  async providePropertyData(selection: Object | undefined): Promise<ScholarGraphPropertyRow[]> {
    return buildScholarGraphPropertyRows(selection)
  }
}

@injectable()
export class ScholarGraphPropertyViewWidget extends ReactWidget implements PropertyViewContentWidget {
  private rows: ScholarGraphPropertyRow[] = []
  private updateVersion = 0
  private selection: ScholarGraphSelection | undefined
  private subjectDetails: SemanticSubjectDetails | null = null
  private equationDetails: EquationDetails | null = null
  private detailsLoading = false
  private detailsError: string | null = null

  constructor(
    @inject(ScholarWorkspaceService) @optional()
    private readonly store?: ScholarWorkspaceService,
  ) {
    super()
    this.id = 'scholar-agent:graph-properties'
    this.addClass('scholar-graph-properties')
  }

  updatePropertyViewContent(
    propertyDataService?: PropertyDataService,
    selection?: Object,
  ): void {
    const updateVersion = ++this.updateVersion
    if (!propertyDataService) {
      this.selection = undefined
      this.resetDetails()
      this.setRows([])
      return
    }
    this.selection = ScholarGraphSelection.is(selection) ? selection : undefined
    this.resetDetails()
    this.loadSemanticDetails(updateVersion)
    void propertyDataService.providePropertyData(selection).then(propertyData => {
      if (updateVersion === this.updateVersion) {
        this.setRows(Array.isArray(propertyData) ? propertyData as ScholarGraphPropertyRow[] : [])
      }
    }).catch(() => {
      if (updateVersion === this.updateVersion) {
        this.setRows([])
      }
    })
  }

  protected override render(): React.ReactNode {
    const selection = this.selection
    if (selection && this.supportsRichDetails(selection) && this.store) {
      return (
        <SemanticDetails
          selection={selection.payload}
          subjectDetails={this.subjectDetails}
          equationDetails={this.equationDetails}
          loading={this.detailsLoading}
          error={this.detailsError}
          onNavigate={dataId => navigateToPaperElement(selection.paperId, dataId)}
        />
      )
    }
    if (this.rows.length === 0) {
      return <div className="scholar-graph-properties-empty">No semantic item selected.</div>
    }
    return (
      <table className="scholar-graph-properties-table">
        <tbody>
          {this.rows.map(row => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  private setRows(rows: ScholarGraphPropertyRow[]): void {
    this.rows = rows
    this.update()
  }

  private supportsRichDetails(selection: ScholarGraphSelection): boolean {
    return selection.payload.kind === 'node'
      || selection.payload.kind === 'occurrence'
      || selection.payload.kind === 'equation'
  }

  private resetDetails(): void {
    this.subjectDetails = null
    this.equationDetails = null
    this.detailsLoading = false
    this.detailsError = null
  }

  private loadSemanticDetails(updateVersion: number): void {
    const selection = this.selection
    if (!selection || !this.store || !this.supportsRichDetails(selection)) {
      return
    }

    this.detailsLoading = true
    this.update()
    const payload = selection.payload
    const request = payload.kind === 'equation'
      ? this.store.loadEquationDetails(selection.paperId, payload.equationId)
      : payload.kind === 'node'
        ? this.store.loadSemanticSubject(selection.paperId, payload.id)
        : payload.kind === 'occurrence'
          ? this.store.loadSemanticSubject(selection.paperId, payload.subjectId)
          : undefined
    if (!request) return

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
}

@injectable()
export class ScholarGraphPropertyViewWidgetProvider implements PropertyViewWidgetProvider {
  readonly id = 'scholar-agent.graph-properties'

  constructor(
    @inject(ScholarGraphPropertyDataService)
    private readonly dataService: ScholarGraphPropertyDataService,
    @inject(ScholarGraphPropertyViewWidget)
    private readonly contentWidget: ScholarGraphPropertyViewWidget,
  ) {}

  canHandle(selection: Object | undefined): number {
    return this.dataService.canHandleSelection(selection)
  }

  async provideWidget(): Promise<PropertyViewContentWidget> {
    return this.contentWidget
  }

  updateContentWidget(selection: Object | undefined): void {
    this.contentWidget.updatePropertyViewContent(this.dataService, selection)
  }
}

export function bindScholarGraphPropertyView(bind: interfaces.Bind): void {
  bind(ScholarGraphPropertyDataService).toSelf().inSingletonScope()
  bind(PropertyDataService).toService(ScholarGraphPropertyDataService)
  bind(ScholarGraphPropertyViewWidget).toSelf().inSingletonScope()
  bind(ScholarGraphPropertyViewWidgetProvider).toSelf().inSingletonScope()
  bind(PropertyViewWidgetProvider).toService(ScholarGraphPropertyViewWidgetProvider)
}