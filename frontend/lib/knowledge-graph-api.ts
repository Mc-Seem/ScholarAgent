import { API_BASE, apiUrl } from '../hooks/useApi'

export type KnowledgeGraphEntityType = 'concept' | 'claim' | 'method' | 'formula' | 'symbol'
export type KnowledgeGraphExpertise = 'novice' | 'intermediate' | 'expert'

export interface KnowledgeGraphSource {
  paper_id: string
  section_id: string | null
  section_title: string | null
  dom_node_id: string | null
  equation_id: string | null
  quote: string
  char_start: number | null
  char_end: number | null
}

export interface KnowledgeGraphEvidence {
  observation_id: string
  kind: string
  label: string
  source: KnowledgeGraphSource
}

export interface KnowledgeGraphFacet {
  kind: string
  payload: Record<string, unknown>
  evidence_ids: string[]
}

export interface KnowledgeGraphSignals {
  contribution: number
  prominence: number
  recurrence: number
  confidence: number
  familiarity: number
}

export interface KnowledgeGraphNode {
  stable_id: string
  type: KnowledgeGraphEntityType
  label: string
  aliases: string[]
  facets: KnowledgeGraphFacet[]
  signals: KnowledgeGraphSignals
  rank: number
  evidence: KnowledgeGraphEvidence[]
}

export interface KnowledgeGraphRelation {
  stable_id: string
  type: string
  source_id: string
  target_id: string
  confidence: number
  evidence: KnowledgeGraphEvidence[]
}

export interface KnowledgeGraphProjection {
  status: 'ready'
  schema_version: string
  nodes: KnowledgeGraphNode[]
  relations: KnowledgeGraphRelation[]
  total_entity_count: number
  total_relation_count: number
  truncated: boolean
}

export interface KnowledgeGraphRebuildRequired {
  status: 'rebuild_required'
  reason: string
}

export interface KnowledgeGraphSearchResult extends Omit<KnowledgeGraphNode, 'rank'> {
  score: number
}

export interface KnowledgeGraphSearchResponse {
  status: 'ready'
  schema_version: string
  results: KnowledgeGraphSearchResult[]
}

export type ProjectionResponse = KnowledgeGraphProjection | KnowledgeGraphRebuildRequired
export type SearchResponse = KnowledgeGraphSearchResponse | KnowledgeGraphRebuildRequired

export interface OverviewOptions {
  types?: KnowledgeGraphEntityType[]
  section?: string
  minImportance?: number
  expertise?: KnowledgeGraphExpertise
  showFamiliar?: boolean
  limit?: number
}

export interface SubgraphOptions {
  seedIds?: string[]
  section?: string
  domNodeId?: string
  equationId?: string
  types?: KnowledgeGraphEntityType[]
  expertise?: KnowledgeGraphExpertise
  nodeBudget?: number
  edgeBudget?: number
}

export interface SearchOptions {
  types?: KnowledgeGraphEntityType[]
  limit?: number
}

export interface KnowledgeGraphApi {
  overview(paperId: string, options?: OverviewOptions): Promise<ProjectionResponse>
  subgraph(paperId: string, options: SubgraphOptions): Promise<ProjectionResponse>
  search(paperId: string, query: string, options?: SearchOptions): Promise<SearchResponse>
}

export class KnowledgeGraphApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSource(value: unknown): value is KnowledgeGraphSource {
  return isRecord(value)
    && isString(value.paper_id)
    && isString(value.quote)
    && ['section_id', 'section_title', 'dom_node_id', 'equation_id'].every(
      key => value[key] === null || isString(value[key]),
    )
}

function isEvidence(value: unknown): value is KnowledgeGraphEvidence {
  return isRecord(value)
    && isString(value.observation_id)
    && isString(value.kind)
    && isString(value.label)
    && isSource(value.source)
}

function isFacet(value: unknown): value is KnowledgeGraphFacet {
  return isRecord(value)
    && isString(value.kind)
    && isRecord(value.payload)
    && Array.isArray(value.evidence_ids)
    && value.evidence_ids.every(isString)
}

function isSignals(value: unknown): value is KnowledgeGraphSignals {
  return isRecord(value)
    && ['contribution', 'prominence', 'recurrence', 'confidence', 'familiarity'].every(
      key => isNumber(value[key]),
    )
}

