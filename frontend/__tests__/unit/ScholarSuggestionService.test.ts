import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ApplyTooltipSuggestionsRequest,
  ApplyTooltipSuggestionsResponse,
  CreateManualTooltipSuggestionRequest,
  DeleteTooltipSuggestionResponse,
  GenerateTooltipSuggestionsRequest,
  GenerateTooltipSuggestionsResponse,
  TooltipSuggestion,
  TooltipSuggestionApi,
} from '@/lib/reader-workspace-api'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import { ScholarSuggestionService } from '@/theia/scholar-extension/src/browser/scholar-suggestion-service'
import type { ScholarWorkspaceService } from '@/theia/scholar-extension/src/browser/scholar-workspace-service'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function suggestion(
  id: string,
  isAiGenerated: boolean,
  overrides: Partial<TooltipSuggestion> = {},
): TooltipSuggestion {
  return {
    id,
    paper_id: 'paper-a',
    entity_id: isAiGenerated ? `entity-${id}` : `manual-${id}`,
    entity_label: id,
    entity_type: 'definition',
    tooltip_content: `Content for ${id}`,
    is_ai_generated: isAiGenerated,
    created_at: '2026-07-17T00:00:00Z',
    ...overrides,
  }
}

function emptyWorkspaceSnapshot(): ReaderWorkspaceSnapshot {
  return {
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
  }
}

class FakeWorkspace {
  private snapshot = emptyWorkspaceSnapshot()
  private readonly listeners = new Set<() => void>()
  readonly refreshPaper = vi.fn().mockResolvedValue({})
  readonly refreshTooltips = vi.fn().mockResolvedValue([])
  readonly operationFinishes: Array<ReturnType<typeof vi.fn>> = []
  readonly startPaperOperation = vi.fn((paperId: string, status: string): (() => void) => {
    this.snapshot = {
      ...this.snapshot,
      statusByPaperId: { ...this.snapshot.statusByPaperId, [paperId]: status },
    }
    this.listeners.forEach(listener => listener())
    const finish = vi.fn(() => {
      if (this.snapshot.statusByPaperId[paperId] !== status) {
        return
      }
      const statusByPaperId = { ...this.snapshot.statusByPaperId }
      delete statusByPaperId[paperId]
      this.snapshot = { ...this.snapshot, statusByPaperId }
      this.listeners.forEach(listener => listener())
    })
    this.operationFinishes.push(finish)
    return finish
  })

  getSnapshot = (): ReaderWorkspaceSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  activate(paperId: string | null): void {
    this.snapshot = { ...this.snapshot, activePaperId: paperId }
    this.listeners.forEach(listener => listener())
  }
}

function createApi() {
  return {
    listTooltipSuggestions: vi.fn<(paperId: string) => Promise<TooltipSuggestion[]>>(),
    generateTooltipSuggestions: vi.fn<(
      paperId: string,
      request: GenerateTooltipSuggestionsRequest,
    ) => Promise<GenerateTooltipSuggestionsResponse>>(),
    createManualTooltipSuggestion: vi.fn<(
      paperId: string,
      request: CreateManualTooltipSuggestionRequest,
    ) => Promise<TooltipSuggestion>>(),
    deleteTooltipSuggestion: vi.fn<(
      paperId: string,
      suggestionId: string,
    ) => Promise<DeleteTooltipSuggestionResponse>>(),
    applyTooltipSuggestions: vi.fn<(
      paperId: string,
      request: ApplyTooltipSuggestionsRequest,
    ) => Promise<ApplyTooltipSuggestionsResponse>>(),
  } satisfies TooltipSuggestionApi
}

