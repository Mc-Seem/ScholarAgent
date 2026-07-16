import { render } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Paper } from '@/hooks/usePapers'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import type { ScholarCommands as ScholarCommandsNamespace } from '@/theia/scholar-extension/src/browser/scholar-commands'
import type {
  isScholarLibraryTreeNode as isScholarLibraryTreeNodeFn,
  SCHOLAR_LIBRARY_CONTEXT_MENU as SCHOLAR_LIBRARY_CONTEXT_MENU_TYPE,
  ScholarLibraryTreeNode,
  ScholarLibraryWidget as ScholarLibraryWidgetClass,
} from '@/theia/scholar-extension/src/browser/scholar-side-widgets'

let ScholarLibraryWidget: typeof ScholarLibraryWidgetClass
let isScholarLibraryTreeNode: typeof isScholarLibraryTreeNodeFn
let SCHOLAR_LIBRARY_CONTEXT_MENU: typeof SCHOLAR_LIBRARY_CONTEXT_MENU_TYPE
let ScholarCommands: typeof ScholarCommandsNamespace

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarLibraryWidget, isScholarLibraryTreeNode, SCHOLAR_LIBRARY_CONTEXT_MENU } = await vi.importActual(
    '@/theia/scholar-extension/src/browser/scholar-side-widgets',
  ))
  ;({ ScholarCommands } = await import('@/theia/scholar-extension/src/browser/scholar-commands'))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

