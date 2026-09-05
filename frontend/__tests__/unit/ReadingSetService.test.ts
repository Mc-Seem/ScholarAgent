import { describe, expect, it, vi } from 'vitest'

import type {
  EntityAlignment,
  ReadingSet,
  ReadingSetAlignmentProgress,
  ReadingSetApi,
} from '@/lib/reading-set-api'
import { ScholarReadingSetService } from '@/theia/scholar-extension/src/browser/scholar-reading-set-service'

function readingSet(id: string, overrides: Partial<ReadingSet> = {}): ReadingSet {
  return {
    id,
    name: `Set ${id}`,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    papers: [],
    ...overrides,
  }
}

function alignment(id: string, overrides: Partial<EntityAlignment> = {}): EntityAlignment {
  return {
    id,
    reading_set_id: 'set-a',
    paper_a_id: 'paper-1',
    subject_a_id: 'subject-1',
    label_a: 'Policy Improvement',
    paper_b_id: 'paper-2',
    subject_b_id: 'subject-2',
    label_b: 'policy iteration step',
    method: 'deterministic',
    score: 1,
    confidence: 'high',
    status: 'auto',
    rationale: null,
    created_at: '2026-08-29T00:00:00Z',
    ...overrides,
  }
}

interface WatchController {
  emit(progress: ReadingSetAlignmentProgress): void
  fail(): void
  readonly close: ReturnType<typeof vi.fn>
}

function setup(initialSets: ReadingSet[] = [readingSet('set-a')]) {
  const watchers: WatchController[] = []
  const api: ReadingSetApi = {
    listReadingSets: vi.fn().mockResolvedValue(initialSets),
    createReadingSet: vi.fn().mockImplementation(async (name: string) => readingSet('set-new', { name })),
    renameReadingSet: vi.fn().mockImplementation(async (id: string, name: string) => readingSet(id, { name })),
    deleteReadingSet: vi.fn().mockResolvedValue(undefined),
    addPaperToReadingSet: vi.fn(),
    removePaperFromReadingSet: vi.fn(),
    buildReadingSetAlignments: vi.fn().mockResolvedValue(undefined),
    cancelReadingSetAlignments: vi.fn().mockResolvedValue(undefined),
    listReadingSetAlignments: vi.fn().mockResolvedValue([]),
    confirmReadingSetAlignment: vi.fn(),
    rejectReadingSetAlignment: vi.fn(),
    bulkReviewReadingSetAlignments: vi.fn().mockResolvedValue({ updated_count: 0, alignments: [] }),
    suggestReadingSetReferences: vi.fn().mockResolvedValue({
      reading_set_id: 'set-a',
      suggestions: [],
      skipped_papers: [],
    }),
    watchReadingSetAlignments: vi.fn().mockImplementation((
      _readingSetId: string,
      onProgress: (progress: ReadingSetAlignmentProgress) => void,
      onConnectionError: () => void,
    ) => {
      const close = vi.fn()
      watchers.push({ emit: onProgress, fail: onConnectionError, close })
      return close
    }),
  }
  const service = new ScholarReadingSetService(api)
  return { api, service, watchers }
}

