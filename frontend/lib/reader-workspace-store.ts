import type { Paper, PaperDetail } from '../hooks/usePapers'
import type { Tooltip } from '../hooks/useTooltips'
import type {
  EquationDetails,
  SectionAnnotationsResponse,
  SemanticSelection,
  SemanticSubjectDetails,
} from './semantic-api'

export interface TooltipUpdate {
  content: string
  targetText?: string
  isPinned?: boolean
  displayOrder?: number
}

export interface CompilationProgress {
  type?: string
  stage?: string
  message?: string
  error?: string
}

export interface KnowledgeGraphProgress {
  type?: string
  stage: string
  progress: {
    stage?: string
    label?: string
    current?: number
    total?: number
  } | Record<string, { current: number; total: number }>
  error?: string
  node_count?: number
  edge_count?: number
}

export interface ReaderWorkspaceApi {
  listPapers(): Promise<Paper[]>
  getPaper(paperId: string): Promise<PaperDetail>
  listTooltips(paperId: string): Promise<Tooltip[]>
  uploadPaper?(file: File): Promise<Paper>
  uploadArxiv?(urlOrId: string): Promise<Paper>
  compilePaper?(paperId: string): Promise<Paper>
  deletePaper?(paperId: string): Promise<void>
  buildKnowledgeGraph?(paperId: string): Promise<unknown>
  cancelKnowledgeGraph?(paperId: string): Promise<unknown>
  reanchorOccurrences?(paperId: string): Promise<ReanchorOccurrencesResponse>
  createTooltip?(
    paperId: string,
    domNodeId: string,
    content: string,
    targetText?: string,
  ): Promise<Tooltip>
  updateTooltip?(paperId: string, tooltipId: string, update: TooltipUpdate): Promise<Tooltip>
  deleteTooltip?(paperId: string, tooltipId: string): Promise<void>
  removeTooltipOccurrence?(paperId: string, tooltipId: string, domNodeId: string): Promise<void>
  saveSemanticNote?(
    paperId: string,
    subjectId: string,
    content: string,
    targetText?: string | null,
  ): Promise<Tooltip>
  deleteSemanticNote?(paperId: string, subjectId: string): Promise<void>
  watchCompilation?(
    paperId: string,
    onProgress: (progress: CompilationProgress) => void,
    onConnectionError: () => void,
  ): () => void
  watchKnowledgeGraph?(
    paperId: string,
    onProgress: (progress: KnowledgeGraphProgress) => void,
    onConnectionError: () => void,
  ): () => void
  getSectionAnnotations?(paperId: string, sectionId: string): Promise<SectionAnnotationsResponse>
  getSemanticSubject?(paperId: string, subjectId: string): Promise<SemanticSubjectDetails>
  getEquationDetails?(paperId: string, equationId: string): Promise<EquationDetails>
}

export interface ReanchorOccurrencesResponse {
  status: string
  occurrence_count: number
  previous_occurrence_count: number
}

export interface ReaderWorkspaceSnapshot {
  papers: Paper[]
  libraryLoading: boolean
  libraryError: string | null
  activePaperId: string | null
  openPaperIds: string[]
  loadingPaperIds: string[]
  papersById: Record<string, PaperDetail>
  tooltipsByPaperId: Record<string, Tooltip[]>
  activeEntityByPaperId: Record<string, string | null>
  paperErrors: Record<string, string>
  statusByPaperId: Record<string, string>
  knowledgeGraphProgressByPaperId: Record<string, KnowledgeGraphProgress>
  semanticSelectionByPaperId: Record<string, SemanticSelection | null>
  sectionAnnotationsByPaperId: Record<string, Record<string, SectionAnnotationsResponse>>
  semanticSubjectsByPaperId: Record<string, Record<string, SemanticSubjectDetails>>
  equationDetailsByPaperId: Record<string, Record<string, EquationDetails>>
}

type Listener = () => void

