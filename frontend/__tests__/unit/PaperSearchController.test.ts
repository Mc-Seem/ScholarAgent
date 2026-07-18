import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPaperSearchController } from '@/components/reader/paper-search-controller'

function createPaperRoot(text: string): HTMLDivElement {
  const root = document.createElement('div')
  root.innerHTML = `<article class="html-renderer">${text}</article>`
  document.body.appendChild(root)
  return root
}

function searchContainer(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.html-renderer')!
}

describe('PaperSearchController', () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('finds case-insensitive literal matches only inside its scoped root', () => {
    const activeRoot = createPaperRoot('Needle and another needle')
    const inactiveRoot = createPaperRoot('Needle in another paper')
    const controller = createPaperSearchController({
      getSearchRoot: () => searchContainer(activeRoot),
      debounceMs: 0,
    })

    controller.open()
    controller.setQuery('NEEDLE')

    expect(controller.getSnapshot()).toEqual(expect.objectContaining({
      isOpen: true,
      query: 'NEEDLE',
      currentMatchIndex: 0,
      totalMatches: 2,
    }))
    expect(activeRoot.querySelectorAll('mark.search-highlight')).toHaveLength(2)
    expect(activeRoot.querySelectorAll('mark.search-highlight-current')).toHaveLength(1)
    expect(inactiveRoot.querySelectorAll('mark.search-highlight')).toHaveLength(0)

    controller.dispose()
  })

  it('navigates forward and backward cyclically while keeping one current match', () => {
    const root = createPaperRoot('one one one')
    const controller = createPaperSearchController({
      getSearchRoot: () => searchContainer(root),
      debounceMs: 0,
    })
    controller.open()
    controller.setQuery('one')

    controller.previous()
    expect(controller.getSnapshot().currentMatchIndex).toBe(2)
    expect(root.querySelector('mark.search-highlight-current')?.textContent).toBe('one')

    controller.next()
    expect(controller.getSnapshot().currentMatchIndex).toBe(0)
    controller.next()
    expect(controller.getSnapshot().currentMatchIndex).toBe(1)
    expect(root.querySelectorAll('mark.search-highlight-current')).toHaveLength(1)

    controller.dispose()
  })

  it('reports empty and no-match queries without changing unrelated DOM', () => {
    const root = createPaperRoot('<strong>Alpha</strong> beta')
    const controller = createPaperSearchController({
      getSearchRoot: () => searchContainer(root),
      debounceMs: 0,
    })
    controller.open()

    controller.setQuery('missing')
    expect(controller.getSnapshot()).toEqual(expect.objectContaining({
      currentMatchIndex: 0,
      totalMatches: 0,
    }))
    expect(root.querySelectorAll('mark')).toHaveLength(0)

    controller.setQuery('   ')
    expect(controller.getSnapshot()).toEqual(expect.objectContaining({
      query: '   ',
      currentMatchIndex: 0,
      totalMatches: 0,
    }))
    expect(root.querySelector('strong')?.textContent).toBe('Alpha')

    controller.dispose()
  })

  it('cleans highlights on close, root replacement, and dispose', () => {
    let root: HTMLElement | null = createPaperRoot('first first')
    const firstContainer = searchContainer(root)
    const controller = createPaperSearchController({
      getSearchRoot: () => root ? searchContainer(root) : null,
      debounceMs: 0,
    })
    controller.open()
    controller.setQuery('first')
    expect(firstContainer.querySelectorAll('mark')).toHaveLength(2)

    root = createPaperRoot('second second')
    controller.setQuery('second')
    expect(firstContainer.querySelectorAll('mark')).toHaveLength(0)
    expect(searchContainer(root).querySelectorAll('mark')).toHaveLength(2)

    controller.close()
    expect(searchContainer(root).querySelectorAll('mark')).toHaveLength(0)
    expect(controller.getSnapshot()).toEqual(expect.objectContaining({
      isOpen: false,
      query: '',
      currentMatchIndex: 0,
      totalMatches: 0,
    }))

    controller.open()
    controller.setQuery('second')
    controller.dispose()
    expect(searchContainer(root).querySelectorAll('mark')).toHaveLength(0)
  })

  it('handles a missing root and refreshes when content becomes available', () => {
    let root: HTMLDivElement | null = null
    const controller = createPaperSearchController({
      getSearchRoot: () => root && searchContainer(root),
      debounceMs: 0,
    })
    controller.open()
    controller.setQuery('ready')
    expect(controller.getSnapshot().totalMatches).toBe(0)

    root = createPaperRoot('ready when mounted')
    controller.refresh()
    expect(controller.getSnapshot().totalMatches).toBe(1)

    controller.dispose()
  })

  it('publishes changed snapshots and increments focus requests on repeated open', () => {
    const root = createPaperRoot('alpha')
    const controller = createPaperSearchController({
      getSearchRoot: () => searchContainer(root),
      debounceMs: 0,
    })
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    controller.open()
    const firstFocusRequest = controller.getSnapshot().focusRequestId
    controller.open()
    expect(controller.getSnapshot().focusRequestId).toBe(firstFocusRequest + 1)

    controller.setQuery('alpha')
    const callsAfterSearch = listener.mock.calls.length
    controller.setQuery('alpha')
    expect(listener).toHaveBeenCalledTimes(callsAfterSearch)

    unsubscribe()
    controller.close()
    expect(listener).toHaveBeenCalledTimes(callsAfterSearch)
    controller.dispose()
  })
})