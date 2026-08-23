import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { TooltipSuggestion } from '@/lib/reader-workspace-api'
import type {
  ScholarSuggestionPaperState,
  ScholarSuggestionSnapshot,
} from '@/theia/scholar-extension/src/browser/scholar-suggestion-service'
import type {
  ScholarSuggestionEditorContent as ScholarSuggestionEditorContentComponent,
} from '@/theia/scholar-extension/src/browser/scholar-suggestion-widgets'

let ScholarSuggestionEditorContent: typeof ScholarSuggestionEditorContentComponent
let ScholarCommands: typeof import('@/theia/scholar-extension/src/browser/scholar-commands').ScholarCommands

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarSuggestionEditorContent } = await import(
    '@/theia/scholar-extension/src/browser/scholar-suggestion-widgets'
  ))
  ;({ ScholarCommands } = await import(
    '@/theia/scholar-extension/src/browser/scholar-commands'
  ))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

afterEach(() => cleanup())

function suggestion(overrides: Partial<TooltipSuggestion> = {}): TooltipSuggestion {
  return {
    id: 'suggestion-1',
    paper_id: 'paper-a',
    entity_id: 'entity-1',
    entity_label: 'Alpha $x$',
    entity_type: 'definition',
    tooltip_content: 'Original $x$ content',
    is_ai_generated: false,
    created_at: '2026-07-17T00:00:00Z',
    ...overrides,
  }
}

function paperState(overrides: Partial<ScholarSuggestionPaperState> = {}): ScholarSuggestionPaperState {
  return {
    suggestions: [],
    loading: false,
    loaded: true,
    pending: false,
    error: null,
    checkedIds: new Set(),
    focusedId: null,
    editedContent: new Map(),
    createMode: false,
    createDraft: { entityLabel: '', entityType: 'other', tooltipContent: '' },
    ...overrides,
  }
}

class FakeSuggestionService {
  private readonly listeners = new Set<() => void>()
  private state: ScholarSuggestionPaperState
  private snapshot: ScholarSuggestionSnapshot
  readonly editSuggestion = vi.fn()
  readonly startManualCreation = vi.fn(() => {
    this.setState({ createMode: true, focusedId: null })
  })
  readonly cancelManualCreation = vi.fn(() => {
    this.setState({ createMode: false })
  })
  readonly createManualSuggestion = vi.fn().mockResolvedValue(suggestion())

  constructor(
    private activePaperId: string | null,
    state: ScholarSuggestionPaperState,
  ) {
    this.state = state
    this.snapshot = this.createSnapshot()
  }

  getSnapshot = (): ScholarSuggestionSnapshot => this.snapshot

  getPaperState = (): ScholarSuggestionPaperState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  updateCreateDraft = (_paperId: string, patch: Record<string, string>): void => {
    this.setState({ createDraft: { ...this.state.createDraft, ...patch } })
  }

  private setState(patch: Partial<ScholarSuggestionPaperState>): void {
    this.state = { ...this.state, ...patch }
    this.snapshot = this.createSnapshot()
    this.listeners.forEach(listener => listener())
  }

  private createSnapshot(): ScholarSuggestionSnapshot {
    return {
      activePaperId: this.activePaperId,
      papers: this.activePaperId ? { [this.activePaperId]: this.state } : {},
    }
  }
}

function renderEditor(service: FakeSuggestionService) {
  const commandService = { executeCommand: vi.fn().mockResolvedValue(undefined) }
  const messageService = { error: vi.fn().mockResolvedValue(undefined) }
  render(
    <ScholarSuggestionEditorContent
      suggestions={service as never}
      commandService={commandService as never}
      messageService={messageService as never}
    />,
  )
  return { commandService, messageService }
}

describe('ScholarSuggestionEditorContent', () => {
  it('renders a native empty state without an active paper', () => {
    renderEditor(new FakeSuggestionService(null, paperState()))

    expect(screen.getByText('Open a paper to inspect term highlights.')).toBeTruthy()
  })

  it('renders LatexText preview and transient editing for the focused suggestion', () => {
    const item = suggestion()
    const service = new FakeSuggestionService('paper-a', paperState({
      suggestions: [item],
      focusedId: item.id,
      checkedIds: new Set([item.id]),
      editedContent: new Map([[item.id, 'Edited $y$ content']]),
    }))
    const { commandService } = renderEditor(service)

    expect(screen.getByText('Alpha \\(x\\)')).toBeTruthy()
    expect(screen.getByText('definition')).toBeTruthy()
    expect(screen.getByText('Edited \\(y\\) content')).toBeTruthy()
    const editor = screen.getByLabelText('Term highlight content') as HTMLTextAreaElement
    expect(editor.value).toBe('Edited $y$ content')

    fireEvent.change(editor, { target: { value: 'New content' } })
    expect(service.editSuggestion).toHaveBeenCalledWith('paper-a', item.id, 'New content')

    fireEvent.click(screen.getByRole('button', { name: 'Delete Term Highlight' }))
    expect(commandService.executeCommand).toHaveBeenCalledWith(
      ScholarCommands.DELETE_SUGGESTION.id,
      expect.objectContaining({ paperId: 'paper-a', suggestionId: item.id }),
    )
  })

  it('opens the manual form with predefined entity types and validates required fields', async () => {
    const service = new FakeSuggestionService('paper-a', paperState())
    const { messageService } = renderEditor(service)

    fireEvent.click(screen.getByRole('button', { name: 'Create Manual Term Highlight' }))
    expect(service.startManualCreation).toHaveBeenCalledWith('paper-a')
    const create = screen.getByRole('button', { name: 'Create Term Highlight' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Entity label'), { target: { value: '  Alpha $x$  ' } })
    const entityType = screen.getByLabelText('Entity type') as HTMLSelectElement
    expect(Array.from(entityType.options, option => option.value)).toContain('theorem')
    fireEvent.change(entityType, { target: { value: 'theorem' } })
    fireEvent.change(screen.getByLabelText('Term highlight content'), {
      target: { value: ' Explanation ' },
    })
    expect(screen.getByText('Alpha \\(x\\)')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create Term Highlight' }) as HTMLButtonElement).disabled)
      .toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Create Term Highlight' }))
    await waitFor(() => expect(service.createManualSuggestion).toHaveBeenCalledWith('paper-a'))
    expect(messageService.error).not.toHaveBeenCalled()
  })

  it('reports create failures and supports canceling the transient form', async () => {
    const service = new FakeSuggestionService('paper-a', paperState({
      createMode: true,
      createDraft: {
        entityLabel: 'Alpha',
        entityType: 'definition',
        tooltipContent: 'Explanation',
      },
    }))
    service.createManualSuggestion.mockRejectedValueOnce(new Error('Backend unavailable'))
    const { messageService } = renderEditor(service)

    fireEvent.click(screen.getByRole('button', { name: 'Create Term Highlight' }))
    await waitFor(() => expect(messageService.error).toHaveBeenCalledWith(
      'Could not create term highlight: Backend unavailable',
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(service.cancelManualCreation).toHaveBeenCalledWith('paper-a')
  })
})