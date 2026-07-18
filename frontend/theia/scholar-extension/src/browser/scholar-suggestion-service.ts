import { Emitter, Event } from '@theia/core'
import { inject, injectable } from '@theia/core/shared/inversify'

import {
  HttpReaderWorkspaceApi,
  type ApplyTooltipSuggestionsResponse,
  type GenerateTooltipSuggestionsResponse,
  type TooltipSuggestion,
  type TooltipSuggestionApi,
} from '../../../../lib/reader-workspace-api'
import { ScholarWorkspaceService } from './scholar-workspace-service'

const GENERATING_TOOLTIP_DRAFTS_STATUS = 'Generating tooltip drafts…'
const APPLYING_TOOLTIP_DRAFTS_STATUS = 'Applying tooltip drafts…'

export type SuggestionCheckState = 'checked' | 'unchecked' | 'indeterminate'

export interface ScholarSuggestionCreateDraft {
  entityLabel: string
  entityType: string
  tooltipContent: string
}

export interface ScholarSuggestionPaperState {
  readonly suggestions: readonly TooltipSuggestion[]
  readonly loading: boolean
  readonly loaded: boolean
  readonly pending: boolean
  readonly error: string | null
  readonly checkedIds: ReadonlySet<string>
  readonly focusedId: string | null
  readonly editedContent: ReadonlyMap<string, string>
  readonly createMode: boolean
  readonly createDraft: Readonly<ScholarSuggestionCreateDraft>
}

export interface ScholarSuggestionSnapshot {
  readonly activePaperId: string | null
  readonly papers: Readonly<Record<string, ScholarSuggestionPaperState>>
}

type Listener = () => void

function createPaperState(): ScholarSuggestionPaperState {
  return {
    suggestions: [],
    loading: false,
    loaded: false,
    pending: false,
    error: null,
    checkedIds: new Set(),
    focusedId: null,
    editedContent: new Map(),
    createMode: false,
    createDraft: {
      entityLabel: '',
      entityType: 'other',
      tooltipContent: '',
    },
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object' && 'detail' in error) {
    return String(error.detail)
  }
  return 'Unknown error'
}

@injectable()
export class ScholarSuggestionService {
  private readonly changeEmitter = new Emitter<void>()
  private readonly requestTokens = new Map<string, number>()
  private nextRequestToken = 0
  private snapshot: ScholarSuggestionSnapshot = {
    activePaperId: null,
    papers: {},
  }

  readonly onDidChange: Event<void> = this.changeEmitter.event

  constructor(
    @inject(HttpReaderWorkspaceApi) private readonly api: TooltipSuggestionApi,
    @inject(ScholarWorkspaceService) private readonly workspace: ScholarWorkspaceService,
  ) {
    this.workspace.subscribe(() => this.syncActivePaper())
    this.syncActivePaper()
  }