const initialSnapshot = (): ReaderWorkspaceSnapshot => ({
  papers: [],
  libraryLoading: false,
  libraryError: null,
  activePaperId: null,
  openPaperIds: [],
  loadingPaperIds: [],
  papersById: {},
  tooltipsByPaperId: {},
  activeEntityByPaperId: {},
  paperErrors: {},
  statusByPaperId: {},
  knowledgeGraphProgressByPaperId: {},
  semanticSelectionByPaperId: {},
  sectionAnnotationsByPaperId: {},
  semanticSubjectsByPaperId: {},
  equationDetailsByPaperId: {},
})

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error && 'detail' in error) {
    return String(error.detail)
  }
  return 'Unknown error'
}

export class ReaderWorkspaceStore {
  private snapshot = initialSnapshot()
  private readonly listeners = new Set<Listener>()
  private readonly paperLoads = new Map<string, Promise<PaperDetail>>()
  private readonly compilationStops = new Map<string, () => void>()
  private readonly knowledgeGraphStops = new Map<string, () => void>()
  private readonly statusClearTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly paperOperationTokens = new Map<string, symbol>()

  constructor(private readonly api: ReaderWorkspaceApi) {}

  getSnapshot = (): ReaderWorkspaceSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async loadLibrary(): Promise<Paper[]> {
    this.update({ libraryLoading: true, libraryError: null })
    try {
      const papers = await this.api.listPapers()
      this.update({ papers, libraryLoading: false })
      return papers
    } catch (error) {
      this.update({
        libraryLoading: false,
        libraryError: errorMessage(error),
      })
      throw error
    }
  }

  openPaper(paperId: string): Promise<PaperDetail> {
    return this.loadPaper(paperId, true, false)
  }

  async refreshPaper(paperId: string): Promise<PaperDetail> {
    return this.loadPaper(paperId, false, true)
  }

  private loadPaper(
    paperId: string,
    activate: boolean,
    forceRefresh: boolean,
  ): Promise<PaperDetail> {
    if (!paperId.trim()) {
      return Promise.reject(new Error('Paper id is required'))
    }

    if (activate) {
      this.activatePaper(paperId)
    }

    const existingLoad = this.paperLoads.get(paperId)
    if (existingLoad) {
      return existingLoad
    }

    const loadedPaper = this.snapshot.papersById[paperId]
    if (loadedPaper && !forceRefresh) {
      return Promise.resolve(loadedPaper)
    }

    this.update({
      loadingPaperIds: this.snapshot.loadingPaperIds.includes(paperId)
        ? this.snapshot.loadingPaperIds
        : [...this.snapshot.loadingPaperIds, paperId],
      paperErrors: this.withoutKey(this.snapshot.paperErrors, paperId),
    })

    const load = Promise.all([
      this.api.getPaper(paperId),
      this.api.listTooltips(paperId),
    ])
      .then(([paper, tooltips]) => {
        this.update({
          papersById: { ...this.snapshot.papersById, [paperId]: paper },
          tooltipsByPaperId: { ...this.snapshot.tooltipsByPaperId, [paperId]: tooltips },
          loadingPaperIds: this.snapshot.loadingPaperIds.filter(id => id !== paperId),
        })
        return paper
      })
      .catch(error => {
        this.update({
          loadingPaperIds: this.snapshot.loadingPaperIds.filter(id => id !== paperId),
          paperErrors: {
            ...this.snapshot.paperErrors,
            [paperId]: errorMessage(error),
          },
        })
        throw error
      })
      .finally(() => {
        this.paperLoads.delete(paperId)
      })

    this.paperLoads.set(paperId, load)
    return load
  }

  async refreshTooltips(paperId: string): Promise<Tooltip[]> {
    const tooltips = await this.api.listTooltips(paperId)
    this.update({
      tooltipsByPaperId: {
        ...this.snapshot.tooltipsByPaperId,
        [paperId]: tooltips,
      },
    })
    return tooltips
  }

  async uploadPaper(file: File): Promise<Paper> {
    const upload = this.requireOperation('uploadPaper')
    const paper = await upload.call(this.api, file)
    await this.loadLibrary()
    this.activatePaper(paper.id)
    this.watchCompilation(paper.id)
    return paper
  }

  async uploadArxiv(urlOrId: string): Promise<Paper> {
    if (!urlOrId.trim()) {
      throw new Error('arXiv id or URL is required')
    }
    const upload = this.requireOperation('uploadArxiv')
    const paper = await upload.call(this.api, urlOrId.trim())
    await this.loadLibrary()
    this.activatePaper(paper.id)
    this.watchCompilation(paper.id)
    return paper
  }

