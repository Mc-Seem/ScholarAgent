import type { Paper, PaperDetail } from '../hooks/usePapers'
import type { Tooltip } from '../hooks/useTooltips'
import { API_BASE, apiUrl } from '../hooks/useApi'
import type {
  CompilationProgress,
  KnowledgeGraphProgress,
  ReaderWorkspaceApi,
  TooltipUpdate,
} from './reader-workspace-store'
import { HttpSemanticApi } from './semantic-api'
import type { EquationDetails, SectionAnnotationsResponse, SemanticSubjectDetails } from './semantic-api'

interface PaperListResponse {
  papers: Paper[]
}

interface TooltipListResponse {
  tooltips: Tooltip[]
}

interface ApiErrorBody {
  detail?: string
}

export interface TooltipSuggestionOccurrence {
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

export interface GeneratedTooltipSuggestion {
  entity_id: string
  entity_label: string
  entity_type: string
  tooltip_content: string
  occurrences: TooltipSuggestionOccurrence[]
}

export interface TooltipSuggestion {
  id: string
  paper_id: string
  entity_id: string | null
  entity_label: string
  entity_type: string
  tooltip_content: string
  is_ai_generated: boolean
  created_at: string
}

export interface GenerateTooltipSuggestionsRequest {
  user_expertise: string
  entity_types?: string[] | null
}

export interface GenerateTooltipSuggestionsResponse {
  suggestions: GeneratedTooltipSuggestion[]
  total_entities: number
  suggested_count: number
}

export interface CreateManualTooltipSuggestionRequest {
  entity_label: string
  entity_type: string
  tooltip_content: string
}

export interface DeleteTooltipSuggestionResponse {
  status: 'success'
}

/**
 * A draft being applied. Occurrences are deliberately absent: the drafts panel
 * lists rows of `tooltip_suggestions`, which stores only label and text, so the
 * client has no anchor positions to send. The apply endpoint reads them from the
 * paper's semantic document instead.
 */
export type AppliedTooltipSuggestion = Omit<GeneratedTooltipSuggestion, 'occurrences'>

export interface ApplyTooltipSuggestionsRequest {
  suggestions: AppliedTooltipSuggestion[]
}

export interface ApplyTooltipSuggestionsResponse {
  success: boolean
  spans_injected: number
  tooltips_created: number
  errors: string[]
}

export interface ApplyTooltipProgress {
  type?: string
  stage: 'starting' | 'applying' | 'complete' | 'error'
  current: number
  total: number
  error?: string
}

export interface TooltipSuggestionApi {
  listTooltipSuggestions(paperId: string): Promise<TooltipSuggestion[]>
  generateTooltipSuggestions(
    paperId: string,
    request: GenerateTooltipSuggestionsRequest,
  ): Promise<GenerateTooltipSuggestionsResponse>
  createManualTooltipSuggestion(
    paperId: string,
    request: CreateManualTooltipSuggestionRequest,
  ): Promise<TooltipSuggestion>
  deleteTooltipSuggestion(
    paperId: string,
    suggestionId: string,
  ): Promise<DeleteTooltipSuggestionResponse>
  applyTooltipSuggestions(
    paperId: string,
    request: ApplyTooltipSuggestionsRequest,
  ): Promise<ApplyTooltipSuggestionsResponse>
  watchApplyProgress?(
    paperId: string,
    onProgress: (progress: ApplyTooltipProgress) => void,
    onConnectionError: () => void,
  ): () => void
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

function isNullableString(value: unknown): value is string | null {
  return value === null || value === undefined || isString(value)
}

/**
 * Occurrences follow the schema-v3 anchor shape: a stable id, the subject they
 * belong to, either a DOM node or an equation, and character offsets into the
 * node text. The pre-rework shape (`section_id`, `char_offset`, `snippet`) is
 * gone, and validating against it rejected every generated suggestion.
 */
function isTooltipSuggestionOccurrence(value: unknown): value is TooltipSuggestionOccurrence {
  return isRecord(value)
    && isString(value.stable_id)
    && isString(value.subject_id)
    && isNullableString(value.dom_node_id)
    && isNullableString(value.equation_id)
    && isNumber(value.start)
    && isNumber(value.end)
    && isString(value.text)
    && isString(value.scope_id)
    && isNullableString(value.local_override_id)
}

function isGeneratedTooltipSuggestion(value: unknown): value is GeneratedTooltipSuggestion {
  return isRecord(value)
    && isString(value.entity_id)
    && isString(value.entity_label)
    && isString(value.entity_type)
    && isString(value.tooltip_content)
    && Array.isArray(value.occurrences)
    && value.occurrences.every(isTooltipSuggestionOccurrence)
}

function isTooltipSuggestion(value: unknown): value is TooltipSuggestion {
  return isRecord(value)
    && isString(value.id)
    && isString(value.paper_id)
    && (value.entity_id === null || isString(value.entity_id))
    && isString(value.entity_label)
    && isString(value.entity_type)
    && isString(value.tooltip_content)
    && typeof value.is_ai_generated === 'boolean'
    && isString(value.created_at)
}

function malformedResponse(): never {
  throw new Error('Malformed response from server')
}

function parseTooltipSuggestions(value: unknown): TooltipSuggestion[] {
  if (!Array.isArray(value) || !value.every(isTooltipSuggestion)) {
    return malformedResponse()
  }
  return value
}

function parseGeneratedTooltipSuggestions(value: unknown): GenerateTooltipSuggestionsResponse {
  if (!isRecord(value)
    || !Array.isArray(value.suggestions)
    || !value.suggestions.every(isGeneratedTooltipSuggestion)
    || !isNumber(value.total_entities)
    || !isNumber(value.suggested_count)) {
    return malformedResponse()
  }
  return value as unknown as GenerateTooltipSuggestionsResponse
}

function parseTooltipSuggestion(value: unknown): TooltipSuggestion {
  return isTooltipSuggestion(value) ? value : malformedResponse()
}

function parseDeleteTooltipSuggestionResponse(value: unknown): DeleteTooltipSuggestionResponse {
  if (!isRecord(value) || value.status !== 'success') {
    return malformedResponse()
  }
  return { status: 'success' }
}

function parseApplyTooltipSuggestionsResponse(value: unknown): ApplyTooltipSuggestionsResponse {
  if (!isRecord(value)
    || typeof value.success !== 'boolean'
    || !isNumber(value.spans_injected)
    || !isNumber(value.tooltips_created)
    || !Array.isArray(value.errors)
    || !value.errors.every(isString)) {
    return malformedResponse()
  }
  return value as unknown as ApplyTooltipSuggestionsResponse
}

export class HttpReaderWorkspaceApi implements ReaderWorkspaceApi, TooltipSuggestionApi {
  private readonly semanticApi: HttpSemanticApi

