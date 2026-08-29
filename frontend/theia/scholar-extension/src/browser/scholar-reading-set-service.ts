import { inject, injectable } from '@theia/core/shared/inversify'

import { HttpReaderWorkspaceApi } from '../../../../lib/reader-workspace-api'
import type {
  EntityAlignment,
  ReadingSet,
  ReadingSetApi,
  SkippedAlignmentPaper,
} from '../../../../lib/reading-set-api'

/** Live progress of one "Link terms" build, keyed by reading set id. */
export interface ReadingSetAlignmentBuild {
  readonly stage: 'starting' | 'linking'
  readonly label?: string
  readonly current?: number
  readonly total?: number
}

/** Terminal outcome of one "Link terms" build. */
export interface ReadingSetLinkTermsResult {
  readonly stage: 'complete' | 'cancelled' | 'error'
  readonly alignmentCount: number
  readonly deterministicCount: number
  readonly llmCount: number
  readonly staleCount: number
  readonly skippedPapers: readonly SkippedAlignmentPaper[]
  readonly error?: string
}

export interface ScholarReadingSetSnapshot {
  readonly readingSets: readonly ReadingSet[]
  readonly loading: boolean
  readonly error: string | null
  readonly alignmentBuilds: Readonly<Record<string, ReadingSetAlignmentBuild>>
}

type Listener = () => void

function errorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : 'Reading set request failed.'
}

/**
 * Evented reading-set state shared by the Reading Sets tree, the library
 * context menu, and (later) the alignment/chat features. All mutations go
 * through the backend first; the snapshot is updated from the authoritative
 * response, so widgets never see optimistic state that can diverge.
 */
@injectable()
export class ScholarReadingSetService {
  private snapshot: ScholarReadingSetSnapshot = {
    readingSets: [],
    loading: false,
    error: null,
    alignmentBuilds: {},
  }
  private readonly listeners = new Set<Listener>()
  private initialization: Promise<void> | undefined
  private readonly alignmentsCache = new Map<string, readonly EntityAlignment[]>()

  constructor(
    @inject(HttpReaderWorkspaceApi) private readonly api: ReadingSetApi,
  ) {}