  async compilePaper(paperId: string): Promise<void> {
    const compile = this.requireOperation('compilePaper')
    this.setPaperStatus(paperId, 'Starting compilation…')
    try {
      await compile.call(this.api, paperId)
      this.watchCompilation(paperId)
    } catch (error) {
      this.setPaperError(paperId, error)
      this.clearPaperStatus(paperId)
      throw error
    }
  }

  async buildKnowledgeGraph(paperId: string): Promise<void> {
    const build = this.requireOperation('buildKnowledgeGraph')
    this.setPaperStatus(paperId, 'Starting knowledge graph build…')
    try {
      await build.call(this.api, paperId)
      this.watchKnowledgeGraph(paperId)
    } catch (error) {
      this.setPaperError(paperId, error)
      this.clearPaperStatus(paperId)
      throw error
    }
  }

  async reanchorOccurrences(paperId: string): Promise<ReanchorOccurrencesResponse> {
    const reanchor = this.requireOperation('reanchorOccurrences')
    this.setPaperStatus(paperId, 'Re-anchoring terms…')
    try {
      const response = await reanchor.call(this.api, paperId)
      // Anchors live in the graph, so the reader's cached paper detail is stale.
      await this.refreshPaper(paperId)
      return response
    } catch (error) {
      this.setPaperError(paperId, error)
      throw error
    } finally {
      this.clearPaperStatus(paperId)
    }
  }

  async cancelKnowledgeGraph(paperId: string): Promise<void> {
    const cancel = this.requireOperation('cancelKnowledgeGraph')
    this.setPaperStatus(paperId, 'Stopping knowledge graph build…')
    try {
      await cancel.call(this.api, paperId)
    } catch (error) {
      this.setPaperError(paperId, error)
      this.clearPaperStatus(paperId)
      throw error
    }
  }

  async deletePaper(paperId: string): Promise<void> {
    const remove = this.requireOperation('deletePaper')
    await remove.call(this.api, paperId)
    this.compilationStops.get(paperId)?.()
    this.compilationStops.delete(paperId)
    this.knowledgeGraphStops.get(paperId)?.()
    this.knowledgeGraphStops.delete(paperId)
    this.cancelStatusClear(paperId)
    this.paperOperationTokens.delete(paperId)

    const nextOpenPaperIds = this.snapshot.openPaperIds.filter(id => id !== paperId)
    this.update({
      papers: this.snapshot.papers.filter(paper => paper.id !== paperId),
      activePaperId: this.snapshot.activePaperId === paperId
        ? nextOpenPaperIds.at(-1) ?? null
        : this.snapshot.activePaperId,
      openPaperIds: nextOpenPaperIds,
      papersById: this.withoutKey(this.snapshot.papersById, paperId),
      tooltipsByPaperId: this.withoutKey(this.snapshot.tooltipsByPaperId, paperId),
      activeEntityByPaperId: this.withoutKey(this.snapshot.activeEntityByPaperId, paperId),
      paperErrors: this.withoutKey(this.snapshot.paperErrors, paperId),
      statusByPaperId: this.withoutKey(this.snapshot.statusByPaperId, paperId),
      knowledgeGraphProgressByPaperId: this.withoutKey(
        this.snapshot.knowledgeGraphProgressByPaperId,
        paperId,
      ),
    })
  }

  async createTooltip(
    paperId: string,
    domNodeId: string,
    content: string,
    targetText?: string,
  ): Promise<Tooltip> {
    const create = this.requireOperation('createTooltip')
    const tooltip = await create.call(this.api, paperId, domNodeId, content, targetText)
    this.updateTooltipState(paperId, tooltip)
    return tooltip
  }

  async updateTooltip(paperId: string, tooltipId: string, update: TooltipUpdate): Promise<Tooltip> {
    const save = this.requireOperation('updateTooltip')
    const tooltip = await save.call(this.api, paperId, tooltipId, update)
    this.updateTooltipState(paperId, tooltip)
    return tooltip
  }

