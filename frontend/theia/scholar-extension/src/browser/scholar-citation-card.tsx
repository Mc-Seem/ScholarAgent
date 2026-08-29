import * as React from 'react'

import type { CitationApi, CitationCard, CitationResolution } from '../../../../lib/citation-api'
import { paperLabel } from './scholar-react'

export interface ScholarCitationCardProps {
  paperId: string
  citeKey: string
  anchor: { x: number; y: number }
  api: CitationApi
  onOpenPaper: (targetPaperId: string) => void
  onShowFragment: (targetPaperId: string, resolution: CitationResolution) => void
  onImportArxiv: (arxivId: string) => void
  onClose: () => void
}

/**
 * Popover shown when a `[N]` citation is clicked in the reader: the
 * bibliography text plus, when the reference is matched in the library,
 * actions to open the cited paper or jump to the referenced fragment.
 * A detected arXiv id that is not in the library offers an import instead.
 */
export function ScholarCitationCard({
  paperId,
  citeKey,
  anchor,
  api,
  onOpenPaper,
  onShowFragment,
  onImportArxiv,
  onClose,
}: ScholarCitationCardProps): React.ReactElement {
  const [card, setCard] = React.useState<CitationCard | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [resolving, setResolving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setCard(null)
    setError(null)
    api.getCitationCard(paperId, citeKey).then(result => {
      if (!cancelled) setCard(result)
    }).catch(reason => {
      if (!cancelled) setError(errorMessage(reason))
    })
    return () => {
      cancelled = true
    }
  }, [api, citeKey, paperId])

  const showFragment = React.useCallback(() => {
    const target = card?.matched_paper
    if (!target || resolving) return
    setResolving(true)
    setError(null)
    api.resolveCitation(paperId, citeKey, target.id).then(resolution => {
      onShowFragment(target.id, resolution)
      onClose()
    }).catch(reason => {
      setResolving(false)
      setError(errorMessage(reason))
    })
  }, [api, card, citeKey, onClose, onShowFragment, paperId, resolving])

  const matched = card?.matched_paper ?? null
  const importableArxivId = !matched && card?.arxiv_id ? card.arxiv_id : null

  return (
    <div
      className="scholar-citation-card"
      role="dialog"
      aria-label={`Citation ${citeKey}`}
      style={{ left: anchor.x, top: anchor.y }}
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="scholar-citation-card-header">
        <span className="scholar-citation-card-title">Citation</span>
        <button
          type="button"
          className="scholar-citation-card-close"
          aria-label="Close citation card"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {!card && !error && <div className="scholar-citation-card-status">Loading citation…</div>}
      {error && <div className="scholar-citation-card-error">{error}</div>}
      {card && (
        <>
          <div className="scholar-citation-card-bib">{card.bib_text}</div>
          {matched && (
            <div className="scholar-citation-card-match">
              In your library: {paperLabel(matched.filename, matched.title ?? undefined)}
            </div>
          )}
          <div className="scholar-citation-card-actions">
            {matched && (
              <>
                <button
                  type="button"
                  className="scholar-toolbar-button"
                  onClick={() => {
                    onOpenPaper(matched.id)
                    onClose()
                  }}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="scholar-toolbar-button"
                  disabled={resolving}
                  onClick={showFragment}
                >
                  {resolving ? 'Locating fragment…' : 'Show referenced fragment'}
                </button>
              </>
            )}
            {importableArxivId && (
              <button
                type="button"
                className="scholar-toolbar-button"
                onClick={() => {
                  onImportArxiv(importableArxivId)
                  onClose()
                }}
              >
                Import from arXiv
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
