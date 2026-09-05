import { API_BASE, apiUrl } from '../hooks/useApi'

export interface ReadingSetPaperSummary {
  id: string
  filename: string
  arxiv_id: string | null
  title: string | null
  has_html: boolean
  has_knowledge_graph: boolean
  added_at: string
}

export interface ReadingSet {
  id: string
  name: string
  created_at: string
  updated_at: string
  papers: ReadingSetPaperSummary[]
}

export type AlignmentConfidence = 'high' | 'medium' | 'low'
export type AlignmentStatus = 'auto' | 'confirmed' | 'rejected' | 'stale'

export interface EntityAlignment {
  id: string
  reading_set_id: string
  paper_a_id: string
  subject_a_id: string
  label_a: string
  paper_b_id: string
  subject_b_id: string
  label_b: string
  method: 'deterministic' | 'llm'
  score: number
  confidence: AlignmentConfidence
  status: AlignmentStatus
  rationale: string | null
  created_at: string
}

export interface SkippedAlignmentPaper {
  paper_id: string
  filename: string
  reason: string
}

/** One SSE event from the alignment build progress stream. */
export interface ReadingSetAlignmentProgress {
  stage?: string
  type?: string
  error?: string
  progress?: {
    stage?: string
    label?: string
    current?: number
    total?: number
  }
  alignment_count?: number
  deterministic_count?: number
  llm_count?: number
  stale_count?: number
  skipped_papers?: SkippedAlignmentPaper[]
}

export interface ReadingSetAlignmentFilter {
  paperId?: string
  subjectId?: string
}

/** Outcome of confirming or rejecting every proposed alignment at once. */
export interface BulkAlignmentReviewResult {
  updated_count: number
  alignments: EntityAlignment[]
}

export type ReferenceSuggestionRelevance = 'high' | 'medium' | 'low'

/** One referenced arXiv paper the agent suggests adding to a reading set. */
export interface ReferenceSuggestion {
  arxiv_id: string
  title: string
  abstract: string
  relevance: ReferenceSuggestionRelevance
  reason: string
  cited_by_paper_ids: string[]
  library_paper_id: string | null
  in_reading_set: boolean
}

export interface ReferenceSuggestionsResult {
  reading_set_id: string
  suggestions: ReferenceSuggestion[]
  skipped_papers: SkippedAlignmentPaper[]
}

export interface ReadingSetApi {
  listReadingSets(): Promise<ReadingSet[]>
  createReadingSet(name: string): Promise<ReadingSet>
  renameReadingSet(readingSetId: string, name: string): Promise<ReadingSet>
  deleteReadingSet(readingSetId: string): Promise<void>
  addPaperToReadingSet(readingSetId: string, paperId: string): Promise<ReadingSet>
  removePaperFromReadingSet(readingSetId: string, paperId: string): Promise<ReadingSet>
  buildReadingSetAlignments(readingSetId: string): Promise<void>
  cancelReadingSetAlignments(readingSetId: string): Promise<void>
  listReadingSetAlignments(
    readingSetId: string,
    filter?: ReadingSetAlignmentFilter,
  ): Promise<EntityAlignment[]>
  confirmReadingSetAlignment(readingSetId: string, alignmentId: string): Promise<EntityAlignment>
  rejectReadingSetAlignment(readingSetId: string, alignmentId: string): Promise<EntityAlignment>
  bulkReviewReadingSetAlignments(
    readingSetId: string,
    action: 'confirm' | 'reject',
    filter?: ReadingSetAlignmentFilter,
  ): Promise<BulkAlignmentReviewResult>
  suggestReadingSetReferences(
    readingSetId: string,
    maxCandidates?: number,
  ): Promise<ReferenceSuggestionsResult>
  watchReadingSetAlignments(
    readingSetId: string,
    onProgress: (progress: ReadingSetAlignmentProgress) => void,
    onConnectionError: () => void,
  ): () => void
}

export class ReadingSetApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ReadingSetApiError'
  }
}

type JsonRecord = Record<string, unknown>

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value as JsonRecord
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : string(value, label)
}

function parseReadingSetPaper(value: unknown): ReadingSetPaperSummary {
  const item = record(value, 'reading set paper')
  return {
    id: string(item.id, 'paper id'),
    filename: string(item.filename, 'paper filename'),
    arxiv_id: nullableString(item.arxiv_id, 'paper arxiv_id'),
    title: nullableString(item.title, 'paper title'),
    has_html: item.has_html === true,
    has_knowledge_graph: item.has_knowledge_graph === true,
    added_at: string(item.added_at, 'paper added_at'),
  }
}