  async deleteTooltip(paperId: string, tooltipId: string): Promise<void> {
    const remove = this.requireOperation('deleteTooltip')
    await remove.call(this.api, paperId, tooltipId)
    this.update({
      tooltipsByPaperId: {
        ...this.snapshot.tooltipsByPaperId,
        [paperId]: (this.snapshot.tooltipsByPaperId[paperId] ?? [])
          .filter(tooltip => tooltip.id !== tooltipId),
      },
    })
    await this.refreshPaper(paperId)
  }

  async removeTooltipOccurrence(
    paperId: string,
    tooltipId: string,
    domNodeId: string,
  ): Promise<void> {
    const remove = this.requireOperation('removeTooltipOccurrence')
    await remove.call(this.api, paperId, tooltipId, domNodeId)
    await this.refreshPaper(paperId)
  }

  /**
   * Replaces the agent's text about one semantic subject with the reader's own.
   * The paper HTML is untouched: anchors stay where the graph put them, only the
   * text behind them changes, so there is no need to reload the paper.
   */
  async saveSemanticNote(
    paperId: string,
    subjectId: string,
    content: string,
    targetText?: string | null,
  ): Promise<Tooltip> {
    const save = this.requireOperation('saveSemanticNote')
    const tooltip = await save.call(this.api, paperId, subjectId, content, targetText)
    this.updateTooltipState(paperId, tooltip)
    return tooltip
  }

  /** Drops the reader's text for a subject so the agent's own text shows again. */
  async clearSemanticNote(paperId: string, subjectId: string): Promise<void> {
    const remove = this.requireOperation('deleteSemanticNote')
    await remove.call(this.api, paperId, subjectId)
    this.update({
      tooltipsByPaperId: {
        ...this.snapshot.tooltipsByPaperId,
        [paperId]: (this.snapshot.tooltipsByPaperId[paperId] ?? [])
          .filter(tooltip => tooltip.entity_id !== subjectId),
      },
    })
  }

  activatePaper(paperId: string): void {
    if (!paperId.trim()) {
      return
    }
    this.update({
      activePaperId: paperId,
      openPaperIds: this.snapshot.openPaperIds.includes(paperId)
        ? this.snapshot.openPaperIds
        : [...this.snapshot.openPaperIds, paperId],
    })
  }

  setActiveEntity(paperId: string, entityId: string | null): void {
    if (!paperId.trim()) {
      return
    }
    this.update({
      activeEntityByPaperId: {
        ...this.snapshot.activeEntityByPaperId,
        [paperId]: entityId,
      },
    })
  }

  setSemanticSelection(paperId: string, selection: SemanticSelection | null): void {
    if (!paperId.trim()) return
    this.update({
      semanticSelectionByPaperId: {
        ...this.snapshot.semanticSelectionByPaperId,
        [paperId]: selection,
      },
    })
  }

  async loadSectionAnnotations(
    paperId: string,
    sectionId: string,
  ): Promise<SectionAnnotationsResponse> {
    const cached = this.snapshot.sectionAnnotationsByPaperId[paperId]?.[sectionId]
    if (cached) return cached
    const load = this.requireOperation('getSectionAnnotations')
    const response = await load.call(this.api, paperId, sectionId)
    this.update({
      sectionAnnotationsByPaperId: {
        ...this.snapshot.sectionAnnotationsByPaperId,
        [paperId]: {
          ...this.snapshot.sectionAnnotationsByPaperId[paperId],
          [sectionId]: response,
        },
      },
    })
    return response
  }

  async loadSemanticSubject(
    paperId: string,
    subjectId: string,
  ): Promise<SemanticSubjectDetails> {
    const cached = this.snapshot.semanticSubjectsByPaperId[paperId]?.[subjectId]
    if (cached) return cached
    const load = this.requireOperation('getSemanticSubject')
    const response = await load.call(this.api, paperId, subjectId)
    this.update({
      semanticSubjectsByPaperId: {
        ...this.snapshot.semanticSubjectsByPaperId,
        [paperId]: {
          ...this.snapshot.semanticSubjectsByPaperId[paperId],
          [subjectId]: response,
        },
      },
    })
    return response
  }

