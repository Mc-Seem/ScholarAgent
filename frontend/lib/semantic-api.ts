import { API_BASE, apiUrl } from '../hooks/useApi'
import type {
  KnowledgeGraphEvidence,
  KnowledgeGraphFacet,
  KnowledgeGraphSource,
  KnowledgeGraphSignals,
} from './knowledge-graph-api'

export type SemanticKind = 'topic' | 'claim' | 'procedure' | 'artifact' | 'quantity'

export interface SemanticOccurrence {
  stable_id: string
  subject_id: string
  dom_node_id: string | null
  equation_id: string | null
  start: number
  end: number
  text: string
  scope_id: string
  local_override_id: string | null
}

export interface SemanticExplanation {
  stable_id: string
  subject_id: string
  base_content: string
  expertise: 'novice' | 'intermediate' | 'expert'
  evidence_ids: string[]
}

export interface SemanticSubject {
  stable_id: string
  kind: SemanticKind | 'notation'
  label: string
  aliases: string[]
  roles: string[]
  facets: KnowledgeGraphFacet[]
  units: string | null
  constraints: string[]
  object_ids: string[]
}

export interface SemanticAnnotation {
  occurrence: SemanticOccurrence
  subject: SemanticSubject
  explanation: SemanticExplanation | null
}

export interface SectionAnnotationsResponse {
  schema_version: string
  section_id: string
  items: SemanticAnnotation[]
  total: number
  offset: number
  limit: number
}

export interface SemanticSubjectDetails {
  schema_version: string
  subject: SemanticSubject
  explanation: SemanticExplanation | null
  occurrences: SemanticOccurrence[]
  evidence: SemanticEvidence[]
  occurrence_total: number
}

export interface EquationRecord {
  stable_id: string
  equation_id: string
  latex: string
  summary: string
  notation_ids: string[]
  object_ids: string[]
  evidence_ids: string[]
}

export interface NotationRecord {
  stable_id: string
  symbol: string
  meaning: string
  scope_id: string
  units: string | null
  constraints: string[]
  object_ids: string[]
  evidence_ids: string[]
}

export interface EquationDetails {
  schema_version: string
  equation: EquationRecord
  notation: NotationRecord[]
  objects: SemanticSubject[]
  evidence: SemanticEvidence[]
}

export interface SemanticEvidence {
  id: string
  kind: string
  label: string
  payload: Record<string, unknown>
  confidence: number
  source: KnowledgeGraphSource
}

export interface GlossaryResult {
  subject_id: string
  kind: 'object' | 'notation'
  label: string
  aliases: string[]
  explanation: string
  evidence_ids: string[]
}

export interface GlossaryResponse {
  schema_version: string
  results: GlossaryResult[]
  total: number
  offset: number
  limit: number
}

export interface SemanticConnection {
  nodeId: string
  nodeLabel: string
  nodeType: string
  relationshipType: string
}

export interface SemanticNodeSelection {
  kind: 'node'
  id: string
  label: string
  nodeType: string
  context?: string
  definition?: string
  statement?: string
  summary?: string
  latex?: string
  domNodeId?: string
  aliases?: string[]
  facets?: KnowledgeGraphFacet[]
  signals?: KnowledgeGraphSignals
  evidence?: KnowledgeGraphEvidence[]
  rank?: number
  omittedRelationCount?: number
  incomingConnections: SemanticConnection[]
  outgoingConnections: SemanticConnection[]
}

export interface SemanticRelationSelection {
  kind: 'edge'
  relationId?: string
  sourceId: string
  targetId: string
  sourceLabel: string
  targetLabel: string
  relationshipType: string
  qualifiers?: string[]
  evidence?: string
  evidenceItems?: KnowledgeGraphEvidence[]
}

export interface SemanticOccurrenceSelection {
  kind: 'occurrence'
  occurrenceId: string
  subjectId: string
  label: string
  subjectKind?: string
  domNodeId?: string
  equationId?: string
  scopeId: string
}

export interface SemanticEquationSelection {
  kind: 'equation'
  equationId: string
}

export interface SemanticEvidenceSelection {
  kind: 'evidence'
  evidence: KnowledgeGraphEvidence | SemanticEvidence
}

export type SemanticSelection =
  | SemanticNodeSelection
  | SemanticRelationSelection
  | SemanticOccurrenceSelection
  | SemanticEquationSelection
  | SemanticEvidenceSelection

export interface SemanticApi {
  sectionAnnotations(paperId: string, sectionId: string, limit?: number): Promise<SectionAnnotationsResponse>
  subjectDetails(paperId: string, subjectId: string): Promise<SemanticSubjectDetails>
  equationDetails(paperId: string, equationId: string): Promise<EquationDetails>
  glossary(paperId: string, query?: string, limit?: number): Promise<GlossaryResponse>
}

export class HttpSemanticApi implements SemanticApi {
  constructor(private readonly apiBase = API_BASE) {}

  sectionAnnotations(paperId: string, sectionId: string, limit = 100): Promise<SectionAnnotationsResponse> {
    return this.request(`/${paperId}/semantic/sections/${encodeURIComponent(sectionId)}/annotations?limit=${limit}`)
  }

  subjectDetails(paperId: string, subjectId: string): Promise<SemanticSubjectDetails> {
    return this.request(`/${paperId}/semantic/subjects/${encodeURIComponent(subjectId)}`)
  }

  equationDetails(paperId: string, equationId: string): Promise<EquationDetails> {
    return this.request(`/${paperId}/semantic/equations/${encodeURIComponent(equationId)}`)
  }

  glossary(paperId: string, query = '', limit = 25): Promise<GlossaryResponse> {
    const params = new URLSearchParams({ query, limit: String(limit) })
    return this.request(`/${paperId}/semantic/glossary?${params}`)
  }

  private async request<T>(endpoint: string): Promise<T> {
    const response = await fetch(apiUrl(`/api/papers${endpoint}`, this.apiBase))
    if (!response.ok) {
      throw new Error(`Semantic request failed (${response.status})`)
    }
    return response.json() as Promise<T>
  }
}