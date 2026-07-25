import * as React from 'react'
import { ReactWidget } from '@theia/core/lib/browser'
import { PropertyDataService } from '@theia/property-view/lib/browser/property-data-service'
import { PropertyViewContentWidget } from '@theia/property-view/lib/browser/property-view-content-widget'
import { PropertyViewWidgetProvider } from '@theia/property-view/lib/browser/property-view-widget-provider'
import { inject, injectable, interfaces } from '@theia/core/shared/inversify'

import type { ConnectionInfo } from '../../../../components/reader/NodeInfoPanel'
import { ScholarGraphSelection } from './scholar-graph-selection'

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
      { key: 'evidence', label: 'Evidence', value: evidence },
      { key: 'connections', label: 'Connections', value: connections.join('\n') || '—' },
    ]
  }

  return [
    { key: 'paper', label: 'Paper', value: selection.paperId },
    {
      key: 'relation',
      label: 'Relation',
      value: `${payload.sourceLabel} → ${payload.targetLabel} (${payload.relationshipType})`,
    },
    {
      key: 'evidence',
      label: 'Evidence',
      value: payload.evidenceItems?.map(item => item.source.quote).join('\n') || payload.evidence || '—',
    },
  ]
}

@injectable()
export class ScholarGraphPropertyDataService implements PropertyDataService {
  readonly id = 'scholar-agent.graph-properties'
  readonly label = 'Knowledge Graph'

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

  constructor() {
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
      this.setRows([])
      return
    }
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
    if (this.rows.length === 0) {
      return <div className="scholar-graph-properties-empty">No graph item selected.</div>
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