export function validateReadingSet(value: unknown): ReadingSet {
  const item = record(value, 'reading set')
  if (!Array.isArray(item.papers)) throw new Error('Invalid reading set papers')
  return {
    id: string(item.id, 'reading set id'),
    name: string(item.name, 'reading set name'),
    created_at: string(item.created_at, 'reading set created_at'),
    updated_at: string(item.updated_at, 'reading set updated_at'),
    papers: item.papers.map(parseReadingSetPaper),
  }
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`Invalid ${label}`)
  return value
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value as T
}

export function validateEntityAlignment(value: unknown): EntityAlignment {
  const item = record(value, 'entity alignment')
  return {
    id: string(item.id, 'alignment id'),
    reading_set_id: string(item.reading_set_id, 'alignment reading_set_id'),
    paper_a_id: string(item.paper_a_id, 'alignment paper_a_id'),
    subject_a_id: string(item.subject_a_id, 'alignment subject_a_id'),
    label_a: string(item.label_a, 'alignment label_a'),
    paper_b_id: string(item.paper_b_id, 'alignment paper_b_id'),
    subject_b_id: string(item.subject_b_id, 'alignment subject_b_id'),
    label_b: string(item.label_b, 'alignment label_b'),
    method: oneOf(item.method, ['deterministic', 'llm'], 'alignment method'),
    score: number(item.score, 'alignment score'),
    confidence: oneOf(item.confidence, ['high', 'medium', 'low'], 'alignment confidence'),
    status: oneOf(item.status, ['auto', 'confirmed', 'rejected', 'stale'], 'alignment status'),
    rationale: nullableString(item.rationale, 'alignment rationale'),
    created_at: string(item.created_at, 'alignment created_at'),
  }
}

function validateBulkAlignmentReview(value: unknown): BulkAlignmentReviewResult {
  const item = record(value, 'bulk alignment review')
  if (!Array.isArray(item.alignments)) throw new Error('Invalid bulk review alignments')
  return {
    updated_count: number(item.updated_count, 'bulk review updated_count'),
    alignments: item.alignments.map(validateEntityAlignment),
  }
}

function validateReferenceSuggestion(value: unknown): ReferenceSuggestion {
  const item = record(value, 'reference suggestion')
  if (!Array.isArray(item.cited_by_paper_ids)) {
    throw new Error('Invalid reference suggestion cited_by_paper_ids')
  }
  return {
    arxiv_id: string(item.arxiv_id, 'suggestion arxiv_id'),
    title: string(item.title, 'suggestion title'),
    abstract: typeof item.abstract === 'string' ? item.abstract : '',
    relevance: oneOf(item.relevance, ['high', 'medium', 'low'], 'suggestion relevance'),
    reason: typeof item.reason === 'string' ? item.reason : '',
    cited_by_paper_ids: item.cited_by_paper_ids.map(id => string(id, 'suggestion citing paper id')),
    library_paper_id: nullableString(item.library_paper_id, 'suggestion library_paper_id'),
    in_reading_set: item.in_reading_set === true,
  }
}

function validateReferenceSuggestions(value: unknown): ReferenceSuggestionsResult {
  const item = record(value, 'reference suggestions')
  if (!Array.isArray(item.suggestions)) throw new Error('Invalid reference suggestions list')
  const skipped = Array.isArray(item.skipped_papers) ? item.skipped_papers : []
  return {
    reading_set_id: string(item.reading_set_id, 'reference suggestions reading_set_id'),
    suggestions: item.suggestions.map(validateReferenceSuggestion),
    skipped_papers: skipped.map(entry => {
      const skippedRecord = record(entry, 'skipped paper')
      return {
        paper_id: string(skippedRecord.paper_id, 'skipped paper id'),
        filename: typeof skippedRecord.filename === 'string' ? skippedRecord.filename : '',
        reason: string(skippedRecord.reason, 'skipped paper reason'),
      }
    }),
  }
}

async function apiError(response: Response): Promise<ReadingSetApiError> {
  let message = response.statusText || 'Reading set request failed'
  try {
    const body = record(await response.json(), 'reading set error')
    if (typeof body.detail === 'string') message = body.detail
  } catch {
    // Preserve the status text for non-JSON and malformed error responses.
  }
  return new ReadingSetApiError(message, response.status)
}

export class HttpReadingSetApi implements ReadingSetApi {
  constructor(private readonly apiBase = API_BASE) {}

  async listReadingSets(): Promise<ReadingSet[]> {
    const value = await this.json('/api/reading-sets')
    if (!Array.isArray(value)) throw new Error('Invalid reading set list')
    return value.map(validateReadingSet)
  }

