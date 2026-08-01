import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ReaderWorkspaceStore,
  type KnowledgeGraphProgress,
  type ReaderWorkspaceApi,
} from '@/lib/reader-workspace-store'
import type { Paper, PaperDetail } from '@/hooks/usePapers'
import type { Tooltip } from '@/hooks/useTooltips'

const paperSummary = (id: string): Paper => ({
  id,
  filename: `${id}.tar.gz`,
  arxiv_id: null,
  uploaded_at: '2026-07-15T00:00:00Z',
  compiled_at: '2026-07-15T00:01:00Z',
  has_html: true,
})

const paperDetail = (id: string): PaperDetail => ({
  ...paperSummary(id),
  html_content: `<article data-id="${id}">${id}</article>`,
  sections: [],
  equations: [],
  citations: [],
  paper_metadata: { title: id },
  has_knowledge_graph: false,
})

const tooltip = (paperId: string, entityId: string): Tooltip => ({
  id: `${paperId}-${entityId}`,
  paper_id: paperId,
  dom_node_id: null,
  entity_id: entityId,
  user_id: 'test-user',
  content: entityId,
  is_pinned: false,
  created_at: '2026-07-15T00:00:00Z',
  updated_at: '2026-07-15T00:00:00Z',
})

describe('ReaderWorkspaceStore', () => {
  let api: ReaderWorkspaceApi

  beforeEach(() => {
    api = {
      listPapers: vi.fn().mockResolvedValue([paperSummary('paper-a'), paperSummary('paper-b')]),
      getPaper: vi.fn((paperId: string) => Promise.resolve(paperDetail(paperId))),
      listTooltips: vi.fn((paperId: string) => Promise.resolve([tooltip(paperId, `${paperId}-entity`)])),
    }
  })

  it('loads the library and exposes loading completion to subscribers', async () => {
    const store = new ReaderWorkspaceStore(api)
    const snapshots = [store.getSnapshot()]
    const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()))

    await store.loadLibrary()
    unsubscribe()

    expect(store.getSnapshot().papers.map(paper => paper.id)).toEqual(['paper-a', 'paper-b'])
    expect(store.getSnapshot().libraryLoading).toBe(false)
    expect(snapshots.some(snapshot => snapshot.libraryLoading)).toBe(true)
  })

  it('deduplicates concurrent loads and reuses a loaded paper on reactivation', async () => {
    const store = new ReaderWorkspaceStore(api)

    await Promise.all([
      store.openPaper('paper-a'),
      store.openPaper('paper-a'),
    ])
    store.activatePaper('paper-a')
    await store.openPaper('paper-a')

    expect(api.getPaper).toHaveBeenCalledTimes(1)
    expect(api.listTooltips).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().activePaperId).toBe('paper-a')
  })

  it('keeps paper and active-entity state isolated across two open tabs', async () => {
    const store = new ReaderWorkspaceStore(api)

    await store.openPaper('paper-a')
    store.setActiveEntity('paper-a', 'entity-a')
    await store.openPaper('paper-b')
    store.setActiveEntity('paper-b', 'entity-b')

    const snapshot = store.getSnapshot()
    expect(snapshot.openPaperIds).toEqual(['paper-a', 'paper-b'])
    expect(snapshot.papersById['paper-a']?.paper_metadata?.title).toBe('paper-a')
    expect(snapshot.papersById['paper-b']?.paper_metadata?.title).toBe('paper-b')
    expect(snapshot.activeEntityByPaperId).toEqual({
      'paper-a': 'entity-a',
      'paper-b': 'entity-b',
    })
  })

  it('refreshes an inactive paper without switching the active tab', async () => {
    const store = new ReaderWorkspaceStore(api)
    await store.openPaper('paper-a')
    await store.openPaper('paper-b')

    await store.refreshPaper('paper-a')

    expect(store.getSnapshot().activePaperId).toBe('paper-b')
    expect(api.getPaper).toHaveBeenCalledTimes(3)
  })

  it('scopes paper-operation statuses and ignores stale finish callbacks', () => {
    const store = new ReaderWorkspaceStore(api)
    const finishGeneration = store.startPaperOperation('paper-a', 'Generating tooltip drafts…')
    const finishOtherPaper = store.startPaperOperation('paper-b', 'Applying tooltip drafts…')
    const finishApply = store.startPaperOperation('paper-a', 'Applying tooltip drafts…')

    expect(store.getSnapshot().statusByPaperId).toEqual({
      'paper-a': 'Applying tooltip drafts…',
      'paper-b': 'Applying tooltip drafts…',
    })

    finishGeneration()
    expect(store.getSnapshot().statusByPaperId['paper-a']).toBe('Applying tooltip drafts…')
    finishOtherPaper()
    expect(store.getSnapshot().statusByPaperId['paper-b']).toBeUndefined()
    finishApply()
    finishApply()
    expect(store.getSnapshot().statusByPaperId['paper-a']).toBeUndefined()
  })

  it('publishes created and updated annotations to every subscriber', async () => {
    const created = tooltip('paper-a', 'entity-a')
    api.createTooltip = vi.fn().mockResolvedValue(created)
    api.updateTooltip = vi.fn().mockResolvedValue({
      ...created,
      content: 'Updated explanation',
      is_pinned: true,
    })
    const store = new ReaderWorkspaceStore(api)
    await store.openPaper('paper-a')

    await store.createTooltip('paper-a', 'node-a', 'Initial explanation')
    await store.updateTooltip('paper-a', created.id, {
      content: 'Updated explanation',
      isPinned: true,
    })

    expect(store.getSnapshot().tooltipsByPaperId['paper-a']).toContainEqual(
      expect.objectContaining({
        id: created.id,
        content: 'Updated explanation',
        is_pinned: true,
      }),
    )
  })

  it('streams knowledge-graph progress and refreshes the finished paper', async () => {
    let publishProgress: ((progress: KnowledgeGraphProgress) => void) | undefined
    const stopWatching = vi.fn()
    api.buildKnowledgeGraph = vi.fn().mockResolvedValue({ status: 'started' })
    api.watchKnowledgeGraph = vi.fn((_paperId, onProgress) => {
      publishProgress = onProgress
      return stopWatching
    })
    const store = new ReaderWorkspaceStore(api)
    await store.openPaper('paper-a')

    await store.buildKnowledgeGraph('paper-a')
    publishProgress?.({
      stage: 'extracting',
      progress: {
        stage: 'semantic_extraction',
        label: 'Semantic extraction',
        current: 2,
        total: 4,
      },
    })

    expect(store.getSnapshot().statusByPaperId['paper-a'])
      .toBe('Semantic extraction: 2/4 (50%)')
    expect(store.getSnapshot().knowledgeGraphProgressByPaperId['paper-a'])
      .toEqual(expect.objectContaining({ stage: 'extracting' }))

    publishProgress?.({
      stage: 'complete',
      progress: {},
      node_count: 7,
      edge_count: 5,
    })

    expect(stopWatching).toHaveBeenCalledOnce()
    expect(store.getSnapshot().statusByPaperId['paper-a'])
      .toBe('Knowledge graph ready: 7 nodes, 5 edges')
    await vi.waitFor(() => expect(api.getPaper).toHaveBeenCalledTimes(2))

    publishProgress?.({ stage: 'error', progress: {}, error: 'Late stream error' })
    expect(store.getSnapshot().paperErrors['paper-a']).toBeUndefined()
  })

  it('caches section annotations and equation details per paper', async () => {
    const annotations = { schema_version: '3.0', section_id: 'sec-1', items: [], total: 0, offset: 0, limit: 100 }
    const equation = {
      schema_version: '3.0',
      equation: {
        stable_id: 'equation:1', equation_id: 'eq-1', latex: 'x=1', summary: 'Defines x.',
        notation_ids: [], object_ids: [], evidence_ids: ['obs-1'],
      },
      notation: [], objects: [], evidence: [],
    }
    api.getSectionAnnotations = vi.fn().mockResolvedValue(annotations)
    api.getEquationDetails = vi.fn().mockResolvedValue(equation)
    const store = new ReaderWorkspaceStore(api)

    await store.loadSectionAnnotations('paper-a', 'sec-1')
    await store.loadSectionAnnotations('paper-a', 'sec-1')
    await store.loadEquationDetails('paper-a', 'eq-1')
    await store.loadEquationDetails('paper-a', 'eq-1')

    expect(api.getSectionAnnotations).toHaveBeenCalledOnce()
    expect(api.getEquationDetails).toHaveBeenCalledOnce()
    expect(store.getSnapshot().sectionAnnotationsByPaperId['paper-a']['sec-1']).toBe(annotations)
    expect(store.getSnapshot().equationDetailsByPaperId['paper-a']['eq-1']).toBe(equation)
  })

  it('clears a terminal knowledge-graph status so paper actions become available again', async () => {
    vi.useFakeTimers()
    try {
      let publishProgress: ((progress: KnowledgeGraphProgress) => void) | undefined
      api.buildKnowledgeGraph = vi.fn().mockResolvedValue({ status: 'started' })
      api.watchKnowledgeGraph = vi.fn((_paperId, onProgress) => {
        publishProgress = onProgress
        return vi.fn()
      })
      const store = new ReaderWorkspaceStore(api)

      await store.buildKnowledgeGraph('paper-a')
      publishProgress?.({ stage: 'complete', progress: {}, node_count: 1, edge_count: 0 })
      expect(store.getSnapshot().statusByPaperId['paper-a']).toContain('ready')

      await vi.advanceTimersByTimeAsync(4000)
      expect(store.getSnapshot().statusByPaperId['paper-a']).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('records a background knowledge-graph failure and closes its stream', async () => {
    let publishProgress: ((progress: KnowledgeGraphProgress) => void) | undefined
    const stopWatching = vi.fn()
    api.buildKnowledgeGraph = vi.fn().mockResolvedValue({ status: 'started' })
    api.watchKnowledgeGraph = vi.fn((_paperId, onProgress) => {
      publishProgress = onProgress
      return stopWatching
    })
    const store = new ReaderWorkspaceStore(api)

    await store.buildKnowledgeGraph('paper-a')
    publishProgress?.({ stage: 'error', progress: {}, error: 'Extraction failed' })

    expect(stopWatching).toHaveBeenCalledOnce()
    expect(store.getSnapshot().paperErrors['paper-a']).toBe('Extraction failed')
    expect(store.getSnapshot().statusByPaperId['paper-a']).toBeUndefined()
  })

  it('records a cancelled knowledge-graph build and immediately clears status so a restart is available', async () => {
    let publishProgress: ((progress: KnowledgeGraphProgress) => void) | undefined
    const stopWatching = vi.fn()
    api.buildKnowledgeGraph = vi.fn().mockResolvedValue({ status: 'started' })
    api.watchKnowledgeGraph = vi.fn((_paperId, onProgress) => {
      publishProgress = onProgress
      return stopWatching
    })
    const store = new ReaderWorkspaceStore(api)

    await store.buildKnowledgeGraph('paper-a')
    publishProgress?.({ stage: 'extracting', progress: { symbols: { current: 1, total: 4 } } })
    publishProgress?.({ stage: 'cancelled', progress: {} })

    // The "cancelled" stage must stop the stream and clear the status
    // *immediately* (not after the usual multi-second delay used for a
    // successful "complete"), so the Build/Stop commands re-enable right
    // away and the user can restart the build without waiting.
    expect(stopWatching).toHaveBeenCalledOnce()
    expect(store.getSnapshot().statusByPaperId['paper-a']).toBeUndefined()
    expect(store.getSnapshot().paperErrors['paper-a']).toBeUndefined()
  })

  it('sends a cancel request for a running knowledge-graph build', async () => {
    api.cancelKnowledgeGraph = vi.fn().mockResolvedValue({ status: 'cancelling' })
    const store = new ReaderWorkspaceStore(api)

    await store.cancelKnowledgeGraph('paper-a')

    expect(api.cancelKnowledgeGraph).toHaveBeenCalledWith('paper-a')
  })

  it('surfaces an error when cancelling a knowledge-graph build fails', async () => {
    api.cancelKnowledgeGraph = vi.fn().mockRejectedValue(new Error('No build in progress'))
    const store = new ReaderWorkspaceStore(api)

    await expect(store.cancelKnowledgeGraph('paper-a')).rejects.toThrow('No build in progress')
    expect(store.getSnapshot().paperErrors['paper-a']).toBe('No build in progress')
  })

  it('reports a lost knowledge-graph progress connection', async () => {
    let reportConnectionError: (() => void) | undefined
    const stopWatching = vi.fn()
    api.buildKnowledgeGraph = vi.fn().mockResolvedValue({ status: 'started' })
    api.watchKnowledgeGraph = vi.fn((_paperId, _onProgress, onConnectionError) => {
      reportConnectionError = onConnectionError
      return stopWatching
    })
    const store = new ReaderWorkspaceStore(api)

    await store.buildKnowledgeGraph('paper-a')
    reportConnectionError?.()

    expect(stopWatching).toHaveBeenCalledOnce()
    expect(store.getSnapshot().paperErrors['paper-a'])
      .toBe('Lost connection to knowledge graph progress stream')
  })

  it('rejects an empty id without calling the API and records load failures', async () => {
    const store = new ReaderWorkspaceStore(api)

    await expect(store.openPaper('')).rejects.toThrow('Paper id is required')
    expect(api.getPaper).not.toHaveBeenCalled()

    vi.mocked(api.getPaper).mockRejectedValueOnce(new Error('Backend unavailable'))
    await expect(store.openPaper('paper-a')).rejects.toThrow('Backend unavailable')

    expect(store.getSnapshot().paperErrors['paper-a']).toBe('Backend unavailable')
    expect(store.getSnapshot().loadingPaperIds).not.toContain('paper-a')
  })
})