  getSnapshot = (): ScholarReadingSetSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.listeners.clear()
  }

  /** Loads the reading sets once; concurrent callers share the same request. */
  initialize(): Promise<void> {
    this.initialization ??= this.refresh()
    return this.initialization
  }

  async refresh(): Promise<void> {
    this.update({ loading: true, error: null })
    try {
      const readingSets = await this.api.listReadingSets()
      this.update({ readingSets, loading: false })
    } catch (reason) {
      this.update({ loading: false, error: errorMessage(reason) })
    }
  }

  async createReadingSet(name: string): Promise<ReadingSet> {
    const created = await this.api.createReadingSet(name)
    this.update({ readingSets: [...this.snapshot.readingSets, created], error: null })
    return created
  }

  async renameReadingSet(readingSetId: string, name: string): Promise<ReadingSet> {
    const renamed = await this.api.renameReadingSet(readingSetId, name)
    this.replace(renamed)
    return renamed
  }

  async deleteReadingSet(readingSetId: string): Promise<void> {
    await this.api.deleteReadingSet(readingSetId)
    this.update({
      readingSets: this.snapshot.readingSets.filter(set => set.id !== readingSetId),
      error: null,
    })
  }

  async addPaperToReadingSet(readingSetId: string, paperId: string): Promise<ReadingSet> {
    const updated = await this.api.addPaperToReadingSet(readingSetId, paperId)
    this.replace(updated)
    return updated
  }

  async removePaperFromReadingSet(readingSetId: string, paperId: string): Promise<ReadingSet> {
    const updated = await this.api.removePaperFromReadingSet(readingSetId, paperId)
    this.replace(updated)
    return updated
  }

  readingSetOf(readingSetId: string): ReadingSet | undefined {
    return this.snapshot.readingSets.find(set => set.id === readingSetId)
  }

  isLinkingTerms(readingSetId: string): boolean {
    return readingSetId in this.snapshot.alignmentBuilds
  }

  /**
   * Starts a "Link terms" build and resolves with its terminal outcome. Live
   * progress is published through the snapshot so the Reading Sets tree can
   * render an indicator next to the set.
   */
  async linkTerms(readingSetId: string): Promise<ReadingSetLinkTermsResult> {
    if (this.isLinkingTerms(readingSetId)) {
      throw new Error('Term linking is already in progress for this reading set.')
    }
    await this.api.buildReadingSetAlignments(readingSetId)
    this.setAlignmentBuild(readingSetId, { stage: 'starting' })

    return new Promise<ReadingSetLinkTermsResult>((resolve, reject) => {
      const close = this.api.watchReadingSetAlignments(readingSetId, progress => {
        if (progress.stage === 'starting' || progress.stage === 'linking') {
          this.setAlignmentBuild(readingSetId, {
            stage: progress.stage,
            label: progress.progress?.label,
            current: progress.progress?.current,
            total: progress.progress?.total,
          })
          return
        }
        if (progress.stage === 'complete' || progress.stage === 'cancelled' || progress.stage === 'error') {
          close()
          this.clearAlignmentBuild(readingSetId)
          if (progress.stage === 'complete') {
            this.alignmentsCache.delete(readingSetId)
          }
          resolve({
            stage: progress.stage,
            alignmentCount: progress.alignment_count ?? 0,
            deterministicCount: progress.deterministic_count ?? 0,
            llmCount: progress.llm_count ?? 0,
            staleCount: progress.stale_count ?? 0,
            skippedPapers: progress.skipped_papers ?? [],
            error: progress.error,
          })
        }
      }, () => {
        close()
        this.clearAlignmentBuild(readingSetId)
        reject(new Error('Lost connection to the term linking progress stream.'))
      })
    })
  }

  /** Requests cooperative cancellation; the SSE stream reports the outcome. */
  cancelLinkTerms(readingSetId: string): Promise<void> {
    return this.api.cancelReadingSetAlignments(readingSetId)
  }

  alignmentsOf(readingSetId: string): readonly EntityAlignment[] | undefined {
    return this.alignmentsCache.get(readingSetId)
  }

  async loadAlignments(readingSetId: string): Promise<readonly EntityAlignment[]> {
    const alignments = await this.api.listReadingSetAlignments(readingSetId)
    this.alignmentsCache.set(readingSetId, alignments)
    this.update({})
    return alignments
  }

  async confirmAlignment(readingSetId: string, alignmentId: string): Promise<EntityAlignment> {
    const updated = await this.api.confirmReadingSetAlignment(readingSetId, alignmentId)
    this.replaceAlignment(readingSetId, updated)
    return updated
  }

  async rejectAlignment(readingSetId: string, alignmentId: string): Promise<EntityAlignment> {
    const updated = await this.api.rejectReadingSetAlignment(readingSetId, alignmentId)
    this.replaceAlignment(readingSetId, updated)
    return updated
  }

  private replaceAlignment(readingSetId: string, updated: EntityAlignment): void {
    const cached = this.alignmentsCache.get(readingSetId)
    if (!cached) {
      return
    }
    this.alignmentsCache.set(
      readingSetId,
      cached.map(alignment => (alignment.id === updated.id ? updated : alignment)),
    )
    this.update({})
  }

  private setAlignmentBuild(readingSetId: string, build: ReadingSetAlignmentBuild): void {
    this.update({
      alignmentBuilds: { ...this.snapshot.alignmentBuilds, [readingSetId]: build },
    })
  }

  private clearAlignmentBuild(readingSetId: string): void {
    const { [readingSetId]: removed, ...rest } = this.snapshot.alignmentBuilds
    void removed
    this.update({ alignmentBuilds: rest })
  }

  private replace(updated: ReadingSet): void {
    const known = this.snapshot.readingSets.some(set => set.id === updated.id)
    this.update({
      readingSets: known
        ? this.snapshot.readingSets.map(set => (set.id === updated.id ? updated : set))
        : [...this.snapshot.readingSets, updated],
      error: null,
    })
  }

  private update(patch: Partial<ScholarReadingSetSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach(listener => listener())
  }
}