  getSnapshot = (): ScholarSuggestionSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    const disposable = this.onDidChange(listener)
    return () => disposable.dispose()
  }

  getPaperState(paperId: string): ScholarSuggestionPaperState {
    return this.snapshot.papers[paperId] ?? createPaperState()
  }

  async loadSuggestions(paperId: string): Promise<void> {
    const token = ++this.nextRequestToken
    this.requestTokens.set(paperId, token)
    this.updatePaper(paperId, {
      ...this.getPaperState(paperId),
      loading: true,
      error: null,
    })

    try {
      const suggestions = await this.api.listTooltipSuggestions(paperId)
      if (this.requestTokens.get(paperId) !== token) {
        return
      }

      const current = this.getPaperState(paperId)
      const validIds = new Set(suggestions.map(suggestion => suggestion.id))
      const checkedIds = current.loaded
        ? new Set([...current.checkedIds].filter(id => validIds.has(id)))
        : new Set(
            suggestions
              .filter(suggestion => !suggestion.is_ai_generated)
              .map(suggestion => suggestion.id),
          )
      const editedContent = new Map(
        [...current.editedContent].filter(([id]) => validIds.has(id)),
      )
      this.updatePaper(paperId, {
        ...current,
        suggestions: [...suggestions],
        loading: false,
        loaded: true,
        error: null,
        checkedIds,
        focusedId: current.focusedId && validIds.has(current.focusedId)
          ? current.focusedId
          : null,
        editedContent,
      })
    } catch (error) {
      if (this.requestTokens.get(paperId) === token) {
        this.updatePaper(paperId, {
          ...this.getPaperState(paperId),
          loading: false,
          error: errorMessage(error),
        })
      }
      throw error
    }
  }

  getCheckState(paperId: string, suggestionIds: readonly string[]): SuggestionCheckState {
    const state = this.getPaperState(paperId)
    const validIds = this.validSuggestionIds(state, suggestionIds)
    if (validIds.length === 0) {
      return 'unchecked'
    }
    const checkedCount = validIds.filter(id => state.checkedIds.has(id)).length
    if (checkedCount === 0) {
      return 'unchecked'
    }
    return checkedCount === validIds.length ? 'checked' : 'indeterminate'
  }

  toggleSuggestions(paperId: string, suggestionIds: readonly string[]): void {
    const state = this.getPaperState(paperId)
    const validIds = this.validSuggestionIds(state, suggestionIds)
    if (validIds.length === 0) {
      return
    }
    const checkedIds = new Set(state.checkedIds)
    const uncheck = validIds.every(id => checkedIds.has(id))
    validIds.forEach(id => {
      if (uncheck) {
        checkedIds.delete(id)
      } else {
        checkedIds.add(id)
      }
    })
    this.updatePaper(paperId, { ...state, checkedIds })
  }

  focusSuggestion(paperId: string, suggestionId: string | null): void {
    const state = this.getPaperState(paperId)
    if (suggestionId && !state.suggestions.some(suggestion => suggestion.id === suggestionId)) {
      return
    }
    const createMode = suggestionId ? false : state.createMode
    if (state.focusedId !== suggestionId || state.createMode !== createMode) {
      this.updatePaper(paperId, { ...state, focusedId: suggestionId, createMode })
    }
  }

  editSuggestion(paperId: string, suggestionId: string, content: string): void {
    const state = this.getPaperState(paperId)
    if (!state.suggestions.some(suggestion => suggestion.id === suggestionId)) {
      return
    }
    const editedContent = new Map(state.editedContent)
    editedContent.set(suggestionId, content)
    this.updatePaper(paperId, { ...state, editedContent })
  }

  updateCreateDraft(
    paperId: string,
    patch: Partial<ScholarSuggestionCreateDraft>,
  ): void {
    const state = this.getPaperState(paperId)
    this.updatePaper(paperId, {
      ...state,
      createDraft: { ...state.createDraft, ...patch },
    })
  }

  startManualCreation(paperId: string): void {
    const state = this.getPaperState(paperId)
    if (!state.pending) {
      this.updatePaper(paperId, {
        ...state,
        createMode: true,
        focusedId: null,
      })
    }
  }

  cancelManualCreation(paperId: string): void {
    const state = this.getPaperState(paperId)
    this.updatePaper(paperId, {
      ...state,
      createMode: false,
      createDraft: {
        entityLabel: '',
        entityType: 'other',
        tooltipContent: '',
      },
    })
  }

  async generateSuggestions(
    paperId: string,
    userExpertise: string,
  ): Promise<GenerateTooltipSuggestionsResponse> {
    this.ensureNoPending(paperId)
    const expertise = userExpertise.trim()
    if (!expertise) {
      throw new Error('Expertise is required')
    }
    const finishOperation = this.workspace.startPaperOperation(
      paperId,
      GENERATING_TOOLTIP_DRAFTS_STATUS,
    )
    this.beginMutation(paperId)
    try {
      const result = await this.api.generateTooltipSuggestions(paperId, {
        user_expertise: expertise,
        entity_types: null,
      })
      await this.loadSuggestions(paperId)
      this.finishMutation(paperId)
      return result
    } catch (error) {
      this.failMutation(paperId, error)
      throw error
    } finally {
      finishOperation()
    }
  }

  async createManualSuggestion(paperId: string): Promise<TooltipSuggestion> {
    const state = this.getPaperState(paperId)
    const entityLabel = state.createDraft.entityLabel.trim()
    const entityType = state.createDraft.entityType.trim()
    const tooltipContent = state.createDraft.tooltipContent.trim()
    if (!entityLabel || !entityType || !tooltipContent) {
      throw new Error('Label, type, and content are required')
    }
    this.ensureNoPending(paperId)
    this.beginMutation(paperId)
    try {
      const created = await this.api.createManualTooltipSuggestion(paperId, {
        entity_label: entityLabel,
        entity_type: entityType,
        tooltip_content: tooltipContent,
      })
      const current = this.getPaperState(paperId)
      const checkedIds = new Set(current.checkedIds)
      checkedIds.add(created.id)
      this.updatePaper(paperId, {
        ...current,
        suggestions: [...current.suggestions, created],
        pending: false,
        error: null,
        checkedIds,
        focusedId: created.id,
        createMode: false,
        createDraft: {
          entityLabel: '',
          entityType: 'other',
          tooltipContent: '',
        },
      })
      return created
    } catch (error) {
      this.failMutation(paperId, error)
      throw error
    }
  }

  async deleteSuggestion(paperId: string, suggestionId: string): Promise<void> {
    this.ensureNoPending(paperId)
    const state = this.getPaperState(paperId)
    if (!state.suggestions.some(suggestion => suggestion.id === suggestionId)) {
      throw new Error('Suggestion not found')
    }
    this.beginMutation(paperId)
    try {
      await this.api.deleteTooltipSuggestion(paperId, suggestionId)
      const current = this.getPaperState(paperId)
      const checkedIds = new Set(current.checkedIds)
      checkedIds.delete(suggestionId)
      const editedContent = new Map(current.editedContent)
      editedContent.delete(suggestionId)
      this.updatePaper(paperId, {
        ...current,
        suggestions: current.suggestions.filter(suggestion => suggestion.id !== suggestionId),
        pending: false,
        error: null,
        checkedIds,
        focusedId: current.focusedId === suggestionId ? null : current.focusedId,
        editedContent,
      })
    } catch (error) {
      this.failMutation(paperId, error)
      throw error
    }
  }

  async applySuggestions(paperId: string): Promise<ApplyTooltipSuggestionsResponse> {
    this.ensureNoPending(paperId)
    const state = this.getPaperState(paperId)
    const selected = state.suggestions.filter(suggestion => state.checkedIds.has(suggestion.id))
    if (selected.length === 0) {
      throw new Error('Select at least one suggestion to apply')
    }
    let finishOperation = this.workspace.startPaperOperation(
      paperId,
      APPLYING_TOOLTIP_DRAFTS_STATUS,
    )
    let stopProgress = (): void => undefined
    if (this.api.watchApplyProgress) {
      stopProgress = this.api.watchApplyProgress(
        paperId,
        progress => {
          if (progress.type === 'connected') {
            return
          }
          if (progress.stage === 'complete' || progress.stage === 'error') {
            stopProgress()
            return
          }
          finishOperation()
          const count = progress.total > 0 ? ` ${progress.current}/${progress.total}` : ''
          finishOperation = this.workspace.startPaperOperation(
            paperId,
            `${APPLYING_TOOLTIP_DRAFTS_STATUS}${count}`,
          )
        },
        () => {
          finishOperation()
          finishOperation = this.workspace.startPaperOperation(
            paperId,
            `${APPLYING_TOOLTIP_DRAFTS_STATUS} progress unavailable`,
          )
        },
      )
    }
    this.beginMutation(paperId)
    try {
      const result = await this.api.applyTooltipSuggestions(paperId, {
        suggestions: selected.map(suggestion => ({
          entity_id: suggestion.entity_id || `manual_${suggestion.id}`,
          entity_label: suggestion.entity_label,
          entity_type: suggestion.entity_type,
          tooltip_content: state.editedContent.has(suggestion.id)
            ? state.editedContent.get(suggestion.id) ?? ''
            : suggestion.tooltip_content,
          occurrences: [],
        })),
      })
      if (result.success) {
        await Promise.all([
          this.workspace.refreshPaper(paperId),
          this.workspace.refreshTooltips(paperId),
        ])
      }
      const current = this.getPaperState(paperId)
      const editedContent = new Map(current.editedContent)
      selected.forEach(suggestion => editedContent.delete(suggestion.id))
      this.updatePaper(paperId, {
        ...current,
        pending: false,
        error: result.success ? null : result.errors.join('\n') || 'Could not apply suggestions',
        editedContent,
      })
      return result
    } catch (error) {
      this.failMutation(paperId, error)
      throw error
    } finally {
      stopProgress()
      finishOperation()
    }
  }

  private syncActivePaper(): void {
    const activePaperId = this.workspace.getSnapshot().activePaperId
    if (activePaperId === this.snapshot.activePaperId) {
      return
    }
    this.snapshot = { ...this.snapshot, activePaperId }
    this.changeEmitter.fire()

    if (activePaperId) {
      const state = this.getPaperState(activePaperId)
      if (!state.loaded && !state.loading) {
        void this.loadSuggestions(activePaperId).catch(() => undefined)
      }
    }
  }

  private validSuggestionIds(
    state: ScholarSuggestionPaperState,
    suggestionIds: readonly string[],
  ): string[] {
    const available = new Set(state.suggestions.map(suggestion => suggestion.id))
    return [...new Set(suggestionIds)].filter(id => available.has(id))
  }

  private ensureNoPending(paperId: string): void {
    if (this.getPaperState(paperId).pending) {
      throw new Error('Another suggestion operation is already in progress')
    }
  }

  private beginMutation(paperId: string): void {
    this.updatePaper(paperId, {
      ...this.getPaperState(paperId),
      pending: true,
      error: null,
    })
  }

  private finishMutation(paperId: string): void {
    this.updatePaper(paperId, {
      ...this.getPaperState(paperId),
      pending: false,
      error: null,
    })
  }

  private failMutation(paperId: string, error: unknown): void {
    this.updatePaper(paperId, {
      ...this.getPaperState(paperId),
      pending: false,
      error: errorMessage(error),
    })
  }

  private updatePaper(paperId: string, state: ScholarSuggestionPaperState): void {
    this.snapshot = {
      ...this.snapshot,
      papers: {
        ...this.snapshot.papers,
        [paperId]: state,
      },
    }
    this.changeEmitter.fire()
  }
}