  constructor(private readonly apiBase = API_BASE) {
    this.semanticApi = new HttpSemanticApi(apiBase)
  }

  async listPapers(): Promise<Paper[]> {
    const data = await this.request<Paper[] | PaperListResponse>('/api/papers')
    return Array.isArray(data) ? data : data.papers ?? []
  }

  getPaper(paperId: string): Promise<PaperDetail> {
    return this.request(`/api/papers/${paperId}`)
  }

  async listTooltips(paperId: string): Promise<Tooltip[]> {
    const data = await this.request<Tooltip[] | TooltipListResponse>(
      `/api/papers/${paperId}/tooltips`,
    )
    return Array.isArray(data) ? data : data.tooltips ?? []
  }

  uploadPaper(file: File): Promise<Paper> {
    const body = new FormData()
    body.append('file', file)
    body.append('compile_now', 'true')
    return this.request('/api/papers/upload', { method: 'POST', body })
  }

  uploadArxiv(urlOrId: string): Promise<Paper> {
    const body = new FormData()
    body.append('url_or_id', urlOrId)
    body.append('compile_now', 'true')
    return this.request('/api/papers/upload/arxiv', { method: 'POST', body })
  }

  compilePaper(paperId: string): Promise<Paper> {
    return this.request(`/api/papers/${paperId}/compile`, { method: 'POST' })
  }

  async deletePaper(paperId: string): Promise<void> {
    await this.request(`/api/papers/${paperId}`, { method: 'DELETE' }, false)
  }

  buildKnowledgeGraph(paperId: string): Promise<unknown> {
    return this.request(`/api/papers/${paperId}/knowledge-graph/build`, { method: 'POST' })
  }

  cancelKnowledgeGraph(paperId: string): Promise<unknown> {
    return this.request(`/api/papers/${paperId}/knowledge-graph/cancel`, { method: 'POST' })
  }

  createTooltip(
    paperId: string,
    domNodeId: string,
    content: string,
    targetText?: string,
  ): Promise<Tooltip> {
    return this.request(`/api/papers/${paperId}/tooltips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dom_node_id: domNodeId,
        content,
        target_text: targetText || null,
      }),
    })
  }

  updateTooltip(paperId: string, tooltipId: string, update: TooltipUpdate): Promise<Tooltip> {
    return this.request(`/api/papers/${paperId}/tooltips/${tooltipId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: update.content,
        target_text: update.targetText,
        is_pinned: update.isPinned,
        display_order: update.displayOrder,
      }),
    })
  }

  async deleteTooltip(paperId: string, tooltipId: string): Promise<void> {
    await this.request(
      `/api/papers/${paperId}/tooltips/${tooltipId}`,
      { method: 'DELETE' },
      false,
    )
  }

  async removeTooltipOccurrence(
    paperId: string,
    tooltipId: string,
    domNodeId: string,
  ): Promise<void> {
    await this.request(
      `/api/papers/${paperId}/tooltips/${tooltipId}/occurrences/${domNodeId}`,
      { method: 'DELETE' },
      false,
    )
  }