describe('ScholarReadingSetService', () => {
  it('loads reading sets on initialize and shares one request among callers', async () => {
    const { api, service } = setup()

    await Promise.all([service.initialize(), service.initialize()])

    expect(api.listReadingSets).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot()).toMatchObject({ loading: false, error: null })
    expect(service.getSnapshot().readingSets).toHaveLength(1)
    expect(service.readingSetOf('set-a')?.name).toBe('Set set-a')
  })

  it('records a readable error when the initial load fails', async () => {
    const { api, service } = setup()
    vi.mocked(api.listReadingSets).mockRejectedValueOnce(new Error('backend down'))

    await service.initialize()

    expect(service.getSnapshot()).toMatchObject({ loading: false, error: 'backend down' })
    expect(service.getSnapshot().readingSets).toHaveLength(0)
  })

  it('notifies subscribers when the snapshot changes and stops after unsubscribe', async () => {
    const { service } = setup()
    const listener = vi.fn()
    const unsubscribe = service.subscribe(listener)

    await service.initialize()
    expect(listener).toHaveBeenCalled()

    listener.mockClear()
    unsubscribe()
    await service.refresh()
    expect(listener).not.toHaveBeenCalled()
  })

  it('appends a created reading set to the snapshot', async () => {
    const { api, service } = setup()
    await service.initialize()

    const created = await service.createReadingSet('Policy Gradient Papers')

    expect(api.createReadingSet).toHaveBeenCalledWith('Policy Gradient Papers')
    expect(created.name).toBe('Policy Gradient Papers')
    expect(service.getSnapshot().readingSets.map(set => set.id)).toEqual(['set-a', 'set-new'])
  })

  it('replaces the renamed reading set in place', async () => {
    const { api, service } = setup([readingSet('set-a'), readingSet('set-b')])
    await service.initialize()

    await service.renameReadingSet('set-a', 'Renamed')

    expect(api.renameReadingSet).toHaveBeenCalledWith('set-a', 'Renamed')
    expect(service.getSnapshot().readingSets.map(set => set.name)).toEqual(['Renamed', 'Set set-b'])
  })

  it('removes a deleted reading set from the snapshot', async () => {
    const { api, service } = setup([readingSet('set-a'), readingSet('set-b')])
    await service.initialize()

    await service.deleteReadingSet('set-a')

    expect(api.deleteReadingSet).toHaveBeenCalledWith('set-a')
    expect(service.getSnapshot().readingSets.map(set => set.id)).toEqual(['set-b'])
  })

  it('updates membership from the authoritative add/remove responses', async () => {
    const { api, service } = setup()
    await service.initialize()
    const withPaper = readingSet('set-a', {
      papers: [{
        id: 'paper-1',
        filename: 'paper-1.tar.gz',
        arxiv_id: null,
        title: 'Paper One',
        has_html: true,
        has_knowledge_graph: false,
        added_at: '2026-08-29T00:01:00Z',
      }],
    })
    vi.mocked(api.addPaperToReadingSet).mockResolvedValue(withPaper)
    vi.mocked(api.removePaperFromReadingSet).mockResolvedValue(readingSet('set-a'))

    await service.addPaperToReadingSet('set-a', 'paper-1')
    expect(service.readingSetOf('set-a')?.papers.map(paper => paper.id)).toEqual(['paper-1'])

    await service.removePaperFromReadingSet('set-a', 'paper-1')
    expect(api.removePaperFromReadingSet).toHaveBeenCalledWith('set-a', 'paper-1')
    expect(service.readingSetOf('set-a')?.papers).toHaveLength(0)
  })

  it('surfaces mutation failures to the caller without corrupting the snapshot', async () => {
    const { api, service } = setup()
    await service.initialize()
    vi.mocked(api.createReadingSet).mockRejectedValueOnce(new Error('name taken'))

    await expect(service.createReadingSet('Duplicate')).rejects.toThrow('name taken')
    expect(service.getSnapshot().readingSets.map(set => set.id)).toEqual(['set-a'])
  })

  describe('link terms', () => {
    it('tracks SSE progress in the snapshot and resolves with the summary', async () => {
      const { api, service, watchers } = setup()
      const listener = vi.fn()
      service.subscribe(listener)

      const result = service.linkTerms('set-a')
      await Promise.resolve()
      expect(api.buildReadingSetAlignments).toHaveBeenCalledWith('set-a')
      await Promise.resolve()
      expect(service.isLinkingTerms('set-a')).toBe(true)
      expect(service.getSnapshot().alignmentBuilds['set-a']).toEqual({ stage: 'starting' })

      const watcher = watchers[0]
      watcher.emit({ type: 'connected' })
      watcher.emit({
        stage: 'linking',
        progress: { stage: 'blocking', label: 'Matching terms', current: 1, total: 2 },
      })
      expect(service.getSnapshot().alignmentBuilds['set-a']).toEqual({
        stage: 'linking',
        label: 'Matching terms',
        current: 1,
        total: 2,
      })

      watcher.emit({
        stage: 'complete',
        alignment_count: 3,
        deterministic_count: 2,
        llm_count: 1,
        stale_count: 0,
        skipped_papers: [{ paper_id: 'paper-3', filename: 'c.tar.gz', reason: 'no_knowledge_graph' }],
      })

      await expect(result).resolves.toEqual({
        stage: 'complete',
        alignmentCount: 3,
        deterministicCount: 2,
        llmCount: 1,
        staleCount: 0,
        skippedPapers: [{ paper_id: 'paper-3', filename: 'c.tar.gz', reason: 'no_knowledge_graph' }],
        error: undefined,
      })
      expect(service.isLinkingTerms('set-a')).toBe(false)
      expect(watcher.close).toHaveBeenCalled()
    })

    it('rejects a second link request while one is running', async () => {
      const { service, watchers } = setup()
      const first = service.linkTerms('set-a')
      await Promise.resolve()
      await Promise.resolve()

      await expect(service.linkTerms('set-a')).rejects.toThrow('already in progress')

      watchers[0].emit({ stage: 'cancelled' })
      await expect(first).resolves.toMatchObject({ stage: 'cancelled' })
    })

    it('clears the indicator and rejects when the progress stream drops', async () => {
      const { service, watchers } = setup()
      const result = service.linkTerms('set-a')
      await Promise.resolve()
      await Promise.resolve()

      watchers[0].fail()

      await expect(result).rejects.toThrow('Lost connection')
      expect(service.isLinkingTerms('set-a')).toBe(false)
      expect(watchers[0].close).toHaveBeenCalled()
    })

    it('requests cooperative cancellation through the API', async () => {
      const { api, service } = setup()
      await service.cancelLinkTerms('set-a')
      expect(api.cancelReadingSetAlignments).toHaveBeenCalledWith('set-a')
    })
  })

  describe('alignments cache', () => {
    it('loads and caches alignments per reading set', async () => {
      const { api, service } = setup()
      vi.mocked(api.listReadingSetAlignments).mockResolvedValue([alignment('al-1')])

      await service.loadAlignments('set-a')

      expect(service.alignmentsOf('set-a')?.map(item => item.id)).toEqual(['al-1'])
      expect(service.alignmentsOf('set-b')).toBeUndefined()
    })

    it('updates the cached row from confirm/reject responses', async () => {
      const { api, service } = setup()
      vi.mocked(api.listReadingSetAlignments).mockResolvedValue([alignment('al-1')])
      vi.mocked(api.confirmReadingSetAlignment)
        .mockResolvedValue(alignment('al-1', { status: 'confirmed' }))
      vi.mocked(api.rejectReadingSetAlignment)
        .mockResolvedValue(alignment('al-1', { status: 'rejected' }))
      await service.loadAlignments('set-a')

      await service.confirmAlignment('set-a', 'al-1')
      expect(service.alignmentsOf('set-a')?.[0].status).toBe('confirmed')

      await service.rejectAlignment('set-a', 'al-1')
      expect(service.alignmentsOf('set-a')?.[0].status).toBe('rejected')
    })

    it('reloads the cache when a build completes', async () => {
      const { api, service, watchers } = setup()
      vi.mocked(api.listReadingSetAlignments).mockResolvedValueOnce([alignment('al-1')])
      await service.loadAlignments('set-a')
      vi.mocked(api.listReadingSetAlignments).mockResolvedValueOnce([alignment('al-2')])

      const result = service.linkTerms('set-a')
      await Promise.resolve()
      await Promise.resolve()
      watchers[0].emit({ stage: 'complete', alignment_count: 1 })
      await result

      await vi.waitFor(() => {
        expect(service.alignmentsOf('set-a')?.map(item => item.id)).toEqual(['al-2'])
      })
      expect(api.listReadingSetAlignments).toHaveBeenCalledTimes(2)
    })

    it('counts pending links only when alignments are cached', async () => {
      const { api, service } = setup()
      expect(service.pendingAlignmentCountOf('set-a')).toBeUndefined()

      vi.mocked(api.listReadingSetAlignments).mockResolvedValue([
        alignment('al-1'),
        alignment('al-2', { status: 'confirmed' }),
        alignment('al-3', { status: 'rejected' }),
      ])
      await service.loadAlignments('set-a')

      expect(service.pendingAlignmentCountOf('set-a')).toBe(1)
    })

    it('applies bulk review results to the cached rows', async () => {
      const { api, service } = setup()
      vi.mocked(api.listReadingSetAlignments).mockResolvedValue([
        alignment('al-1'),
        alignment('al-2', { status: 'confirmed' }),
        alignment('al-3'),
      ])
      vi.mocked(api.bulkReviewReadingSetAlignments).mockResolvedValue({
        updated_count: 2,
        alignments: [
          alignment('al-1', { status: 'confirmed' }),
          alignment('al-3', { status: 'confirmed' }),
        ],
      })
      await service.loadAlignments('set-a')

      const result = await service.bulkReviewAlignments('set-a', 'confirm', { subjectId: 'subject-1' })

      expect(api.bulkReviewReadingSetAlignments)
        .toHaveBeenCalledWith('set-a', 'confirm', { subjectId: 'subject-1' })
      expect(result.updated_count).toBe(2)
      expect(service.alignmentsOf('set-a')?.map(item => item.status))
        .toEqual(['confirmed', 'confirmed', 'confirmed'])
      expect(service.pendingAlignmentCountOf('set-a')).toBe(0)
    })
  })
})
