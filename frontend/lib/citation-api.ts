import { API_BASE, apiUrl } from '../hooks/useApi'

export type CitationTargetKind = 'section' | 'passage' | 'none'
export type CitationConfidence = 'high' | 'medium' | 'low'

export interface CitationMatchedPaper {
  id: string
  title: string | null
  filename: string
}

export interface CitationCard {
  cite_key: string
  bib_text: string
  dom_node_id: string | null
  arxiv_id: string | null
  matched_paper: CitationMatchedPaper | null
  has_cached_resolution: boolean
}

export interface CitationResolution {
  paper_id: string
  cite_key: string
  target_paper_id: string
  target_kind: CitationTargetKind
  target_section_id: string | null
  target_dom_node_id: string | null
  quote: string | null
  confidence: CitationConfidence
  resolved_at: string
  cached: boolean
}

export interface CitationApi {
  getCitationCard(paperId: string, citeKey: string): Promise<CitationCard>
  resolveCitation(
    paperId: string,
    citeKey: string,
    targetPaperId: string,
  ): Promise<CitationResolution>
}

export class CitationApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'CitationApiError'
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

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value as T
}

export function validateCitationCard(value: unknown): CitationCard {
  const item = record(value, 'citation card')
  let matched: CitationMatchedPaper | null = null
  if (item.matched_paper !== null && item.matched_paper !== undefined) {
    const paper = record(item.matched_paper, 'citation matched paper')
    matched = {
      id: string(paper.id, 'matched paper id'),
      title: nullableString(paper.title, 'matched paper title'),
      filename: string(paper.filename, 'matched paper filename'),
    }
  }
  return {
    cite_key: string(item.cite_key, 'citation cite_key'),
    bib_text: typeof item.bib_text === 'string' ? item.bib_text : '',
    dom_node_id: nullableString(item.dom_node_id, 'citation dom_node_id'),
    arxiv_id: nullableString(item.arxiv_id, 'citation arxiv_id'),
    matched_paper: matched,
    has_cached_resolution: item.has_cached_resolution === true,
  }
}

export function validateCitationResolution(value: unknown): CitationResolution {
  const item = record(value, 'citation resolution')
  return {
    paper_id: string(item.paper_id, 'resolution paper_id'),
    cite_key: string(item.cite_key, 'resolution cite_key'),
    target_paper_id: string(item.target_paper_id, 'resolution target_paper_id'),
    target_kind: oneOf(item.target_kind, ['section', 'passage', 'none'], 'resolution target_kind'),
    target_section_id: nullableString(item.target_section_id, 'resolution target_section_id'),
    target_dom_node_id: nullableString(item.target_dom_node_id, 'resolution target_dom_node_id'),
    quote: nullableString(item.quote, 'resolution quote'),
    confidence: oneOf(item.confidence, ['high', 'medium', 'low'], 'resolution confidence'),
    resolved_at: string(item.resolved_at, 'resolution resolved_at'),
    cached: item.cached === true,
  }
}

async function apiError(response: Response): Promise<CitationApiError> {
  let message = response.statusText || 'Citation request failed'
  try {
    const body = record(await response.json(), 'citation error')
    if (typeof body.detail === 'string') message = body.detail
  } catch {
    // Preserve the status text for non-JSON and malformed error responses.
  }
  return new CitationApiError(message, response.status)
}

export class HttpCitationApi implements CitationApi {
  constructor(private readonly apiBase = API_BASE) {}

  async getCitationCard(paperId: string, citeKey: string): Promise<CitationCard> {
    return validateCitationCard(await this.json(`${this.path(paperId, citeKey)}/card`))
  }

  async resolveCitation(
    paperId: string,
    citeKey: string,
    targetPaperId: string,
  ): Promise<CitationResolution> {
    return validateCitationResolution(await this.json(`${this.path(paperId, citeKey)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_paper_id: targetPaperId }),
    }))
  }

  private path(paperId: string, citeKey: string): string {
    return `/api/papers/${encodeURIComponent(paperId)}/citations/${encodeURIComponent(citeKey)}`
  }

  private async json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(apiUrl(path, this.apiBase), init)
    if (!response.ok) throw await apiError(response)
    return response.json()
  }
}
