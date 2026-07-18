import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPaperSearchController,
  type PaperSearchController,
} from '@/components/reader/paper-search-controller'
import {
  ScholarPaperFindToolbar,
  type ScholarPaperFindTarget,
} from '@/theia/scholar-extension/src/browser/scholar-paper-find-toolbar'

const controllers: PaperSearchController[] = []

afterEach(() => {
  cleanup()
  for (const controller of controllers.splice(0)) {
    controller.dispose()
  }
  document.body.replaceChildren()
})

function createTarget(text: string): {
  target: ScholarPaperFindTarget
  controller: PaperSearchController
  root: HTMLDivElement
} {
  const root = document.createElement('div')
  root.tabIndex = 0
  const article = document.createElement('article')
  article.className = 'html-renderer'
  article.textContent = text
  root.appendChild(article)
  document.body.appendChild(root)

  const controller = createPaperSearchController({
    getSearchRoot: () => article,
    debounceMs: 0,
  })
  controllers.push(controller)
  const target: ScholarPaperFindTarget = {
    node: root,
    getSearchController: () => controller,
    setSearchQuery: vi.fn(query => controller.setQuery(query)),
    nextSearchMatch: vi.fn(() => controller.next()),
    previousSearchMatch: vi.fn(() => controller.previous()),
    closeSearch: vi.fn(() => controller.close()),
  }
  return { target, controller, root }
}

describe('ScholarPaperFindToolbar', () => {
  it('focuses and selects the query when opened or requested again', () => {
    const { target, controller } = createTarget('alpha beta')
    controller.open()
    controller.setQuery('alpha')
    render(<ScholarPaperFindToolbar target={target} />)

    const input = screen.getByRole('searchbox', { name: 'Find in paper' }) as HTMLInputElement
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(5)

    input.blur()
    act(() => controller.open())

    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(5)
  })

  it('updates match count and handles cyclic Enter navigation', () => {
    const { target, controller } = createTarget('alpha alpha alpha')
    controller.open()
    controller.setQuery('alpha')
    render(<ScholarPaperFindToolbar target={target} />)
    const input = screen.getByRole('searchbox', { name: 'Find in paper' })

    expect(screen.getByText('1/3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(target.nextSearchMatch).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2/3')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(target.previousSearchMatch).toHaveBeenCalledTimes(1)
    expect(screen.getByText('1/3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(screen.getByText('3/3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('shows a disabled no-match state and returns focus to the paper on Escape', () => {
    const { target, controller, root } = createTarget('alpha')
    controller.open()
    controller.setQuery('missing')
    render(<ScholarPaperFindToolbar target={target} />)
    const input = screen.getByRole('searchbox', { name: 'Find in paper' })

    expect(screen.getByText('0/0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(target.closeSearch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('searchbox', { name: 'Find in paper' })).not.toBeInTheDocument()
    expect(root).toHaveFocus()
  })
})