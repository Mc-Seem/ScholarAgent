import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { PaperDetail } from '@/hooks/usePapers'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import type {
  ScholarPaperWidget as ScholarPaperWidgetClass,
  ScholarPaperWidgetOptions,
} from '@/theia/scholar-extension/src/browser/scholar-paper-widget'
import type { ScholarAnnotationService } from '@/theia/scholar-extension/src/browser/scholar-annotation-service'
import type { ScholarWorkspaceService } from '@/theia/scholar-extension/src/browser/scholar-workspace-service'

let ScholarPaperWidget: typeof ScholarPaperWidgetClass
const widgets: ScholarPaperWidgetClass[] = []
let restoreReactWidgetUpdate: (() => void) | undefined

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  const { ReactWidget } = await import('@theia/core/lib/browser')
  const updateSpy = vi.spyOn(ReactWidget.prototype, 'update').mockImplementation(() => undefined)
  restoreReactWidgetUpdate = () => updateSpy.mockRestore()
  ;({ ScholarPaperWidget } = await import(
    '@/theia/scholar-extension/src/browser/scholar-paper-widget'
  ))
})

afterEach(() => {
  act(() => {
    cleanup()
    for (const widget of widgets.splice(0)) {
      if (!widget.isDisposed) {
        widget.dispose()
      }
    }
  })
  vi.useRealTimers()
})

