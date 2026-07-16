import type { Paper, PaperDetail } from '../hooks/usePapers'
import type { Tooltip } from '../hooks/useTooltips'
import { API_BASE, apiUrl } from '../hooks/useApi'
import type {
  CompilationProgress,
  KnowledgeGraphProgress,
  ReaderWorkspaceApi,
  TooltipUpdate,
} from './reader-workspace-store'

interface PaperListResponse {
  papers: Paper[]
}

interface TooltipListResponse {
  tooltips: Tooltip[]
}

interface ApiErrorBody {
  detail?: string
}

export class HttpReaderWorkspaceApi implements ReaderWorkspaceApi {
  constructor(private readonly apiBase = API_BASE) {}

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
    return response.json() as Promise<T>
  }

  private url(endpoint: string): string {
    return apiUrl(endpoint, this.apiBase)
  }
}