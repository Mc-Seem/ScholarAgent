import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import SearchBar from '@/components/reader/SearchBar'

function ScopedSearch({ onClose = vi.fn() }: { onClose?: () => void }) {
  const activePaperRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <article className="html-renderer" data-testid="inactive-paper">
        Needle in another tab
      </article>
      <div ref={activePaperRef} data-testid="active-paper">
        <article className="html-renderer">Needle and another needle</article>
      </div>
      <SearchBar
        isOpen
        onClose={onClose}
        searchRootRef={activePaperRef}
        placement="inline"
      />
    </>
  )
}

describe('SearchBar', () => {
  it('highlights matches only inside the active paper view', async () => {
    render(<ScopedSearch />)

    fireEvent.change(screen.getByPlaceholderText('Find in paper...'), {
      target: { value: 'needle' },
    })

    await waitFor(() => expect(screen.getByText('1/2')).toBeInTheDocument())
    expect(screen.getByTestId('active-paper').querySelectorAll('mark.search-highlight')).toHaveLength(2)
    expect(screen.getByTestId('inactive-paper').querySelectorAll('mark.search-highlight')).toHaveLength(0)
  })

  it('reports no matches without modifying either paper', async () => {
    render(<ScopedSearch />)

    fireEvent.change(screen.getByPlaceholderText('Find in paper...'), {
      target: { value: 'absent phrase' },
    })

    await waitFor(() => expect(screen.getByText('No matches')).toBeInTheDocument())
    expect(document.querySelectorAll('mark.search-highlight')).toHaveLength(0)
  })

  it('clears scoped highlights when closed', async () => {
    const onClose = vi.fn()
    render(<ScopedSearch onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('Find in paper...'), {
      target: { value: 'needle' },
    })
    await waitFor(() => expect(screen.getByText('1/2')).toBeInTheDocument())

    act(() => fireEvent.click(screen.getByTitle('Close (Esc)')))

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByTestId('active-paper').querySelectorAll('mark.search-highlight')).toHaveLength(0)
  })
})