  async loadEquationDetails(paperId: string, equationId: string): Promise<EquationDetails> {
    const cached = this.snapshot.equationDetailsByPaperId[paperId]?.[equationId]
    if (cached) return cached
    const load = this.requireOperation('getEquationDetails')
    const response = await load.call(this.api, paperId, equationId)
    this.update({
      equationDetailsByPaperId: {
        ...this.snapshot.equationDetailsByPaperId,
        [paperId]: {
          ...this.snapshot.equationDetailsByPaperId[paperId],
          [equationId]: response,
        },
      },
    })
    return response
  }

  closePaper(paperId: string): void {
    const openPaperIds = this.snapshot.openPaperIds.filter(id => id !== paperId)
    this.update({
      openPaperIds,
      activePaperId: this.snapshot.activePaperId === paperId
        ? openPaperIds.at(-1) ?? null
        : this.snapshot.activePaperId,
    })
  }

  startPaperOperation(paperId: string, status: string): () => void {
    const token = Symbol(status)
    this.paperOperationTokens.set(paperId, token)
    this.setPaperStatus(paperId, status)
    let finished = false
    return () => {
      if (finished) {
        return
      }
      finished = true
      if (this.paperOperationTokens.get(paperId) !== token) {
        return
      }
      this.paperOperationTokens.delete(paperId)
      if (this.snapshot.statusByPaperId[paperId] === status) {
        this.clearPaperStatus(paperId)
      }
    }
  }

  clearPaperStatus(paperId: string): void {
    this.cancelStatusClear(paperId)
    this.update({ statusByPaperId: this.withoutKey(this.snapshot.statusByPaperId, paperId) })
  }

  private watchCompilation(paperId: string): void {
    const watch = this.api.watchCompilation
    if (!watch) {
      return
    }

    this.compilationStops.get(paperId)?.()
    const stop = watch.call(
      this.api,
      paperId,
      progress => {
        if (progress.type === 'connected') {
          return
        }
        if (progress.stage === 'complete') {
          stop()
          this.compilationStops.delete(paperId)
          this.clearPaperStatus(paperId)
          void Promise.all([this.refreshPaper(paperId), this.loadLibrary()])
        } else if (progress.stage === 'error') {
          stop()
          this.compilationStops.delete(paperId)
          this.setPaperError(paperId, new Error(progress.error || 'Compilation failed'))
          this.clearPaperStatus(paperId)
        } else if (progress.message) {
          this.setPaperStatus(paperId, progress.message)
        }
      },
      () => {
        stop()
        this.compilationStops.delete(paperId)
        this.setPaperError(paperId, new Error('Lost connection to compilation stream'))
        this.clearPaperStatus(paperId)
      },
    )
    this.compilationStops.set(paperId, stop)
  }

  private watchKnowledgeGraph(paperId: string): void {
    const watch = this.api.watchKnowledgeGraph
    if (!watch) {
      const status = 'Knowledge graph build started'
      this.setPaperStatus(paperId, status)
      this.scheduleStatusClear(paperId, status)
      return
    }

    this.knowledgeGraphStops.get(paperId)?.()
    let stop = (): void => undefined
    let finished = false
    const finish = (): void => {
      if (finished) {
        return
      }
      finished = true
      stop()
      if (this.knowledgeGraphStops.get(paperId) === finish) {
        this.knowledgeGraphStops.delete(paperId)
      }
    }

    stop = watch.call(
      this.api,
      paperId,
      progress => {
        if (finished) {
          return
        }
        if (progress.type === 'connected') {
          return
        }

        this.update({
          knowledgeGraphProgressByPaperId: {
            ...this.snapshot.knowledgeGraphProgressByPaperId,
            [paperId]: progress,
          },
        })

        if (progress.stage === 'complete') {
          finish()
          const nodes = progress.node_count ?? 0
          const edges = progress.edge_count ?? 0
          const status = `Knowledge graph ready: ${nodes} nodes, ${edges} edges`
          this.setPaperStatus(paperId, status)
          this.scheduleStatusClear(paperId, status)
          void Promise.all([this.refreshPaper(paperId), this.loadLibrary()]).catch(error => {
            this.setPaperError(paperId, error)
          })
        } else if (progress.stage === 'cancelled') {
          finish()
          this.clearPaperStatus(paperId)
        } else if (progress.stage === 'error') {
          finish()
          this.setPaperError(paperId, new Error(progress.error || 'Knowledge graph build failed'))
          this.clearPaperStatus(paperId)
        } else {
          this.setPaperStatus(paperId, knowledgeGraphStatus(progress))
        }
      },
      () => {
        if (finished) {
          return
        }
        finish()
        this.setPaperError(
          paperId,
          new Error('Lost connection to knowledge graph progress stream'),
        )
        this.clearPaperStatus(paperId)
      },
    )

    if (finished) {
      stop()
    } else {
      this.knowledgeGraphStops.set(paperId, finish)
    }
  }