  saveSemanticNote(
    paperId: string,
    subjectId: string,
    content: string,
    targetText?: string | null,
  ): Promise<Tooltip> {
    return this.request(
      `/api/papers/${encodeURIComponent(paperId)}/semantic-notes/${encodeURIComponent(subjectId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, target_text: targetText ?? null }),
      },
    )
  }

  async deleteSemanticNote(paperId: string, subjectId: string): Promise<void> {
    await this.request(
      `/api/papers/${encodeURIComponent(paperId)}/semantic-notes/${encodeURIComponent(subjectId)}`,
      { method: 'DELETE' },
      false,
    )
  }

  getSectionAnnotations(paperId: string, sectionId: string): Promise<SectionAnnotationsResponse> {
    return this.semanticApi.sectionAnnotations(paperId, sectionId)
  }

  getSemanticSubject(paperId: string, subjectId: string): Promise<SemanticSubjectDetails> {
    return this.semanticApi.subjectDetails(paperId, subjectId)
  }

  getEquationDetails(paperId: string, equationId: string): Promise<EquationDetails> {
    return this.semanticApi.equationDetails(paperId, equationId)
  }

  async listTooltipSuggestions(paperId: string): Promise<TooltipSuggestion[]> {
    const data = await this.request<unknown>(
      `/api/papers/${encodeURIComponent(paperId)}/suggestions`,
    )
    return parseTooltipSuggestions(data)
  }

  async generateTooltipSuggestions(
    paperId: string,
    request: GenerateTooltipSuggestionsRequest,
  ): Promise<GenerateTooltipSuggestionsResponse> {
    const data = await this.request<unknown>(
      `/api/papers/${encodeURIComponent(paperId)}/tooltips/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
    return parseGeneratedTooltipSuggestions(data)
  }

  async createManualTooltipSuggestion(
    paperId: string,
    request: CreateManualTooltipSuggestionRequest,
  ): Promise<TooltipSuggestion> {
    const data = await this.request<unknown>(
      `/api/papers/${encodeURIComponent(paperId)}/suggestions/manual`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
    return parseTooltipSuggestion(data)
  }

  async deleteTooltipSuggestion(
    paperId: string,
    suggestionId: string,
  ): Promise<DeleteTooltipSuggestionResponse> {
    const data = await this.request<unknown>(
      `/api/papers/${encodeURIComponent(paperId)}/suggestions/${encodeURIComponent(suggestionId)}`,
      { method: 'DELETE' },
    )
    return parseDeleteTooltipSuggestionResponse(data)
  }

  async applyTooltipSuggestions(
    paperId: string,
    request: ApplyTooltipSuggestionsRequest,
  ): Promise<ApplyTooltipSuggestionsResponse> {
    const data = await this.request<unknown>(
      `/api/papers/${encodeURIComponent(paperId)}/tooltips/apply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
    return parseApplyTooltipSuggestionsResponse(data)
  }

  watchApplyProgress(
    paperId: string,
    onProgress: (progress: ApplyTooltipProgress) => void,
    onConnectionError: () => void,
  ): () => void {
    const source = new EventSource(
      this.url(`/api/papers/${encodeURIComponent(paperId)}/tooltips/apply/progress`),
    )

    source.onmessage = event => {
      try {
        onProgress(JSON.parse(event.data) as ApplyTooltipProgress)
      } catch {
        // SSE heartbeat comments and malformed progress events are non-fatal.
      }
    }
    source.onerror = () => onConnectionError()

    return () => source.close()
  }

  watchCompilation(
    paperId: string,
    onProgress: (progress: CompilationProgress) => void,
    onConnectionError: () => void,
  ): () => void {
    const source = new EventSource(this.url(`/api/papers/${paperId}/compile/progress`))

    source.onmessage = event => {
      try {
        onProgress(JSON.parse(event.data) as CompilationProgress)
      } catch {
        // SSE heartbeat comments and malformed progress events are non-fatal.
      }
    }
    source.onerror = () => onConnectionError()

    return () => source.close()
  }

  watchKnowledgeGraph(
    paperId: string,
    onProgress: (progress: KnowledgeGraphProgress) => void,
    onConnectionError: () => void,
  ): () => void {
    const source = new EventSource(
      this.url(`/api/papers/${paperId}/knowledge-graph/build/progress`),
    )

    source.onmessage = event => {
      try {
        onProgress(JSON.parse(event.data) as KnowledgeGraphProgress)
      } catch {
        // SSE heartbeat comments and malformed progress events are non-fatal.
      }
    }
    source.onerror = () => onConnectionError()

    return () => source.close()
  }

  private async request<T>(endpoint: string, options?: RequestInit, parseJson = true): Promise<T> {
    const response = await fetch(this.url(endpoint), options)
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as ApiErrorBody
      throw new Error(body.detail || response.statusText || 'Request failed')
    }
    if (!parseJson || response.status === 204) {
      return undefined as T
    }
    try {
      return await response.json() as T
    } catch {
      return malformedResponse()
    }
  }

  private url(endpoint: string): string {
    return apiUrl(endpoint, this.apiBase)
  }
}