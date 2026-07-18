import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Command, CommandHandler } from '@theia/core'
import type { PaperDetail } from '@/hooks/usePapers'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import type { ScholarContribution as ScholarContributionClass } from '@/theia/scholar-extension/src/browser/scholar-contribution'

const dialogState = vi.hoisted(() => ({
  confirmOpen: vi.fn<() => Promise<boolean>>(),
  inputOpen: vi.fn<() => Promise<string | undefined>>(),
  inputProps: [] as Array<Record<string, unknown>>,
  // Generate AI Tooltip Suggestions uses the multiline ScholarTextareaDialog
  // (not the built-in single-line SingleTextInputDialog).
  textareaOpen: vi.fn<() => Promise<string | undefined>>(),
  textareaProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('@theia/core/lib/browser', async () => {
  const actual = await vi.importActual<typeof import('@theia/core/lib/browser')>(
    '@theia/core/lib/browser',
  )
  return {
    ...actual,
    ConfirmDialog: vi.fn().mockImplementation(function ConfirmDialog() {
      return { open: dialogState.confirmOpen }
    }),
    SingleTextInputDialog: vi.fn().mockImplementation(function SingleTextInputDialog(
      props: Record<string, unknown>,
    ) {
      dialogState.inputProps.push(props)
      return { open: dialogState.inputOpen }
    }),
  }
})

vi.mock('@/theia/scholar-extension/src/browser/scholar-textarea-dialog', () => ({
  ScholarTextareaDialog: vi.fn().mockImplementation(function ScholarTextareaDialog(
    props: Record<string, unknown>,
  ) {
    dialogState.textareaProps.push(props)
    return { open: dialogState.textareaOpen }
  }),
}))

let ScholarContribution: typeof ScholarContributionClass
let ScholarCommands: typeof import('@/theia/scholar-extension/src/browser/scholar-commands').ScholarCommands
let ScholarAnnotationService: typeof import('@/theia/scholar-extension/src/browser/scholar-annotation-service').ScholarAnnotationService
let ScholarSuggestionsTreeWidget: typeof import('@/theia/scholar-extension/src/browser/scholar-suggestion-widgets').ScholarSuggestionsTreeWidget
let ScholarSuggestionEditorWidget: typeof import('@/theia/scholar-extension/src/browser/scholar-suggestion-widgets').ScholarSuggestionEditorWidget
let createScholarSuggestionTarget: typeof import('@/theia/scholar-extension/src/browser/scholar-suggestion-widgets').createScholarSuggestionTarget
let SCHOLAR_SUGGESTIONS_CONTEXT_MENU: readonly string[]

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarContribution } = await import(
    '@/theia/scholar-extension/src/browser/scholar-contribution'
  ))
  ;({ ScholarCommands } = await import(
    '@/theia/scholar-extension/src/browser/scholar-commands'
  ))
  ;({ ScholarAnnotationService } = await import(
    '@/theia/scholar-extension/src/browser/scholar-annotation-service'
  ))
  ;({
    ScholarSuggestionsTreeWidget,
    ScholarSuggestionEditorWidget,
    createScholarSuggestionTarget,
    SCHOLAR_SUGGESTIONS_CONTEXT_MENU,
  } = await import('@/theia/scholar-extension/src/browser/scholar-suggestion-widgets'))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

class FakeCommandRegistry {
  readonly handlers = new Map<string, CommandHandler>()

  registerCommand(command: Command, handler: CommandHandler): { dispose(): void } {
    this.handlers.set(command.id, handler)
    return { dispose: () => this.handlers.delete(command.id) }
  }

  handlerFor(command: Command): CommandHandler {
    const handler = this.handlers.get(command.id)
    if (!handler) {
      throw new Error(`Missing command ${command.id}`)
    }
    return handler
  }
}

function paper(): PaperDetail {
  return {
    id: 'paper-a',
    filename: 'paper-a.tar.gz',
    arxiv_id: null,
    uploaded_at: '2026-07-17T00:00:00Z',
    compiled_at: '2026-07-17T00:01:00Z',
    has_html: true,
    html_content: '<article />',
    sections: [],
    equations: [],
    citations: [],
    paper_metadata: { title: 'Paper A' },
    has_knowledge_graph: true,
  }
}

function snapshot(): ReaderWorkspaceSnapshot {
  const item = paper()
  return {
    papers: [item],
    libraryLoading: false,
    libraryError: null,
    activePaperId: item.id,
    openPaperIds: [item.id],
    loadingPaperIds: [],
    papersById: { [item.id]: item },
    tooltipsByPaperId: {},
    activeEntityByPaperId: {},
    paperErrors: {},
    statusByPaperId: {},
    knowledgeGraphProgressByPaperId: {},
  }
}

function createContext() {
  let suggestionChangeListener: (() => void) | undefined
  const state = {
    suggestions: [{ id: 'suggestion-1', entity_label: 'Alpha' }],
    checkedIds: new Set(['suggestion-1']),
    focusedId: 'suggestion-1',
    pending: false,
    createMode: false,
  }
  const suggestions = {
    state,
    getSnapshot: vi.fn(() => ({ activePaperId: 'paper-a', papers: {} })),
    getPaperState: vi.fn(() => state),
    onDidChange: vi.fn((listener: () => void) => {
      suggestionChangeListener = listener
      return { dispose: () => undefined }
    }),
    emitChange: () => suggestionChangeListener?.(),
    generateSuggestions: vi.fn().mockResolvedValue({ suggested_count: 2 }),
    applySuggestions: vi.fn().mockResolvedValue({
      success: true,
      tooltips_created: 2,
      spans_injected: 4,
      errors: ['One occurrence was skipped'],
    }),
    startManualCreation: vi.fn(),
    deleteSuggestion: vi.fn().mockResolvedValue(undefined),
  }
  const workspaceSnapshot = snapshot()
  const store = {
    getSnapshot: vi.fn(() => workspaceSnapshot),
    subscribe: vi.fn(() => () => undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
  }
  const llmSettings = {
    getSnapshot: vi.fn(() => ({
      dirty: false,
      saving: false,
      models: { status: 'idle' },
      testByWorkflow: {
        kg_extraction: { status: 'idle' },
        html_injection: { status: 'idle' },
        tooltip_suggestion: { status: 'idle' },
      },
      validation: {
        canSave: true,
        canListModels: true,
        canTest: {
          kg_extraction: true,
          html_injection: true,
          tooltip_suggestion: true,
        },
      },
    })),
    onDidChange: vi.fn(() => ({ dispose: () => undefined })),
  }
  const widgetManager = {
    getOrCreateWidget: vi.fn().mockResolvedValue({ id: 'annotations', isAttached: true }),
    getWidgets: vi.fn(() => []),
  }
  const shell = {
    activeWidget: undefined,
    onDidChangeCurrentWidget: vi.fn(() => ({ dispose: () => undefined })),
    addWidget: vi.fn().mockResolvedValue(undefined),
    activateWidget: vi.fn().mockResolvedValue(undefined),
  }
  const statusBar = {
    setElement: vi.fn().mockResolvedValue(undefined),
    removeElement: vi.fn().mockResolvedValue(undefined),
  }
  const messageService = {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  }
  const Constructor = ScholarContribution as unknown as new (...args: unknown[]) => ScholarContributionClass
  const contribution = new Constructor(
    store,
    new ScholarAnnotationService(),
    suggestions,
    llmSettings,
    widgetManager,
    shell,
    statusBar,
    messageService,
  )
  const commands = new FakeCommandRegistry()
  contribution.registerCommands(commands as never)
  return { contribution, commands, suggestions, workspaceSnapshot, widgetManager, shell, messageService }
}

beforeEach(() => {
  dialogState.confirmOpen.mockReset()
  dialogState.inputOpen.mockReset()
  dialogState.inputProps.length = 0
  dialogState.textareaOpen.mockReset()
  dialogState.textareaProps.length = 0
  localStorage.clear()
})

describe('Scholar suggestion commands', () => {
  it('scopes toolbar commands to Suggestions and enforces active paper, KG, checks, and pending state', () => {
    const context = createContext()
    const tree = Object.create(ScholarSuggestionsTreeWidget.prototype)
    const editor = Object.create(ScholarSuggestionEditorWidget.prototype)

    const generate = context.commands.handlerFor(ScholarCommands.GENERATE_SUGGESTIONS)
    const apply = context.commands.handlerFor(ScholarCommands.APPLY_SUGGESTIONS)
    const create = context.commands.handlerFor(ScholarCommands.CREATE_MANUAL_SUGGESTION)
    expect(generate.isVisible?.(tree)).toBe(true)
    expect(generate.isVisible?.(editor)).toBe(true)
    expect(generate.isVisible?.({})).toBe(false)
    expect(generate.isEnabled?.(tree)).toBe(true)
    expect(apply.isEnabled?.(tree)).toBe(true)
    expect(create.isEnabled?.(tree)).toBe(true)

    context.workspaceSnapshot.papersById['paper-a'].has_knowledge_graph = false
    expect(generate.isEnabled?.(tree)).toBe(false)
    context.workspaceSnapshot.papersById['paper-a'].has_knowledge_graph = true
    context.suggestions.state.pending = true
    expect(generate.isEnabled?.(tree)).toBe(false)
    expect(apply.isEnabled?.(tree)).toBe(false)
    expect(create.isEnabled?.(tree)).toBe(false)

    context.suggestions.state.pending = false
    context.workspaceSnapshot.statusByPaperId['paper-a'] = 'Starting compilation…'
    expect(generate.isEnabled?.(tree)).toBe(false)
    expect(apply.isEnabled?.(tree)).toBe(false)
  })

  it('prompts with saved expertise in a multiline dialog, validates it, persists the confirmed value, and handles cancel', async () => {
    const { commands, suggestions, messageService } = createContext()
    const tree = Object.create(ScholarSuggestionsTreeWidget.prototype)
    localStorage.setItem('scholar-agent-expertise', 'Saved expertise')
    dialogState.textareaOpen.mockResolvedValueOnce(undefined)

    await commands.handlerFor(ScholarCommands.GENERATE_SUGGESTIONS).execute(tree)
    expect(suggestions.generateSuggestions).not.toHaveBeenCalled()
    // Generate AI Tooltip Suggestions must use the multiline textarea dialog,
    // not the single-line SingleTextInputDialog (too small for a prompt).
    expect(dialogState.inputProps).toHaveLength(0)
    expect(dialogState.textareaProps[0].initialValue).toBe('Saved expertise')
    expect((dialogState.textareaProps[0].validate as (input: string) => unknown)('   '))
      .toBe('Expertise is required.')

    dialogState.textareaOpen.mockResolvedValueOnce('  Algebra researcher  ')
    await commands.handlerFor(ScholarCommands.GENERATE_SUGGESTIONS).execute(tree)

    expect(suggestions.generateSuggestions).toHaveBeenCalledWith('paper-a', 'Algebra researcher')
    expect(localStorage.getItem('scholar-agent-expertise')).toBe('Algebra researcher')
    expect(messageService.info).toHaveBeenCalledWith('Generated 2 AI tooltip suggestions')
  })

  it('applies checked suggestions and reports both result counts and backend warnings', async () => {
    const { commands, suggestions, messageService } = createContext()
    const tree = Object.create(ScholarSuggestionsTreeWidget.prototype)

    await commands.handlerFor(ScholarCommands.APPLY_SUGGESTIONS).execute(tree)

    expect(suggestions.applySuggestions).toHaveBeenCalledWith('paper-a')
    expect(messageService.info).toHaveBeenCalledWith('Applied 2 tooltips to 4 occurrences')
    expect(messageService.warn).toHaveBeenCalledWith('One occurrence was skipped')
  })

  it('starts manual creation and confirms deletion of only a concrete suggestion', async () => {
    const { commands, suggestions } = createContext()
    const tree = Object.create(ScholarSuggestionsTreeWidget.prototype)
    const target = createScholarSuggestionTarget('paper-a', 'suggestion-1')

    await commands.handlerFor(ScholarCommands.CREATE_MANUAL_SUGGESTION).execute(tree)
    expect(suggestions.startManualCreation).toHaveBeenCalledWith('paper-a')

    const remove = commands.handlerFor(ScholarCommands.DELETE_SUGGESTION)
    expect(remove.isVisible?.(target)).toBe(true)
    expect(remove.isVisible?.(tree)).toBe(false)
    dialogState.confirmOpen.mockResolvedValueOnce(false)
    await remove.execute(target)
    expect(suggestions.deleteSuggestion).not.toHaveBeenCalled()

    dialogState.confirmOpen.mockResolvedValueOnce(true)
    await remove.execute(target)
    expect(suggestions.deleteSuggestion).toHaveBeenCalledWith('paper-a', 'suggestion-1')
  })

  it('registers Generate, Apply, and Create in the tree toolbar and Delete in its context menu', () => {
    const { contribution } = createContext()
    const toolbarItems: Array<{ id: string }> = []
    contribution.registerToolbarItems({
      registerItem: (item: { id: string }) => {
        toolbarItems.push(item)
        return { dispose: () => undefined }
      },
    } as never)
    expect(toolbarItems.map(item => item.id)).toEqual(expect.arrayContaining([
      ScholarCommands.GENERATE_SUGGESTIONS.id,
      ScholarCommands.APPLY_SUGGESTIONS.id,
      ScholarCommands.CREATE_MANUAL_SUGGESTION.id,
    ]))
    expect(toolbarItems.map(item => item.id)).not.toContain(ScholarCommands.DELETE_SUGGESTION.id)

    const menuActions: Array<{ path: readonly string[], commandId: string }> = []
    contribution.registerMenus({
      registerMenuAction: (path: readonly string[], action: { commandId: string }) => {
        menuActions.push({ path, commandId: action.commandId })
      },
    } as never)
    expect(menuActions).toContainEqual({
      path: SCHOLAR_SUGGESTIONS_CONTEXT_MENU,
      commandId: ScholarCommands.DELETE_SUGGESTION.id,
    })
  })

  it('reports command failures through MessageService', async () => {
    const { commands, suggestions, messageService } = createContext()
    const tree = Object.create(ScholarSuggestionsTreeWidget.prototype)
    suggestions.applySuggestions.mockRejectedValueOnce(new Error('Injection failed'))

    await commands.handlerFor(ScholarCommands.APPLY_SUGGESTIONS).execute(tree)

    expect(messageService.error).toHaveBeenCalledWith(
      'Could not apply suggestions: Injection failed',
    )
  })

  it('reveals Suggestion Details when focus or manual-create mode changes', async () => {
    const { contribution, suggestions, widgetManager, shell } = createContext()
    contribution.onStart()

    suggestions.emitChange()
    await Promise.resolve()
    expect(widgetManager.getOrCreateWidget).toHaveBeenCalledWith('scholar-agent:tooltip-drafts')

    suggestions.state.createMode = true
    suggestions.emitChange()
    await Promise.resolve()
    expect(shell.activateWidget).toHaveBeenCalledWith('annotations')

    contribution.onStop()
  })
})