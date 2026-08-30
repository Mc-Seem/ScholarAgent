'use client'

import { wrapBareMath } from '../../lib/inline-math'
import { LatexText } from './LatexText'

/** One aligned term in another paper of a reading set, ready to render. */
export interface OtherPaperTermLink {
  alignmentId: string
  readingSetId: string
  /** The other paper of the alignment pair, never the active one. */
  paperId: string
  subjectId: string
  paperTitle: string
  /** The other paper's own name for the active term. */
  label: string
  confidence: 'high' | 'medium' | 'low'
  status: 'auto' | 'confirmed'
  rationale: string | null
}

export interface SemanticLensOtherPapersProps {
  links: OtherPaperTermLink[]
  loading?: boolean
  /** Alignment whose confirm/reject request is in flight. */
  busyAlignmentId?: string | null
  onOpen: (link: OtherPaperTermLink) => void
  onConfirm: (link: OtherPaperTermLink) => void
  onReject: (link: OtherPaperTermLink) => void
}

/**
 * "In other papers": how the rest of the reading set names the active term.
 *
 * Rejected and stale alignments never reach this component - the caller keeps
 * them out of `links` - so every row is an actionable reading connection: open
 * the other paper at the term, or judge the link itself. The section renders
 * nothing when the active paper has no alignments, keeping single-paper
 * reading untouched.
 */
export function SemanticLensOtherPapers({
  links,
  loading = false,
  busyAlignmentId = null,
  onOpen,
  onConfirm,
  onReject,
}: SemanticLensOtherPapersProps) {
  if (!loading && links.length === 0) {
    return null
  }

  return (
    <section className="semantic-other-papers" data-testid="semantic-other-papers">
      <h4 className="semantic-locations-title">
        In other papers {links.length > 0 && <span>{links.length}</span>}
      </h4>
      {loading && links.length === 0 && (
        <p className="semantic-lens-status">Loading term links…</p>
      )}
      <ul className="semantic-other-papers-list">
        {links.map(link => {
          const busy = busyAlignmentId === link.alignmentId
          return (
            <li key={link.alignmentId} className="semantic-other-paper">
              <button
                type="button"
                className="semantic-location semantic-other-paper-open"
                data-testid="other-paper-open"
                title={link.rationale ?? undefined}
                onClick={() => onOpen(link)}
              >
                <span className="semantic-location-place">{link.paperTitle}</span>
                <span className="semantic-location-quote">
                  calls this <em><LatexText text={wrapBareMath(link.label)} /></em>
                </span>
              </button>
              <div className="semantic-other-paper-meta">
                <span
                  className={`semantic-confidence-badge semantic-confidence-${link.confidence}`}
                  data-testid="alignment-confidence"
                >
                  {link.confidence}
                </span>
                {link.status === 'confirmed' ? (
                  <span className="semantic-other-paper-confirmed" data-testid="alignment-confirmed">
                    Confirmed
                  </span>
                ) : (
                  <button
                    type="button"
                    className="semantic-other-paper-action"
                    data-testid="alignment-confirm"
                    disabled={busy}
                    onClick={() => onConfirm(link)}
                  >
                    Confirm
                  </button>
                )}
                <button
                  type="button"
                  className="semantic-other-paper-action"
                  data-testid="alignment-reject"
                  disabled={busy}
                  onClick={() => onReject(link)}
                >
                  Reject
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
