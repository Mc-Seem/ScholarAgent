import type {
  SemanticEquationSelection,
  SemanticEvidenceSelection,
  SemanticNodeSelection,
  SemanticOccurrenceSelection,
  SemanticRelationSelection,
  SemanticSelection,
} from '../../../../lib/semantic-api'

export const SCHOLAR_GRAPH_SELECTION_KIND = 'scholar-agent:graph-selection'

export interface ScholarGraphSelectionSource {
  kind: typeof SCHOLAR_GRAPH_SELECTION_KIND
  paperId: string
  owner: object
}

export interface ScholarGraphSelection {
  type: typeof SCHOLAR_GRAPH_SELECTION_KIND
  paperId: string
  source: ScholarGraphSelectionSource
  payload: SemanticSelection
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isConnection(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }
  return typeof value.nodeId === 'string'
    && typeof value.nodeLabel === 'string'
    && typeof value.nodeType === 'string'
    && typeof value.relationshipType === 'string'
}

function isNodePayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SemanticNodeSelection {
  return value.kind === 'node'
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && typeof value.nodeType === 'string'
    && isOptionalString(value.context)
    && isOptionalString(value.definition)
    && isOptionalString(value.statement)
    && isOptionalString(value.summary)
    && isOptionalString(value.latex)
    && isOptionalString(value.domNodeId)
    && Array.isArray(value.incomingConnections)
    && value.incomingConnections.every(isConnection)
    && Array.isArray(value.outgoingConnections)
    && value.outgoingConnections.every(isConnection)
}

function isEdgePayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SemanticRelationSelection {
  return value.kind === 'edge'
    && typeof value.sourceId === 'string'
    && typeof value.targetId === 'string'
    && typeof value.sourceLabel === 'string'
    && typeof value.targetLabel === 'string'
    && typeof value.relationshipType === 'string'
    && isOptionalString(value.evidence)
}

function isOccurrencePayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SemanticOccurrenceSelection {
  return value.kind === 'occurrence'
    && typeof value.occurrenceId === 'string'
    && typeof value.subjectId === 'string'
    && typeof value.label === 'string'
    && typeof value.scopeId === 'string'
    && isOptionalString(value.domNodeId)
    && isOptionalString(value.equationId)
}

function isEquationPayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SemanticEquationSelection {
  return value.kind === 'equation' && typeof value.equationId === 'string'
}

function isEvidencePayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & SemanticEvidenceSelection {
  return value.kind === 'evidence'
    && isRecord(value.evidence)
    && isRecord(value.evidence.source)
    && typeof value.evidence.source.quote === 'string'
}

function isSelectionSource(value: unknown): value is ScholarGraphSelectionSource {
  if (!isRecord(value)) {
    return false
  }
  return value.kind === SCHOLAR_GRAPH_SELECTION_KIND
    && typeof value.paperId === 'string'
    && value.paperId.length > 0
    && Boolean(value.owner)
    && (typeof value.owner === 'object' || typeof value.owner === 'function')
}

export namespace ScholarGraphSelection {
  export function is(value: unknown): value is ScholarGraphSelection {
    if (!isRecord(value) || !isSelectionSource(value.source) || !isRecord(value.payload)) {
      return false
    }
    return value.type === SCHOLAR_GRAPH_SELECTION_KIND
      && typeof value.paperId === 'string'
      && value.paperId.length > 0
      && value.source.paperId === value.paperId
      && (
        isNodePayload(value.payload)
        || isEdgePayload(value.payload)
        || isOccurrencePayload(value.payload)
        || isEquationPayload(value.payload)
        || isEvidencePayload(value.payload)
      )
  }

  export function create(
    paperId: string,
    source: ScholarGraphSelectionSource,
    payload: SemanticSelection,
  ): ScholarGraphSelection {
    if (!paperId || !isSelectionSource(source) || source.paperId !== paperId) {
      throw new Error('A graph selection requires a matching paper and source')
    }
    return {
      type: SCHOLAR_GRAPH_SELECTION_KIND,
      paperId,
      source,
      payload,
    }
  }

  export function isSource(
    selection: unknown,
    source: ScholarGraphSelectionSource,
  ): selection is ScholarGraphSelection {
    return is(selection)
      && isSelectionSource(source)
      && selection.source.owner === source.owner
      && selection.source.paperId === source.paperId
  }
}