function isNode(value: unknown): value is KnowledgeGraphNode {
  return isRecord(value)
    && isString(value.stable_id)
    && isString(value.type)
    && isString(value.label)
    && Array.isArray(value.aliases)
    && value.aliases.every(isString)
    && Array.isArray(value.facets)
    && value.facets.every(isFacet)
    && isSignals(value.signals)
    && isNumber(value.rank)
    && Array.isArray(value.evidence)
    && value.evidence.every(isEvidence)
}

function isRelation(value: unknown): value is KnowledgeGraphRelation {
  return isRecord(value)
    && isString(value.stable_id)
    && isString(value.type)
    && isString(value.source_id)
    && isString(value.target_id)
    && isNumber(value.confidence)
    && Array.isArray(value.evidence)
    && value.evidence.every(isEvidence)
}

function malformedResponse(): never {
  throw new Error('Malformed knowledge graph response from server')
}

function parseProjection(value: unknown): ProjectionResponse {
  if (isRecord(value) && value.status === 'rebuild_required' && isString(value.reason)) {
    return value as unknown as KnowledgeGraphRebuildRequired
  }
  if (!isRecord(value)
    || value.status !== 'ready'
    || !isString(value.schema_version)
    || !Array.isArray(value.nodes)
    || !value.nodes.every(isNode)
    || !Array.isArray(value.relations)
    || !value.relations.every(isRelation)
    || !isNumber(value.total_entity_count)
    || !isNumber(value.total_relation_count)
    || typeof value.truncated !== 'boolean') {
    return malformedResponse()
  }
  return value as unknown as KnowledgeGraphProjection
}

function parseSearch(value: unknown): SearchResponse {
  if (isRecord(value) && value.status === 'rebuild_required' && isString(value.reason)) {
    return value as unknown as KnowledgeGraphRebuildRequired
  }
  if (!isRecord(value)
    || value.status !== 'ready'
    || !isString(value.schema_version)
    || !Array.isArray(value.results)
    || !value.results.every(result => {
      if (!isRecord(result)) return false
      return isNode({ ...result, rank: result.score }) && isNumber(result.score)
    })) {
    return malformedResponse()
  }
  return value as unknown as KnowledgeGraphSearchResponse
}

function appendList(params: URLSearchParams, name: string, values?: string[]) {
  values?.forEach(value => params.append(name, value))
}

function appendValue(params: URLSearchParams, name: string, value: unknown) {
  if (value !== undefined && value !== null && value !== '') {
    params.set(name, String(value))
  }
}

export class HttpKnowledgeGraphApi implements KnowledgeGraphApi {
  constructor(private readonly apiBase = API_BASE) {}

  overview(paperId: string, options: OverviewOptions = {}): Promise<ProjectionResponse> {
    const params = new URLSearchParams()
    appendList(params, 'types', options.types)
    appendValue(params, 'section', options.section)
    appendValue(params, 'min_importance', options.minImportance)
    appendValue(params, 'expertise', options.expertise)
    appendValue(params, 'show_familiar', options.showFamiliar)
    appendValue(params, 'limit', options.limit)
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/knowledge-graph/overview`, params, parseProjection)
  }

  subgraph(paperId: string, options: SubgraphOptions): Promise<ProjectionResponse> {
    const params = new URLSearchParams()
    appendList(params, 'seed_ids', options.seedIds)
    appendList(params, 'types', options.types)
    appendValue(params, 'section', options.section)
    appendValue(params, 'dom_node_id', options.domNodeId)
    appendValue(params, 'equation_id', options.equationId)
    appendValue(params, 'expertise', options.expertise)
    appendValue(params, 'node_budget', options.nodeBudget)
    appendValue(params, 'edge_budget', options.edgeBudget)
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/knowledge-graph/subgraph`, params, parseProjection)
  }

  search(paperId: string, query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const params = new URLSearchParams({ query })
    appendList(params, 'types', options.types)
    appendValue(params, 'limit', options.limit)
    return this.request(`/api/papers/${encodeURIComponent(paperId)}/knowledge-graph/search`, params, parseSearch)
  }

  private async request<T>(
    endpoint: string,
    params: URLSearchParams,
    parser: (value: unknown) => T,
  ): Promise<T> {
    const suffix = params.size ? `?${params.toString()}` : ''
    const response = await fetch(apiUrl(`${endpoint}${suffix}`, this.apiBase))
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { detail?: unknown }
      const detail = typeof body.detail === 'string' ? body.detail : response.statusText
      throw new KnowledgeGraphApiError(detail || 'Knowledge graph request failed', response.status)
    }
    try {
      return parser(await response.json())
    } catch (error) {
      if (error instanceof KnowledgeGraphApiError) throw error
      return malformedResponse()
    }
  }
}