function emptySnapshot(): ReaderWorkspaceSnapshot {
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

function paper(id: string, overrides: Partial<Paper> = {}): Paper {
  return {
    id,
    filename: `${id}.tar.gz`,
    arxiv_id: null,
    uploaded_at: '2026-07-15T00:00:00Z',
    compiled_at: '2026-07-15T00:01:00Z',
    has_html: true,
    ...overrides,
  }
}

interface FakeWidget {
  id: string
  title: { label: string }
  store: { getSnapshot: () => ReaderWorkspaceSnapshot, subscribe: (listener: () => void) => () => void }
  commandService: { executeCommand: ReturnType<typeof vi.fn> }
  model: { root?: unknown }
  decorations: Map<string, unknown>
  labelProvider: { getName: (node: { name?: string }) => string | undefined }
  refreshTree(): void
  toContextMenuArgs(node: unknown): unknown[]
  getCaptionChildren(node: unknown, props: { depth: number }): unknown
  renderIcon(node: unknown): unknown
}

function createWidget(
  snapshot: ReaderWorkspaceSnapshot,
  commandService: { executeCommand: ReturnType<typeof vi.fn> } = { executeCommand: vi.fn() },
): FakeWidget {
  const widget = Object.create(ScholarLibraryWidget.prototype) as FakeWidget
  Object.defineProperty(widget, 'id', { value: 'scholar-agent:library', configurable: true })
  Object.defineProperty(widget, 'title', { value: { label: 'Papers' }, configurable: true })
  Object.defineProperty(widget, 'store', {
    value: { getSnapshot: () => snapshot, subscribe: vi.fn(() => () => undefined) },
    configurable: true,
  })
  Object.defineProperty(widget, 'commandService', { value: commandService, configurable: true })
  Object.defineProperty(widget, 'model', { value: { root: undefined }, configurable: true, writable: true })
  Object.defineProperty(widget, 'decorations', { value: new Map(), configurable: true })
  Object.defineProperty(widget, 'labelProvider', {
    value: { getName: (node: { name?: string }) => node.name },
    configurable: true,
  })
  return widget
}

function libraryRoot(widget: FakeWidget): { children: ScholarLibraryTreeNode[] } {
  return widget.model.root as { children: ScholarLibraryTreeNode[] }
}

describe('ScholarLibraryWidget tree building', () => {
  it('builds one stable node per paper with a label and description', () => {
    const snapshot = emptySnapshot()
    snapshot.papers = [
      paper('paper-a', { filename: 'alpha.tar.gz' }),
      paper('paper-b', { filename: 'beta.tar.gz', arxiv_id: '2401.00001' }),
    ]
    const widget = createWidget(snapshot)

    widget.refreshTree()

    const root = libraryRoot(widget)
    expect(root.children).toHaveLength(2)
    expect(root.children[0].id).toBe('paper:paper-a')
    expect(root.children[0].paperId).toBe('paper-a')
    expect(root.children[1].id).toBe('paper:paper-b')
    expect(root.children[1].description).toContain('2401.00001')
  })

  it('shows the busy status as the node description while a paper is compiling', () => {
    const snapshot = emptySnapshot()
    snapshot.papers = [paper('paper-a')]
    snapshot.statusByPaperId['paper-a'] = 'Starting compilation…'
    const widget = createWidget(snapshot)

    widget.refreshTree()

    const [node] = libraryRoot(widget).children
    expect(node.description).toBe('Starting compilation…')
    expect(node.compiling).toBe(true)
  })

  it('shows the paper error as the node description when present', () => {
    const snapshot = emptySnapshot()
    snapshot.papers = [paper('paper-a')]
    snapshot.paperErrors['paper-a'] = 'Compilation failed'
    const widget = createWidget(snapshot)

    widget.refreshTree()

    const [node] = libraryRoot(widget).children
    expect(node.description).toBe('Compilation failed')
    expect(node.hasError).toBe(true)
  })

  it('renders no children and lets callers detect the empty state', () => {
    const widget = createWidget(emptySnapshot())

    widget.refreshTree()

    expect(libraryRoot(widget).children).toHaveLength(0)
  })

  it('preserves selection across a refresh when the paper is still present', () => {
    const snapshot = emptySnapshot()
    snapshot.papers = [paper('paper-a'), paper('paper-b')]
    const widget = createWidget(snapshot)

    widget.refreshTree()
    libraryRoot(widget).children[1].selected = true

    widget.refreshTree()

    const root = libraryRoot(widget)
    expect(root.children[0].selected).toBe(false)
    expect(root.children[1].selected).toBe(true)
  })

  it('drops the stale selection state once a paper is removed from the library', () => {
    const snapshot = emptySnapshot()
    snapshot.papers = [paper('paper-a'), paper('paper-b')]
    const widget = createWidget(snapshot)

    widget.refreshTree()
    libraryRoot(widget).children[1].selected = true

    snapshot.papers = [paper('paper-a')]
    widget.refreshTree()

    const root = libraryRoot(widget)
    expect(root.children).toHaveLength(1)
    expect(root.children[0].selected).toBe(false)
  })
})

describe('ScholarLibraryWidget opening (Enter / double-click share one handler)', () => {
  it('dispatches the Open command through model.onOpenNode for a library node', () => {
    const commandService = { executeCommand: vi.fn().mockResolvedValue(undefined) }
    const widget = createWidget(emptySnapshot(), commandService) as FakeWidget & {
      openLibraryNode(node: unknown): void
    }
    const node: ScholarLibraryTreeNode = {
      id: 'paper:paper-a',
      paperId: 'paper-a',
      parent: undefined,
      selected: false,
    }

    widget.openLibraryNode(node)

    expect(commandService.executeCommand).toHaveBeenCalledWith(ScholarCommands.OPEN_PAPER.id, node)
    expect(commandService.executeCommand).toHaveBeenCalledTimes(1)
  })

  it('ignores nodes that are not library paper nodes', () => {
    const commandService = { executeCommand: vi.fn() }
    const widget = createWidget(emptySnapshot(), commandService) as FakeWidget & {
      openLibraryNode(node: unknown): void
    }

    widget.openLibraryNode({ id: 'not-a-paper', parent: undefined, selected: false })
    widget.openLibraryNode(undefined)

    expect(commandService.executeCommand).not.toHaveBeenCalled()
  })
})

describe('ScholarLibraryWidget context menu', () => {
  it('passes the paper node itself as the sole context menu argument', () => {
    const widget = createWidget(emptySnapshot())
    const node: ScholarLibraryTreeNode = {
      id: 'paper:paper-a',
      paperId: 'paper-a',
      parent: undefined,
      selected: true,
    }

    expect(widget.toContextMenuArgs(node)).toEqual([node])
  })

  it('exposes a dedicated context menu path distinct from the outline/comments tree menu', () => {
    expect(SCHOLAR_LIBRARY_CONTEXT_MENU).toEqual(['scholar-agent-library-context-menu'])
  })
})

describe('ScholarLibraryWidget rendering', () => {
  it('renders the label and description for a paper node', () => {
    const widget = createWidget(emptySnapshot())
    const node: ScholarLibraryTreeNode = {
      id: 'paper:paper-a',
      paperId: 'paper-a',
      parent: undefined,
      selected: false,
      name: 'Alpha Paper',
      description: 'arXiv:2401.00001',
    }

    const { container } = render(<>{widget.getCaptionChildren(node, { depth: 0 })}</>)

    expect(container.textContent).toContain('Alpha Paper')
    expect(container.textContent).toContain('arXiv:2401.00001')
  })

  it('renders a busy icon while the paper is compiling', () => {
    const widget = createWidget(emptySnapshot())
    const node: ScholarLibraryTreeNode = {
      id: 'paper:paper-a',
      paperId: 'paper-a',
      parent: undefined,
      selected: false,
      compiling: true,
    }

    const { container } = render(<>{widget.renderIcon(node)}</>)

    expect(container.querySelector('.codicon-sync')).not.toBeNull()
  })
})

describe('isScholarLibraryTreeNode', () => {
  it('identifies a paper node and rejects unrelated values', () => {
    expect(isScholarLibraryTreeNode({
      id: 'paper:paper-a',
      paperId: 'paper-a',
      parent: undefined,
      selected: false,
    })).toBe(true)
    expect(isScholarLibraryTreeNode({ id: 'paper:paper-a', parent: undefined, selected: false })).toBe(false)
    expect(isScholarLibraryTreeNode(undefined)).toBe(false)
    expect(isScholarLibraryTreeNode(null)).toBe(false)
  })
})
