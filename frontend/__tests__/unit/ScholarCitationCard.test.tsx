import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CitationApi, CitationCard, CitationResolution } from '@/lib/citation-api'
import { ScholarCitationCard } from '@/theia/scholar-extension/src/browser/scholar-citation-card'

function card(overrides: Partial<CitationCard> = {}): CitationCard {
  return {
    cite_key: 'bib1',
    bib_text: 'Vaswani et al. Attention Is All You Need. 2017.',
    dom_node_id: 'bib-node-1',
    arxiv_id: null,
    matched_paper: null,
    has_cached_resolution: false,
    ...overrides,
  }
}

function resolution(overrides: Partial<CitationResolution> = {}): CitationResolution {
  return {
    paper_id: 'paper-a',
    cite_key: 'bib1',
    target_paper_id: 'paper-b',
    target_kind: 'passage',
    target_section_id: 'sec-1',
    target_dom_node_id: 'p-b-1',
    quote: 'scaled dot-product attention',
    confidence: 'high',
    resolved_at: '2026-08-29T00:00:00Z',
    cached: false,
  }
}

function createApi(cardValue: CitationCard, resolveValue?: CitationResolution): CitationApi {
  return {
    getCitationCard: vi.fn().mockResolvedValue(cardValue),
    resolveCitation: resolveValue
      ? vi.fn().mockResolvedValue(resolveValue)
      : vi.fn().mockRejectedValue(new Error('resolve failed')),
  }
}

function renderCard(api: CitationApi, handlers: {
  onOpenPaper?: (targetPaperId: string) => void
  onShowFragment?: (targetPaperId: string, value: CitationResolution) => void
  onImportArxiv?: (arxivId: string) => void
  onClose?: () => void
} = {}) {
  return render(
    <ScholarCitationCard
      paperId="paper-a"
      citeKey="bib1"
      anchor={{ x: 10, y: 20 }}
      api={api}
      onOpenPaper={handlers.onOpenPaper ?? vi.fn()}
      onShowFragment={handlers.onShowFragment ?? vi.fn()}
      onImportArxiv={handlers.onImportArxiv ?? vi.fn()}
      onClose={handlers.onClose ?? vi.fn()}
    />,
  )
}

describe('ScholarCitationCard', () => {
  it('shows only the bibliography text when the reference is not matched', async () => {
    renderCard(createApi(card()))

    expect(await screen.findByText('Vaswani et al. Attention Is All You Need. 2017.'))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show referenced fragment' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import from arXiv' })).not.toBeInTheDocument()
  })

  it('offers Open and Show referenced fragment for a library match', async () => {
    const api = createApi(card({
      matched_paper: { id: 'paper-b', title: 'Attention Is All You Need', filename: 'b.tar.gz' },
    }), resolution())
    renderCard(api)

    expect(await screen.findByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show referenced fragment' })).toBeInTheDocument()
    expect(screen.getByText(/In your library: Attention Is All You Need/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import from arXiv' })).not.toBeInTheDocument()
  })

  it('offers an arXiv import when the id is detected but the paper is not in the library', async () => {
    const onImportArxiv = vi.fn()
    const onClose = vi.fn()
    renderCard(createApi(card({ arxiv_id: '1706.03762' })), { onImportArxiv, onClose })

    await userEvent.click(await screen.findByRole('button', { name: 'Import from arXiv' }))

    expect(onImportArxiv).toHaveBeenCalledWith('1706.03762')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the matched paper and closes the card', async () => {
    const onOpenPaper = vi.fn()
    const onClose = vi.fn()
    const api = createApi(card({
      matched_paper: { id: 'paper-b', title: null, filename: 'b.tar.gz' },
    }))
    renderCard(api, { onOpenPaper, onClose })

    await userEvent.click(await screen.findByRole('button', { name: 'Open' }))

    expect(onOpenPaper).toHaveBeenCalledWith('paper-b')
    expect(onClose).toHaveBeenCalled()
  })

  it('resolves the fragment with a busy state and hands the result to the reader', async () => {
    const onShowFragment = vi.fn()
    const onClose = vi.fn()
    let resolveRequest: (value: CitationResolution) => void = () => undefined
    const api: CitationApi = {
      getCitationCard: vi.fn().mockResolvedValue(card({
        matched_paper: { id: 'paper-b', title: 'B', filename: 'b.tar.gz' },
      })),
      resolveCitation: vi.fn().mockReturnValue(
        new Promise<CitationResolution>(resolve => {
          resolveRequest = resolve
        }),
      ),
    }
    renderCard(api, { onShowFragment, onClose })

    await userEvent.click(await screen.findByRole('button', { name: 'Show referenced fragment' }))
    expect(screen.getByRole('button', { name: 'Locating fragment…' })).toBeDisabled()

    resolveRequest(resolution())
    await waitFor(() => expect(onShowFragment).toHaveBeenCalledWith('paper-b', resolution()))
    expect(api.resolveCitation).toHaveBeenCalledWith('paper-a', 'bib1', 'paper-b')
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the card open and shows the error when the resolve fails', async () => {
    const onShowFragment = vi.fn()
    const api = createApi(card({
      matched_paper: { id: 'paper-b', title: 'B', filename: 'b.tar.gz' },
    }))
    renderCard(api, { onShowFragment })

    await userEvent.click(await screen.findByRole('button', { name: 'Show referenced fragment' }))

    expect(await screen.findByText('resolve failed')).toBeInTheDocument()
    expect(onShowFragment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Show referenced fragment' })).toBeEnabled()
  })

  it('shows the card load error instead of actions', async () => {
    const api: CitationApi = {
      getCitationCard: vi.fn().mockRejectedValue(new Error('Paper has no extracted citations')),
      resolveCitation: vi.fn(),
    }
    renderCard(api)

    expect(await screen.findByText('Paper has no extracted citations')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
  })

  it('closes via the close button', async () => {
    const onClose = vi.fn()
    renderCard(createApi(card()), { onClose })

    await userEvent.click(screen.getByRole('button', { name: 'Close citation card' }))

    expect(onClose).toHaveBeenCalled()
  })
})
