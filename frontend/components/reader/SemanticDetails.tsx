'use client'

import { ArrowLeft, MessageCircleQuestion } from 'lucide-react'
import { wrapBareMath } from '../../lib/inline-math'
import type {
  EquationDetails,
  SemanticSelection,
  SemanticSubjectDetails,
} from '../../lib/semantic-api'
import type { SemanticTextEditor } from './EditableSemanticText'
import { EquationLens } from './EquationLens'
import { EvidenceLocations } from './EvidenceLocations'
import { LatexText } from './LatexText'
import { SemanticSubjectSummary } from './SemanticSubjectSummary'

export type ExplanationShortcut = 'deeper' | 'simpler' | 'example' | 'connections'

interface SemanticDetailsProps {
  selection: SemanticSelection
  subjectDetails?: SemanticSubjectDetails | null
  equationDetails?: EquationDetails | null
  loading?: boolean
  error?: string | null
  /**
   * Enables replacing the agent's wording with the reader's own, in place. The
   * agent can misread a symbol, and the correction belongs where the text is
   * read rather than in a second card next to it.
   */
  editor?: SemanticTextEditor
  onBack?: () => void
  onAskAboutEntity?: () => void
  onRequestExplanation?: (shortcut: ExplanationShortcut) => void
  onNavigate?: (domNodeId: string) => void
}

const EXPLANATION_SHORTCUTS: Array<{ id: ExplanationShortcut; label: string }> = [
  { id: 'deeper', label: 'Deeper' },
  { id: 'simpler', label: 'Simpler' },
  { id: 'example', label: 'Example' },
  { id: 'connections', label: 'Connections' },
]


/**
 * The lens for whatever is selected: an equation, a term, a relation, a quote.
 *
 * Every branch is dressed by the shared `semantic-lens-*` classes rather than
 * by Tailwind utilities. The two branches a reader compares most - a term and
 * an equation - otherwise end up with different heading sizes, different
 * spacing, and slate text that ignores the active theme; and because the Theia
 * bundle ships Tailwind's utilities without its preflight, an unreset `h3` also
 * kept the browser's own margin there, showing up as a gap above the term.
 */
export function SemanticDetails({
  selection,
  subjectDetails,
  equationDetails,
  loading = false,
  error,
  editor,
  onBack,
  onAskAboutEntity,
  onRequestExplanation,
  onNavigate,
}: SemanticDetailsProps) {
  const askAboutEntityButton = onAskAboutEntity ? (
    <button
      type="button"
      className="semantic-lens-ask"
      aria-label="Ask about this entity"
      title="Ask about this entity"
      onClick={onAskAboutEntity}
    >
      <MessageCircleQuestion size={16} aria-hidden="true" />
    </button>
  ) : undefined
  const explanationShortcuts = subjectDetails?.explanation && onRequestExplanation ? (
    <div
      className="semantic-lens-explanation-actions"
      role="group"
      aria-label={`Explore the explanation of ${subjectDetails.subject.label}`}
    >
      <span className="semantic-lens-explanation-label">Explore this explanation</span>
      <div className="semantic-lens-explanation-shortcuts">
        {EXPLANATION_SHORTCUTS.map(shortcut => (
          <button
            key={shortcut.id}
            type="button"
            className="semantic-lens-explanation-shortcut"
            onClick={() => onRequestExplanation(shortcut.id)}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div className="semantic-lens-panel" data-testid="semantic-details">
      {onBack && (
        <button type="button" onClick={onBack} className="semantic-lens-back">
          <ArrowLeft size={14} /> Back
        </button>
      )}
      {loading && <p className="semantic-lens-status">Loading details…</p>}
      {error && <p className="semantic-lens-error">{error}</p>}
      {!loading && !error && selection.kind === 'equation' && equationDetails && (
        <EquationLens details={equationDetails} onNavigate={onNavigate} editor={editor} />
      )}
      {!loading && !error && (selection.kind === 'occurrence' || selection.kind === 'node') && subjectDetails && (
        <>
          {subjectDetails.defining_equation ? (
            <EquationLens
              details={subjectDetails.defining_equation}
              definedSubject={subjectDetails}
              definedSubjectTitleAction={askAboutEntityButton}
              onNavigate={onNavigate}
              editor={editor}
            />
          ) : (
            <div className="semantic-lens" data-testid="semantic-subject">
              <SemanticSubjectSummary
                details={subjectDetails}
                editor={editor}
                titleAction={askAboutEntityButton}
              />
              <EvidenceLocations
                evidence={subjectDetails.evidence}
                redundantQuote={subjectDetails.subject.label}
                onNavigate={onNavigate}
              />
            </div>
          )}
          {explanationShortcuts}
        </>
      )}
      {!loading && !error && selection.kind === 'edge' && (
        <div className="semantic-lens">
          <h3 className="semantic-lens-title">{selection.sourceLabel} → {selection.targetLabel}</h3>
          <p className="semantic-lens-text">{selection.relationshipType.replaceAll('_', ' ')}</p>
          {selection.qualifiers && selection.qualifiers.length > 0 && (
            <p className="semantic-lens-muted">{selection.qualifiers.join(', ')}</p>
          )}
        </div>
      )}
      {!loading && !error && selection.kind === 'evidence' && (
        <p className="semantic-lens-text">
          <LatexText text={wrapBareMath(selection.evidence.source.quote)} />
        </p>
      )}
    </div>
  )
}