afterAll(() => {
  restoreReactWidgetUpdate?.()
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

function paperDetail(id: string, html = `<p>${id}</p>`, title = id): PaperDetail {
  return {
    id,
    filename: `${id}.tar.gz`,
    arxiv_id: null,
    uploaded_at: '2026-07-15T00:00:00Z',
    compiled_at: '2026-07-15T00:01:00Z',
    has_html: true,
    html_content: html,
    sections: [],
    equations: [],
    citations: [],
    paper_metadata: { title },
    has_knowledge_graph: false,
  }
}

function snapshot(paperId: string, html?: string, title?: string): ReaderWorkspaceSnapshot {
  return {
    papers: [],
    libraryLoading: false,
    libraryError: null,
    activePaperId: paperId,
    openPaperIds: [paperId],
    loadingPaperIds: [],
    papersById: { [paperId]: paperDetail(paperId, html, title) },
    tooltipsByPaperId: {},
    activeEntityByPaperId: {},
    paperErrors: {},
    statusByPaperId: {},
    knowledgeGraphProgressByPaperId: {},
  }
}

function createStore(value: ReaderWorkspaceSnapshot): ScholarWorkspaceService {
  return {
    getSnapshot: vi.fn(() => value),
    subscribe: vi.fn(() => () => undefined),
    openPaper: vi.fn().mockResolvedValue(value.papersById[value.activePaperId!]),
    closePaper: vi.fn(),
    activatePaper: vi.fn(),
    setActiveEntity: vi.fn(),
    createTooltip: vi.fn().mockResolvedValue(undefined),
    updateTooltip: vi.fn().mockResolvedValue(undefined),
    deleteTooltip: vi.fn().mockResolvedValue(undefined),
    removeTooltipOccurrence: vi.fn().mockResolvedValue(undefined),
  } as unknown as ScholarWorkspaceService
}

function createWidget(
  options: ScholarPaperWidgetOptions,
  html?: string,
  title?: string,
): ScholarPaperWidgetClass {
  let widget: ScholarPaperWidgetClass | undefined
  act(() => {
    widget = new ScholarPaperWidget(
      createStore(snapshot(options.paperId, html, title)),
      { error: vi.fn() } as never,
      { render: vi.fn() } as never,
      options,
      { select: vi.fn() } as never,
    )
  })
  widgets.push(widget!)
  return widget!
}

function renderWidget(widget: ScholarPaperWidgetClass) {
  const node = (widget as unknown as { render(): React.ReactNode }).render()
  return render(<>{node}</>)
}

function installSearchRoot(widget: ScholarPaperWidgetClass, text: string): HTMLElement {
  widget.node.innerHTML = `
    <div class="scholar-reader-scroll">
      <article class="html-renderer">${text}</article>
    </div>
  `
  return widget.node.querySelector<HTMLElement>('.html-renderer')!
}

describe('ScholarPaperWidget', () => {
  it('selects the applied semantic tooltip when its entity is clicked', () => {
    const value = snapshot(
      'paper-a',
      '<p><span class="kg-entity" data-entity-id="entity-attention">attention</span></p>',
    )
    value.tooltipsByPaperId['paper-a'] = [{
      id: 'tooltip-attention',
      paper_id: 'paper-a',
      entity_id: 'entity-attention',
      dom_node_id: null,
      target_text: 'attention',
      content: 'A mechanism that weights relevant input elements.',
      is_pinned: false,
      display_order: null,
      created_at: '2026-07-15T00:00:00Z',
      updated_at: '2026-07-15T00:00:00Z',
    }]
    const store = createStore(value)
    const annotations = { select: vi.fn() } as unknown as ScholarAnnotationService
    let widget: ScholarPaperWidgetClass | undefined
    act(() => {
      widget = new ScholarPaperWidget(
        store,
        { error: vi.fn() } as never,
        { render: vi.fn() } as never,
        { paperId: 'paper-a', label: 'Paper A' },
        annotations,
      )
    })
    widgets.push(widget!)
    renderWidget(widget!)

    fireEvent.click(screen.getByText('attention'))

    expect(store.setActiveEntity).toHaveBeenCalledWith('paper-a', 'entity-attention')
    expect(annotations.select).toHaveBeenCalledWith('paper-a', 'tooltip-attention')
  })

  it('does not select an entity when an ordinary article element is clicked', () => {
    const value = snapshot('paper-a', '<p data-id="paragraph-1">Paragraph</p>')
    const store = createStore(value)
    const annotations = { select: vi.fn() } as unknown as ScholarAnnotationService
    let widget: ScholarPaperWidgetClass | undefined
    act(() => {
      widget = new ScholarPaperWidget(
        store,
        { error: vi.fn() } as never,
        { render: vi.fn() } as never,
        { paperId: 'paper-a', label: 'Paper A' },
        annotations,
      )
    })
    widgets.push(widget!)
    const view = renderWidget(widget!)

    fireEvent.click(view.container.querySelector('[data-id="paragraph-1"]')!)

    expect(store.setActiveEntity).not.toHaveBeenCalled()
    expect(annotations.select).not.toHaveBeenCalled()
  })

  it('truncates a long paper title in the tab and preserves it in the caption', async () => {
    const longTitle = 'This is a very very long paper title that should definitely be truncated in the tab label because it is just too long'
    const widget = createWidget(
      { paperId: 'paper-a', label: 'Paper A' },
      '<p>Paper body</p>',
      longTitle,
    )

    await act(async () => {
      ;(widget as unknown as { loadPaper(): void }).loadPaper()
      await Promise.resolve()
    })

    expect(widget.title.label.length).toBeLessThan(longTitle.length)
    expect(widget.title.label).toContain('…')
    expect(widget.title.caption).toBe(longTitle)
  })

  it('keeps the Abstract text at body size and gives the paper side padding', () => {
    const widget = createWidget(
      { paperId: 'paper-a', label: 'Paper A' },
      '<p>Body text</p><div class="ltx_abstract">Abstract text</div>',
    )
    const view = renderWidget(widget)
    const css = view.container.querySelector('style')?.textContent ?? ''

    expect(css).toMatch(/\.ltx_abstract\s*{[^}]*font-size:\s*1rem/)
    expect(css).toMatch(/\.html-renderer\s*{[^}]*padding-(left|right|inline)/)
  })

  it('renders the paper at full height without the embedded search toolbar', () => {
    const widget = createWidget({ paperId: 'paper-a', label: 'Paper A' }, '<p>Paper body</p>')
    const view = renderWidget(widget)

    expect(screen.getByText('Paper body')).toBeInTheDocument()
    expect(view.container.querySelector('.scholar-reader-toolbar')).not.toBeInTheDocument()
    expect(view.container.querySelector('.scholar-search-bar')).not.toBeInTheDocument()
    expect(view.container.querySelector('.scholar-reader-scroll')).toBeInTheDocument()
  })

  it('exposes one stable controller and publishes its snapshot changes', () => {
    vi.useFakeTimers()
    const widget = createWidget({ paperId: 'paper-a', label: 'Paper A' })
    const root = installSearchRoot(widget, 'Needle and another needle')
    const controller = widget.getSearchController()
    const listener = vi.fn()
    widget.onDidChangeSearchState(listener)

    expect(widget.getSearchController()).toBe(controller)
    widget.openSearch()
    widget.setSearchQuery('needle')
    vi.advanceTimersByTime(100)

    expect(widget.getSearchSnapshot()).toEqual(expect.objectContaining({
      isOpen: true,
      query: 'needle',
      totalMatches: 2,
    }))
    expect(root.querySelectorAll('mark.search-highlight')).toHaveLength(2)
    expect(listener).toHaveBeenCalled()
  })

  it('keeps search and highlights isolated between two paper widgets', () => {
    vi.useFakeTimers()
    const widgetA = createWidget({ paperId: 'paper-a', label: 'Paper A' })
    const widgetB = createWidget({ paperId: 'paper-b', label: 'Paper B' })
    const rootA = installSearchRoot(widgetA, 'Shared shared')
    const rootB = installSearchRoot(widgetB, 'Shared in the other paper')

    widgetA.openSearch()
    widgetA.setSearchQuery('shared')
    vi.advanceTimersByTime(100)

    expect(widgetA.getSearchSnapshot().totalMatches).toBe(2)
    expect(widgetB.getSearchSnapshot().totalMatches).toBe(0)
    expect(rootA.querySelectorAll('mark')).toHaveLength(2)
    expect(rootB.querySelectorAll('mark')).toHaveLength(0)
  })

  it('refreshes an open query after the article root is replaced', () => {
    vi.useFakeTimers()
    const widget = createWidget({ paperId: 'paper-a', label: 'Paper A' })
    const oldRoot = installSearchRoot(widget, 'alpha')
    widget.openSearch()
    widget.setSearchQuery('alpha')
    vi.advanceTimersByTime(100)
    expect(oldRoot.querySelectorAll('mark')).toHaveLength(1)

    const nextRoot = installSearchRoot(widget, 'alpha and alpha')
    widget.refreshSearch()

    expect(oldRoot.querySelectorAll('mark')).toHaveLength(0)
    expect(nextRoot.querySelectorAll('mark')).toHaveLength(2)
    expect(widget.getSearchSnapshot().totalMatches).toBe(2)
  })

  it('cleans highlights and stops publishing when disposed', () => {
    vi.useFakeTimers()
    const widget = createWidget({ paperId: 'paper-a', label: 'Paper A' })
    const root = installSearchRoot(widget, 'cleanup cleanup')
    const listener = vi.fn()
    widget.onDidChangeSearchState(listener)
    widget.openSearch()
    widget.setSearchQuery('cleanup')
    vi.advanceTimersByTime(100)
    const callsBeforeDispose = listener.mock.calls.length

    act(() => {
      widget.dispose()
    })
    widget.getSearchController().setQuery('other')

    expect(root.querySelectorAll('mark')).toHaveLength(0)
    expect(listener).toHaveBeenCalledTimes(callsBeforeDispose)
  })
})