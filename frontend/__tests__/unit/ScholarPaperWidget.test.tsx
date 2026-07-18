import { act, cleanup, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { PaperDetail } from '@/hooks/usePapers'
import type { ReaderWorkspaceSnapshot } from '@/lib/reader-workspace-store'
import type {
  ScholarPaperWidget as ScholarPaperWidgetClass,
  ScholarPaperWidgetOptions,
} from '@/theia/scholar-extension/src/browser/scholar-paper-widget'
import type { ScholarWorkspaceService } from '@/theia/scholar-extension/src/browser/scholar-workspace-service'

vi.mock('@/components/reader/HTMLRenderer', () => ({
  HTMLRenderer: ({ html }: { html: string }) => (
    <article
      className="html-renderer"
      data-testid="html-renderer"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ),
}))

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

function paperDetail(id: string, html = `<p>${id}</p>`): PaperDetail {
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
    paper_metadata: { title: id },
    has_knowledge_graph: false,
  }
}

function snapshot(paperId: string, html?: string): ReaderWorkspaceSnapshot {
  return {
    papers: [],
    libraryLoading: false,
    libraryError: null,
    activePaperId: paperId,
    openPaperIds: [paperId],
    loadingPaperIds: [],
    papersById: { [paperId]: paperDetail(paperId, html) },
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
    createTooltip: vi.fn().mockResolvedValue(undefined),
    updateTooltip: vi.fn().mockResolvedValue(undefined),
    deleteTooltip: vi.fn().mockResolvedValue(undefined),
    removeTooltipOccurrence: vi.fn().mockResolvedValue(undefined),
  } as unknown as ScholarWorkspaceService
}

function createWidget(
  options: ScholarPaperWidgetOptions,
  html?: string,
): ScholarPaperWidgetClass {
  let widget: ScholarPaperWidgetClass | undefined
  act(() => {
    widget = new ScholarPaperWidget(
      createStore(snapshot(options.paperId, html)),
      { error: vi.fn() } as never,
      { render: vi.fn() } as never,
      options,
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

describe('ScholarPaperWidget native search bridge', () => {
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