  async createReadingSet(name: string): Promise<ReadingSet> {
    return validateReadingSet(await this.json('/api/reading-sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    }))
  }

  async renameReadingSet(readingSetId: string, name: string): Promise<ReadingSet> {
    return validateReadingSet(await this.json(this.path(readingSetId), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    }))
  }

  async deleteReadingSet(readingSetId: string): Promise<void> {
    const response = await fetch(apiUrl(this.path(readingSetId), this.apiBase), { method: 'DELETE' })
    if (!response.ok) throw await apiError(response)
  }

  async addPaperToReadingSet(readingSetId: string, paperId: string): Promise<ReadingSet> {
    return validateReadingSet(await this.json(this.paperPath(readingSetId, paperId), { method: 'POST' }))
  }

  async removePaperFromReadingSet(readingSetId: string, paperId: string): Promise<ReadingSet> {
    return validateReadingSet(await this.json(this.paperPath(readingSetId, paperId), { method: 'DELETE' }))
  }

  async buildReadingSetAlignments(readingSetId: string): Promise<void> {
    await this.json(`${this.path(readingSetId)}/alignments/build`, { method: 'POST' })
  }

  async cancelReadingSetAlignments(readingSetId: string): Promise<void> {
    await this.json(`${this.path(readingSetId)}/alignments/build/cancel`, { method: 'POST' })
  }

  async listReadingSetAlignments(
    readingSetId: string,
    filter?: ReadingSetAlignmentFilter,
  ): Promise<EntityAlignment[]> {
    const params = new URLSearchParams()
    if (filter?.paperId) params.set('paper_id', filter.paperId)
    if (filter?.subjectId) params.set('subject_id', filter.subjectId)
    const query = params.toString()
    const value = await this.json(`${this.path(readingSetId)}/alignments${query ? `?${query}` : ''}`)
    if (!Array.isArray(value)) throw new Error('Invalid alignment list')
    return value.map(validateEntityAlignment)
  }

  async confirmReadingSetAlignment(readingSetId: string, alignmentId: string): Promise<EntityAlignment> {
    return validateEntityAlignment(
      await this.json(`${this.alignmentPath(readingSetId, alignmentId)}/confirm`, { method: 'POST' }),
    )
  }

  async rejectReadingSetAlignment(readingSetId: string, alignmentId: string): Promise<EntityAlignment> {
    return validateEntityAlignment(
      await this.json(`${this.alignmentPath(readingSetId, alignmentId)}/reject`, { method: 'POST' }),
    )
  }

  async bulkReviewReadingSetAlignments(
    readingSetId: string,
    action: 'confirm' | 'reject',
    filter?: ReadingSetAlignmentFilter,
  ): Promise<BulkAlignmentReviewResult> {
    return validateBulkAlignmentReview(await this.json(`${this.path(readingSetId)}/alignments/bulk-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        paper_id: filter?.paperId ?? null,
        subject_id: filter?.subjectId ?? null,
      }),
    }))
  }

  async suggestReadingSetReferences(
    readingSetId: string,
    maxCandidates?: number,
  ): Promise<ReferenceSuggestionsResult> {
    return validateReferenceSuggestions(await this.json(`${this.path(readingSetId)}/reference-suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(maxCandidates ? { max_candidates: maxCandidates } : {}),
    }))
  }

  watchReadingSetAlignments(
    readingSetId: string,
    onProgress: (progress: ReadingSetAlignmentProgress) => void,
    onConnectionError: () => void,
  ): () => void {
    const source = new EventSource(
      apiUrl(`${this.path(readingSetId)}/alignments/build/progress`, this.apiBase),
    )

    source.onmessage = event => {
      try {
        onProgress(JSON.parse(event.data) as ReadingSetAlignmentProgress)
      } catch {
        // SSE heartbeat comments and malformed progress events are non-fatal.
      }
    }
    source.onerror = () => onConnectionError()

    return () => source.close()
  }

  private path(readingSetId: string): string {
    return `/api/reading-sets/${encodeURIComponent(readingSetId)}`
  }

  private paperPath(readingSetId: string, paperId: string): string {
    return `${this.path(readingSetId)}/papers/${encodeURIComponent(paperId)}`
  }

  private alignmentPath(readingSetId: string, alignmentId: string): string {
    return `${this.path(readingSetId)}/alignments/${encodeURIComponent(alignmentId)}`
  }

  private async json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(apiUrl(path, this.apiBase), init)
    if (!response.ok) throw await apiError(response)
    return response.json()
  }
}
