import { fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { TooltipSuggestion } from '@/lib/reader-workspace-api'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import type {
  ScholarSuggestionPaperState,
  ScholarSuggestionSnapshot,
  SuggestionCheckState,
} from '@/theia/scholar-extension/src/browser/scholar-suggestion-service'
import type {
  isScholarSuggestionTreeNode as isScholarSuggestionTreeNodeFn,
  SCHOLAR_SUGGESTIONS_CONTEXT_MENU as SCHOLAR_SUGGESTIONS_CONTEXT_MENU_TYPE,
  ScholarSuggestionTreeNode,
  ScholarSuggestionsTreeWidget as ScholarSuggestionsTreeWidgetClass,
} from '@/theia/scholar-extension/src/browser/scholar-suggestion-widgets'

let ScholarSuggestionsTreeWidget: typeof ScholarSuggestionsTreeWidgetClass
let isScholarSuggestionTreeNode: typeof isScholarSuggestionTreeNodeFn
let SCHOLAR_SUGGESTIONS_CONTEXT_MENU: typeof SCHOLAR_SUGGESTIONS_CONTEXT_MENU_TYPE

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({
    ScholarSuggestionsTreeWidget,
    isScholarSuggestionTreeNode,
    SCHOLAR_SUGGESTIONS_CONTEXT_MENU,
  } = await vi.importActual(
    '@/theia/scholar-extension/src/browser/scholar-suggestion-widgets',
  ))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

function suggestion(
  id: string,
  isAiGenerated: boolean,
  type: string,
  label = id,
  content = `Content for ${id}`,
): TooltipSuggestion {
  return {
    id,
    paper_id: 'paper-a',
    entity_id: `entity-${id}`,
    entity_label: label,
    entity_type: type,
    tooltip_content: content,
    is_ai_generated: isAiGenerated,
    created_at: '2026-07-17T00:00:00Z',
  }
}

function paperState(
  suggestions: TooltipSuggestion[],
  checkedIds: string[] = [],
  overrides: Partial<ScholarSuggestionPaperState> = {},
): ScholarSuggestionPaperState {
  return {
    suggestions,
    loading: false,
    loaded: true,
    pending: false,
    error: null,
    checkedIds: new Set(checkedIds),
    focusedId: null,
    editedContent: new Map(),
    createMode: false,
    createDraft: { entityLabel: '', entityType: 'other', tooltipContent: '' },
    ...overrides,
  }
}

function workspaceSnapshot(activePaperId: string | null): ReaderWorkspaceSnapshot {
  return {
    papers: [],
    libraryLoading: false,
    libraryError: null,
    activePaperId,
    openPaperIds: activePaperId ? [activePaperId] : [],
    loadingPaperIds: [],
    papersById: {},
    tooltipsByPaperId: {},
    activeEntityByPaperId: {},
    paperErrors: {},
    statusByPaperId: {},
    knowledgeGraphProgressByPaperId: {},
  }
}

interface FakeWidget {
  id: string
  title: { label: string }
  store: { getSnapshot(): ReaderWorkspaceSnapshot }
  suggestions: {
    getSnapshot(): ScholarSuggestionSnapshot
    getPaperState(paperId: string): ScholarSuggestionPaperState
    getCheckState(paperId: string, ids: readonly string[]): SuggestionCheckState
    toggleSuggestions: ReturnType<typeof vi.fn>
    focusSuggestion: ReturnType<typeof vi.fn>
  }
  model: {
    root?: unknown
    selectNode: ReturnType<typeof vi.fn>
    toggleNodeExpansion: ReturnType<typeof vi.fn>
  }
  props: { expandOnlyOnExpansionToggleClick: boolean }
  focusService: { focusedNode?: ScholarSuggestionTreeNode }
  decorations: Map<string, unknown>
  labelProvider: { getName(node: { name?: string }): string | undefined }
  searchHighlights?: Map<string, unknown>
  refreshTree(): void
  renderCheckbox(node: unknown, props: { depth: number }): ReactNode
  getCaptionChildren(node: unknown, props: { depth: number }): ReactNode
  renderTree(model: { root?: unknown }): ReactNode
  tapNode(node?: unknown): void
  handleSpace(event: KeyboardEvent): void
  openSuggestionNode(node?: unknown): void
  toContextMenuArgs(node: unknown): unknown[]
}

function createWidget(
  activePaperId: string | null,
  state: ScholarSuggestionPaperState = paperState([]),
): FakeWidget {
  let currentPaperId = activePaperId
  const suggestionSnapshot: ScholarSuggestionSnapshot = {
    activePaperId,
    papers: activePaperId ? { [activePaperId]: state } : {},
  }
  const toggleSuggestions = vi.fn()
  const focusSuggestion = vi.fn()
  const widget = Object.create(ScholarSuggestionsTreeWidget.prototype) as FakeWidget
  Object.defineProperties(widget, {
    id: { value: 'scholar-agent:suggestions', configurable: true },
    title: { value: { label: 'Suggestions' }, configurable: true },
    store: {
      value: {
        getSnapshot: () => workspaceSnapshot(currentPaperId),
        setActivePaperId: (paperId: string | null) => { currentPaperId = paperId },
      },
      configurable: true,
    },
    suggestions: {
      value: {
        getSnapshot: () => suggestionSnapshot,
        getPaperState: () => state,
        getCheckState: (_paperId: string, ids: readonly string[]) => {
          const selected = ids.filter(id => state.checkedIds.has(id)).length
          return selected === 0
            ? 'unchecked'
            : selected === ids.length
              ? 'checked'
              : 'indeterminate'
        },
        toggleSuggestions,
        focusSuggestion,
      },
      configurable: true,
    },
    model: {
      value: {
        root: undefined,
        selectNode: vi.fn(),
        toggleNodeExpansion: vi.fn(),
      },
      configurable: true,
    },
    props: {
      value: { expandOnlyOnExpansionToggleClick: true },
      configurable: true,
    },
    focusService: { value: {}, configurable: true },
    decorations: { value: new Map(), configurable: true },
    labelProvider: {
      value: { getName: (node: { name?: string }) => node.name },
      configurable: true,
    },
  })
  return widget
}

function rootChildren(widget: FakeWidget): ScholarSuggestionTreeNode[] {
  return (widget.model.root as { children: ScholarSuggestionTreeNode[] }).children
}

describe('ScholarSuggestionsTreeWidget hierarchy and search data', () => {
  it('groups suggestions as Manual / AI, then entity type, with stable leaf ids', () => {
    const state = paperState([
      suggestion('manual-def', false, 'definition'),
      suggestion('manual-symbol', false, 'symbol'),
      suggestion('ai-def', true, 'definition'),
    ], ['manual-def', 'manual-symbol'])
    const widget = createWidget('paper-a', state)

    widget.refreshTree()

    const [manual, ai] = rootChildren(widget)
    expect(manual.label).toBe('Manual')
    expect(ai.label).toBe('AI')
    expect(manual.children.map(child => (child as ScholarSuggestionTreeNode).entityType))
      .toEqual(['definition', 'symbol'])
    expect((manual.children[0] as ScholarSuggestionTreeNode).children[0].id)
      .toBe('suggestion:manual-def')
    expect((ai.children[0] as ScholarSuggestionTreeNode).children[0].id)
      .toBe('suggestion:ai-def')
  })

  it('retains the tree root identity across suggestion refreshes', () => {
    const widget = createWidget('paper-a', paperState([
      suggestion('ai-def', true, 'definition'),
    ]))

    widget.refreshTree()
    const root = widget.model.root
    widget.refreshTree()

    expect(widget.model.root).toBe(root)
  })

  it('clears reused tree children when the active paper closes', () => {
    const widget = createWidget('paper-a', paperState([
      suggestion('ai-def', true, 'definition'),
    ]))
    widget.refreshTree()
    expect(rootChildren(widget)).toHaveLength(1)

    ;(widget.store as typeof widget.store & {
      setActivePaperId(paperId: string | null): void
    }).setActivePaperId(null)
    widget.refreshTree()

    expect(rootChildren(widget)).toEqual([])
  })

  it('derives checked and indeterminate states for every hierarchy level', () => {
    const state = paperState([
      suggestion('manual-1', false, 'definition'),
      suggestion('manual-2', false, 'definition'),
      suggestion('ai-1', true, 'theorem'),
    ], ['manual-1'])
    const widget = createWidget('paper-a', state)

    widget.refreshTree()

    const [manual, ai] = rootChildren(widget)
    const manualType = manual.children[0] as ScholarSuggestionTreeNode
    expect(manual.checkState).toBe('indeterminate')
    expect(manualType.checkState).toBe('indeterminate')
    expect((manualType.children[0] as ScholarSuggestionTreeNode).checkState).toBe('checked')
    expect((manualType.children[1] as ScholarSuggestionTreeNode).checkState).toBe('unchecked')
    expect(ai.checkState).toBe('unchecked')
  })

  it('keeps type and content searchable without repeating them in the grouped display label', () => {
    const state = paperState([
      suggestion('manual-1', false, 'theorem', 'Pythagoras $c^2$', 'Right triangle identity'),
    ])
    const widget = createWidget('paper-a', state)

    widget.refreshTree()

    const leaf = ((rootChildren(widget)[0].children[0] as ScholarSuggestionTreeNode)
      .children[0] as ScholarSuggestionTreeNode)
    expect(leaf.name).toContain('Pythagoras $c^2$')
    expect(leaf.name).toContain('theorem')
    expect(leaf.name).toContain('Right triangle identity')
    expect(leaf.label).toBe('Pythagoras $c^2$')

    const { container } = render(<>{widget.getCaptionChildren(leaf, { depth: 3 })}</>)
    expect(container.textContent).toContain('Pythagoras \\(c^2\\)')
    expect(container.textContent).not.toContain('theorem')
    expect(container.textContent).not.toContain('Right triangle identity')
  })
})

describe('ScholarSuggestionsTreeWidget checkbox and keyboard callbacks', () => {
  it('renders a real indeterminate checkbox and toggles the complete node group on click', () => {
    const state = paperState([
      suggestion('manual-1', false, 'definition'),
      suggestion('manual-2', false, 'definition'),
    ], ['manual-1'])
    const widget = createWidget('paper-a', state)
    widget.refreshTree()
    const manual = rootChildren(widget)[0]

    const { container } = render(<>{widget.renderCheckbox(manual, { depth: 1 })}</>)
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.indeterminate).toBe(true)
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed')

    fireEvent.click(checkbox)

    expect(widget.suggestions.toggleSuggestions).toHaveBeenCalledWith(
      'paper-a',
      ['manual-1', 'manual-2'],
    )
  })

  it('uses the focused tree node for Space and prevents browser scrolling', () => {
    const state = paperState([suggestion('ai-1', true, 'symbol')])
    const widget = createWidget('paper-a', state)
    widget.refreshTree()
    const leaf = ((rootChildren(widget)[0].children[0] as ScholarSuggestionTreeNode)
      .children[0] as ScholarSuggestionTreeNode)
    widget.focusService.focusedNode = leaf
    const event = new KeyboardEvent('keydown', { key: ' ' })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    widget.handleSpace(event)

    expect(preventDefault).toHaveBeenCalled()
    expect(widget.suggestions.toggleSuggestions).toHaveBeenCalledWith('paper-a', ['ai-1'])
  })

  it('focuses a leaf on row tap and through the Enter/open callback', () => {
    const state = paperState([suggestion('manual-1', false, 'definition')])
    const widget = createWidget('paper-a', state)
    widget.refreshTree()
    const leaf = ((rootChildren(widget)[0].children[0] as ScholarSuggestionTreeNode)
      .children[0] as ScholarSuggestionTreeNode)

    widget.tapNode(leaf)
    widget.openSuggestionNode(leaf)

    expect(widget.model.selectNode).toHaveBeenCalledWith(leaf)
    expect(widget.suggestions.focusSuggestion).toHaveBeenNthCalledWith(1, 'paper-a', 'manual-1')
    expect(widget.suggestions.focusSuggestion).toHaveBeenNthCalledWith(2, 'paper-a', 'manual-1')
  })

  it('passes the tree node itself to the dedicated context menu', () => {
    const state = paperState([suggestion('manual-1', false, 'definition')])
    const widget = createWidget('paper-a', state)
    widget.refreshTree()
    const leaf = ((rootChildren(widget)[0].children[0] as ScholarSuggestionTreeNode)
      .children[0] as ScholarSuggestionTreeNode)

    expect(widget.toContextMenuArgs(leaf)).toEqual([leaf])
    expect(SCHOLAR_SUGGESTIONS_CONTEXT_MENU).toEqual([
      'scholar-agent-suggestions-context-menu',
    ])
  })
})

describe('ScholarSuggestionsTreeWidget native states and guards', () => {
  it.each([
    [null, paperState([]), 'Open a paper to see term highlights.'],
    ['paper-a', paperState([], [], { loading: true, loaded: false }), 'Loading term highlights…'],
    ['paper-a', paperState([], [], { error: 'Backend unavailable' }), 'Backend unavailable'],
    ['paper-a', paperState([]), 'No term highlights for the active paper.'],
  ] as const)('renders the expected empty/status state', (activePaperId, state, expected) => {
    const widget = createWidget(activePaperId, state)
    widget.refreshTree()

    const { container } = render(<>{widget.renderTree(widget.model)}</>)

    expect(container.textContent).toContain(expected)
  })

  it('recognizes only suggestion nodes', () => {
    const state = paperState([suggestion('manual-1', false, 'definition')])
    const widget = createWidget('paper-a', state)
    widget.refreshTree()
    const node = rootChildren(widget)[0]

    expect(isScholarSuggestionTreeNode(node)).toBe(true)
    expect(isScholarSuggestionTreeNode({ id: 'plain', parent: undefined })).toBe(false)
    expect(isScholarSuggestionTreeNode(undefined)).toBe(false)
  })
})