  private updateTooltipState(paperId: string, tooltip: Tooltip): void {
    const current = this.snapshot.tooltipsByPaperId[paperId] ?? []
    const exists = current.some(item => item.id === tooltip.id)
    this.update({
      tooltipsByPaperId: {
        ...this.snapshot.tooltipsByPaperId,
        [paperId]: exists
          ? current.map(item => item.id === tooltip.id ? tooltip : item)
          : [...current, tooltip],
      },
    })
  }

  private setPaperStatus(paperId: string, status: string): void {
    this.cancelStatusClear(paperId)
    this.update({
      statusByPaperId: { ...this.snapshot.statusByPaperId, [paperId]: status },
      paperErrors: this.withoutKey(this.snapshot.paperErrors, paperId),
    })
  }

  private setPaperError(paperId: string, error: unknown): void {
    this.update({
      paperErrors: { ...this.snapshot.paperErrors, [paperId]: errorMessage(error) },
    })
  }

  private scheduleStatusClear(paperId: string, status: string): void {
    this.cancelStatusClear(paperId)
    const timer = setTimeout(() => {
      this.statusClearTimers.delete(paperId)
      if (this.snapshot.statusByPaperId[paperId] === status) {
        this.clearPaperStatus(paperId)
      }
    }, 4000)
    this.statusClearTimers.set(paperId, timer)
  }

  private cancelStatusClear(paperId: string): void {
    const timer = this.statusClearTimers.get(paperId)
    if (timer) {
      clearTimeout(timer)
      this.statusClearTimers.delete(paperId)
    }
  }

  private requireOperation<K extends keyof ReaderWorkspaceApi>(
    name: K,
  ): NonNullable<ReaderWorkspaceApi[K]> {
    const operation = this.api[name]
    if (typeof operation !== 'function') {
      throw new Error(`Reader API operation ${String(name)} is not available`)
    }
    return operation as NonNullable<ReaderWorkspaceApi[K]>
  }

  private update(patch: Partial<ReaderWorkspaceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }

  private withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
    const next = { ...record }
    delete next[key]
    return next
  }
}

function knowledgeGraphStatus(progress: KnowledgeGraphProgress): string {
  if ('current' in progress.progress && 'total' in progress.progress) {
    const current = progress.progress.current
    const total = progress.progress.total
    if (Number.isFinite(current) && Number.isFinite(total) && Number(total) > 0) {
      const boundedCurrent = Math.min(Number(current), Number(total))
      const percent = Math.round((boundedCurrent / Number(total)) * 100)
      const label = progress.progress.label || progress.progress.stage || 'Knowledge graph'
      return `${label}: ${boundedCurrent}/${total} (${percent}%)`
    }
  }
  const stages = Object.values(progress.progress ?? {})
    .filter((stage): stage is { current: number; total: number } => (
      typeof stage === 'object'
      && stage !== null
      && 'current' in stage
      && 'total' in stage
      && Number.isFinite(stage.current)
      && Number.isFinite(stage.total)
      && stage.total > 0
    ))
  if (stages.length === 0) {
    return 'Building knowledge graph…'
  }

  const current = stages.reduce((sum, stage) => sum + Math.min(stage.current, stage.total), 0)
  const total = stages.reduce((sum, stage) => sum + stage.total, 0)
  const percent = Math.round((current / total) * 100)
  return `Knowledge graph: ${current}/${total} (${percent}%)`
}