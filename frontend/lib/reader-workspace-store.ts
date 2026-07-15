import type { Paper, PaperDetail } from '../hooks/usePapers'
import type { Tooltip } from '../hooks/useTooltips'

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

export interface ReaderWorkspaceApi {
  listPapers(): Promise<Paper[]>
  getPaper(paperId: string): Promise<PaperDetail>
  listTooltips(paperId: string): Promise<Tooltip[]>
  uploadPaper?(file: File): Promise<Paper>
  uploadArxiv?(urlOrId: string): Promise<Paper>
  compilePaper?(paperId: string): Promise<Paper>
  deletePaper?(paperId: string): Promise<void>
  buildKnowledgeGraph?(paperId: string): Promise<unknown>
  createTooltip?(
    paperId: string,
    domNodeId: string,
    content: string,
    targetText?: string,
  ): Promise<Tooltip>
  updateTooltip?(paperId: string, tooltipId: string, update: TooltipUpdate): Promise<Tooltip>
  deleteTooltip?(paperId: string, tooltipId: string): Promise<void>
  removeTooltipOccurrence?(paperId: string, tooltipId: string, domNodeId: string): Promise<void>
  watchCompilation?(
    paperId: string,
    onProgress: (progress: CompilationProgress) => void,
    onConnectionError: () => void,
  ): () => void
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
      this.setPaperStatus(paperId, 'Knowledge graph build started')
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

  closePaper(paperId: string): void {
    const openPaperIds = this.snapshot.openPaperIds.filter(id => id !== paperId)
    this.update({
      openPaperIds,
      activePaperId: this.snapshot.activePaperId === paperId
        ? openPaperIds.at(-1) ?? null
        : this.snapshot.activePaperId,
    })
  }

  clearPaperStatus(paperId: string): void {
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