describe('ScholarSuggestionService', () => {
  let workspace: FakeWorkspace
  let api: ReturnType<typeof createApi>
  let service: ScholarSuggestionService

  beforeEach(() => {
    workspace = new FakeWorkspace()
    api = createApi()
    service = new ScholarSuggestionService(
      api,
      workspace as unknown as ScholarWorkspaceService,
    )
  })

  it('loads the active paper automatically and checks only manual suggestions initially', async () => {
    const response = deferred<TooltipSuggestion[]>()
    api.listTooltipSuggestions.mockReturnValueOnce(response.promise)
    const changes = vi.fn()
    const unsubscribe = service.subscribe(changes)

    workspace.activate('paper-a')

    expect(api.listTooltipSuggestions).toHaveBeenCalledWith('paper-a')
    expect(service.getSnapshot().activePaperId).toBe('paper-a')
    expect(service.getPaperState('paper-a').loading).toBe(true)

    response.resolve([
      suggestion('manual-1', false),
      suggestion('ai-1', true),
      suggestion('manual-2', false),
    ])
    await response.promise
    await Promise.resolve()

    const state = service.getPaperState('paper-a')
    expect(state.loading).toBe(false)
    expect(state.loaded).toBe(true)
    expect([...state.checkedIds]).toEqual(['manual-1', 'manual-2'])
    expect(state.error).toBeNull()
    expect(changes).toHaveBeenCalled()
    unsubscribe()
  })

  it('derives tri-state selection and toggles leaves or complete groups immutably', async () => {
    api.listTooltipSuggestions.mockResolvedValueOnce([
      suggestion('manual-1', false),
      suggestion('manual-2', false),
      suggestion('ai-1', true),
    ])
    await service.loadSuggestions('paper-a')
    const originalSnapshot = service.getSnapshot()
    const originalChecked = service.getPaperState('paper-a').checkedIds

    expect(service.getCheckState('paper-a', ['manual-1', 'manual-2'])).toBe('checked')
    expect(service.getCheckState('paper-a', ['manual-1', 'ai-1'])).toBe('indeterminate')
    expect(service.getCheckState('paper-a', ['ai-1'])).toBe('unchecked')

    service.toggleSuggestions('paper-a', ['manual-1'])
    expect(service.getCheckState('paper-a', ['manual-1', 'manual-2'])).toBe('indeterminate')
    service.toggleSuggestions('paper-a', ['manual-1', 'manual-2'])
    expect(service.getCheckState('paper-a', ['manual-1', 'manual-2'])).toBe('checked')
    service.toggleSuggestions('paper-a', ['manual-1', 'manual-2'])
    expect(service.getCheckState('paper-a', ['manual-1', 'manual-2'])).toBe('unchecked')

    expect(service.getSnapshot()).not.toBe(originalSnapshot)
    expect(service.getPaperState('paper-a').checkedIds).not.toBe(originalChecked)
  })

  it('keeps focus, transient edits, and create drafts isolated per paper', async () => {
    api.listTooltipSuggestions
      .mockResolvedValueOnce([suggestion('a-1', false, { paper_id: 'paper-a' })])
      .mockResolvedValueOnce([suggestion('b-1', false, { paper_id: 'paper-b' })])
    await service.loadSuggestions('paper-a')
    await service.loadSuggestions('paper-b')

    service.focusSuggestion('paper-a', 'a-1')
    service.editSuggestion('paper-a', 'a-1', 'Edited A')
    service.updateCreateDraft('paper-a', {
      entityLabel: 'Manual A',
      entityType: 'theorem',
      tooltipContent: 'Draft A',
    })
    service.focusSuggestion('paper-b', 'b-1')

    const paperA = service.getPaperState('paper-a')
    const paperB = service.getPaperState('paper-b')
    expect(paperA.focusedId).toBe('a-1')
    expect(paperA.editedContent.get('a-1')).toBe('Edited A')
    expect(paperA.createDraft).toEqual({
      entityLabel: 'Manual A',
      entityType: 'theorem',
      tooltipContent: 'Draft A',
    })
    expect(paperB.focusedId).toBe('b-1')
    expect(paperB.editedContent.size).toBe(0)
    expect(paperB.createDraft.tooltipContent).toBe('')
  })

  it('leaves manual-create mode when an existing suggestion receives focus', async () => {
    api.listTooltipSuggestions.mockResolvedValueOnce([suggestion('manual-1', false)])
    await service.loadSuggestions('paper-a')
    service.startManualCreation('paper-a')

    service.focusSuggestion('paper-a', 'manual-1')

    const state = service.getPaperState('paper-a')
    expect(state.focusedId).toBe('manual-1')
    expect(state.createMode).toBe(false)
  })

  it('ignores an older response for the same paper', async () => {
    const first = deferred<TooltipSuggestion[]>()
    const second = deferred<TooltipSuggestion[]>()
    api.listTooltipSuggestions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstLoad = service.loadSuggestions('paper-a')
    const secondLoad = service.loadSuggestions('paper-a')
    second.resolve([suggestion('new', true)])
    await secondLoad
    first.resolve([suggestion('stale', false)])
    await firstLoad

    expect(service.getPaperState('paper-a').suggestions.map(item => item.id)).toEqual(['new'])
    expect([...service.getPaperState('paper-a').checkedIds]).toEqual([])
  })

  it('does not let a late response from the previous active paper replace the new paper state', async () => {
    const paperA = deferred<TooltipSuggestion[]>()
    const paperB = deferred<TooltipSuggestion[]>()
    api.listTooltipSuggestions
      .mockReturnValueOnce(paperA.promise)
      .mockReturnValueOnce(paperB.promise)

    workspace.activate('paper-a')
    workspace.activate('paper-b')
    paperB.resolve([suggestion('b-1', false, { paper_id: 'paper-b' })])
    await paperB.promise
    await Promise.resolve()
    paperA.resolve([suggestion('a-1', false, { paper_id: 'paper-a' })])
    await paperA.promise
    await Promise.resolve()

    expect(service.getSnapshot().activePaperId).toBe('paper-b')
    expect(service.getPaperState('paper-b').suggestions[0].id).toBe('b-1')
    expect(service.getPaperState('paper-a').suggestions[0].id).toBe('a-1')
  })

  it('reports the latest load error without discarding previously loaded state', async () => {
    api.listTooltipSuggestions
      .mockResolvedValueOnce([suggestion('manual-1', false)])
      .mockRejectedValueOnce(new Error('Backend unavailable'))
    await service.loadSuggestions('paper-a')

    await expect(service.loadSuggestions('paper-a')).rejects.toThrow('Backend unavailable')

    const state = service.getPaperState('paper-a')
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Backend unavailable')
    expect(state.suggestions.map(item => item.id)).toEqual(['manual-1'])
    expect(state.pending).toBe(false)
  })

  it('preserves valid checked/focused/edit state across reload and drops removed ids', async () => {
    api.listTooltipSuggestions
      .mockResolvedValueOnce([
        suggestion('keep', false),
        suggestion('remove', false),
      ])
      .mockResolvedValueOnce([
        suggestion('keep', false, { tooltip_content: 'Fresh content' }),
        suggestion('new-manual', false),
      ])
    await service.loadSuggestions('paper-a')
    service.focusSuggestion('paper-a', 'remove')
    service.editSuggestion('paper-a', 'keep', 'Transient edit')
    service.editSuggestion('paper-a', 'remove', 'Removed edit')

    await service.loadSuggestions('paper-a')

    const state = service.getPaperState('paper-a')
    expect([...state.checkedIds]).toEqual(['keep'])
    expect(state.focusedId).toBeNull()
    expect([...state.editedContent.entries()]).toEqual([['keep', 'Transient edit']])
  })

  it('generates AI suggestions with trimmed expertise and reloads the owning paper', async () => {
    api.listTooltipSuggestions
      .mockResolvedValueOnce([suggestion('manual-1', false)])
      .mockResolvedValueOnce([
        suggestion('manual-1', false),
        suggestion('ai-new', true),
      ])
    api.generateTooltipSuggestions.mockResolvedValueOnce({
      suggestions: [],
      total_entities: 5,
      suggested_count: 1,
    })
    await service.loadSuggestions('paper-a')

    const resultPromise = service.generateSuggestions('paper-a', '  Topology researcher  ')
    expect(service.getPaperState('paper-a').pending).toBe(true)
    expect(workspace.startPaperOperation).toHaveBeenCalledWith(
      'paper-a',
      'Generating tooltip drafts…',
    )
    expect(workspace.getSnapshot().statusByPaperId['paper-a'])
      .toBe('Generating tooltip drafts…')
    await expect(resultPromise).resolves.toMatchObject({ suggested_count: 1 })

    expect(api.generateTooltipSuggestions).toHaveBeenCalledWith('paper-a', {
      user_expertise: 'Topology researcher',
      entity_types: null,
    })
    expect(api.listTooltipSuggestions).toHaveBeenCalledTimes(2)
    expect(service.getPaperState('paper-a').suggestions.map(item => item.id))
      .toEqual(['manual-1', 'ai-new'])
    expect(service.getPaperState('paper-a').pending).toBe(false)
    expect(workspace.operationFinishes[0]).toHaveBeenCalledOnce()
    expect(workspace.getSnapshot().statusByPaperId['paper-a']).toBeUndefined()
  })

  it('clears the Generate operation status when the request fails', async () => {
    api.generateTooltipSuggestions.mockRejectedValueOnce(new Error('Generation failed'))

    const resultPromise = service.generateSuggestions('paper-a', 'Researcher')
    const rejection = expect(resultPromise).rejects.toThrow('Generation failed')
    expect(workspace.getSnapshot().statusByPaperId['paper-a'])
      .toBe('Generating tooltip drafts…')
    await rejection

    expect(workspace.operationFinishes[0]).toHaveBeenCalledOnce()
    expect(workspace.getSnapshot().statusByPaperId['paper-a']).toBeUndefined()
    expect(service.getPaperState('paper-a').error).toBe('Generation failed')
  })

  it('validates and immediately persists a manual suggestion as focused and checked', async () => {
    service.startManualCreation('paper-a')
    service.updateCreateDraft('paper-a', {
      entityLabel: '   ',
      entityType: 'definition',
      tooltipContent: 'Explanation',
    })
    await expect(service.createManualSuggestion('paper-a')).rejects.toThrow('required')
    expect(api.createManualTooltipSuggestion).not.toHaveBeenCalled()

    service.updateCreateDraft('paper-a', {
      entityLabel: '  Manual label  ',
      entityType: '  theorem  ',
      tooltipContent: '  Manual content  ',
    })
    const created = suggestion('created', false, {
      entity_label: 'Manual label',
      entity_type: 'theorem',
      tooltip_content: 'Manual content',
    })
    api.createManualTooltipSuggestion.mockResolvedValueOnce(created)

    await expect(service.createManualSuggestion('paper-a')).resolves.toEqual(created)

    expect(api.createManualTooltipSuggestion).toHaveBeenCalledWith('paper-a', {
      entity_label: 'Manual label',
      entity_type: 'theorem',
      tooltip_content: 'Manual content',
    })
    const state = service.getPaperState('paper-a')
    expect(state.suggestions).toEqual([created])
    expect([...state.checkedIds]).toEqual(['created'])
    expect(state.focusedId).toBe('created')
    expect(state.createMode).toBe(false)
    expect(state.createDraft).toEqual({
      entityLabel: '',
      entityType: 'other',
      tooltipContent: '',
    })
  })

  it('deletes a suggestion immediately and clears its checked, focused, and edited state', async () => {
    api.listTooltipSuggestions.mockResolvedValueOnce([suggestion('remove', false)])
    api.deleteTooltipSuggestion.mockResolvedValueOnce({ status: 'success' })
    await service.loadSuggestions('paper-a')
    service.focusSuggestion('paper-a', 'remove')
    service.editSuggestion('paper-a', 'remove', 'Edited')

    await service.deleteSuggestion('paper-a', 'remove')

    expect(api.deleteTooltipSuggestion).toHaveBeenCalledWith('paper-a', 'remove')
    const state = service.getPaperState('paper-a')
    expect(state.suggestions).toEqual([])
    expect(state.checkedIds.size).toBe(0)
    expect(state.focusedId).toBeNull()
    expect(state.editedContent.size).toBe(0)
  })

  it('applies only checked suggestions with transient edits and refreshes paper and tooltips', async () => {
    api.listTooltipSuggestions.mockResolvedValueOnce([
      suggestion('manual', false, { entity_id: null }),
      suggestion('ai', true, { entity_id: 'entity-ai' }),
      suggestion('ignored', true, { entity_id: 'entity-ignored' }),
    ])
    api.applyTooltipSuggestions.mockResolvedValueOnce({
      success: true,
      spans_injected: 3,
      tooltips_created: 2,
      errors: ['One occurrence was skipped'],
    })
    await service.loadSuggestions('paper-a')
    service.toggleSuggestions('paper-a', ['ai'])
    service.editSuggestion('paper-a', 'ai', 'Edited AI content')

    const resultPromise = service.applySuggestions('paper-a')
    expect(service.getPaperState('paper-a').pending).toBe(true)
    expect(workspace.startPaperOperation).toHaveBeenCalledWith(
      'paper-a',
      'Applying tooltip drafts…',
    )
    expect(workspace.getSnapshot().statusByPaperId['paper-a'])
      .toBe('Applying tooltip drafts…')
    await expect(resultPromise).resolves.toMatchObject({ tooltips_created: 2 })

    expect(api.applyTooltipSuggestions).toHaveBeenCalledWith('paper-a', {
      suggestions: [
        {
          entity_id: 'manual_manual',
          entity_label: 'manual',
          entity_type: 'definition',
          tooltip_content: 'Content for manual',
          occurrences: [],
        },
        {
          entity_id: 'entity-ai',
          entity_label: 'ai',
          entity_type: 'definition',
          tooltip_content: 'Edited AI content',
          occurrences: [],
        },
      ],
    })
    expect(workspace.refreshPaper).toHaveBeenCalledWith('paper-a')
    expect(workspace.refreshTooltips).toHaveBeenCalledWith('paper-a')
    expect(service.getPaperState('paper-a').pending).toBe(false)
    expect(workspace.operationFinishes[0]).toHaveBeenCalledOnce()
    expect(workspace.getSnapshot().statusByPaperId['paper-a']).toBeUndefined()
  })

  it('streams real apply progress into the paper status and closes the stream', async () => {
    let publishProgress: ((progress: { stage: string; current: number; total: number }) => void) | undefined
    const stopWatching = vi.fn()
    const watchApplyProgress = vi.fn((_paperId, onProgress) => {
      publishProgress = onProgress
      return stopWatching
    })
    Object.assign(api, { watchApplyProgress })
    api.listTooltipSuggestions.mockResolvedValueOnce([suggestion('manual', false)])
    const response = deferred<ApplyTooltipSuggestionsResponse>()
    api.applyTooltipSuggestions.mockReturnValueOnce(response.promise)
    await service.loadSuggestions('paper-a')

    const applying = service.applySuggestions('paper-a')
    expect(watchApplyProgress).toHaveBeenCalledWith('paper-a', expect.any(Function), expect.any(Function))

    publishProgress?.({ stage: 'applying', current: 3, total: 8 })
    expect(workspace.getSnapshot().statusByPaperId['paper-a'])
      .toBe('Applying tooltip drafts… 3/8')

    response.resolve({ success: true, spans_injected: 1, tooltips_created: 1, errors: [] })
    await applying
    expect(stopWatching).toHaveBeenCalledOnce()
  })

  it('rejects conflicting mutations while one is pending and exposes the failure', async () => {
    const generation = deferred<GenerateTooltipSuggestionsResponse>()
    api.generateTooltipSuggestions.mockReturnValueOnce(generation.promise)

    const pending = service.generateSuggestions('paper-a', 'Researcher')
    await expect(service.deleteSuggestion('paper-a', 'missing')).rejects.toThrow('in progress')
    generation.reject(new Error('LLM unavailable'))
    await expect(pending).rejects.toThrow('LLM unavailable')

    const state = service.getPaperState('paper-a')
    expect(state.pending).toBe(false)
    expect(state.error).toBe('LLM unavailable')
  })
})