'use client'

import { ArrowLeft, Pencil } from 'lucide-react'
import { wrapBareMath } from '../../lib/inline-math'
import type {
  EquationDetails,
  SemanticSelection,
  SemanticSubjectDetails,
} from '../../lib/semantic-api'
import { EquationLens } from './EquationLens'
import { EvidenceLocations } from './EvidenceLocations'
import { LatexText } from './LatexText'

/** A saved tooltip shown next to the semantic details of the same subject. */
export interface SemanticNote {
  id: string
  content: string
  targetText?: string | null
}

interface SemanticDetailsProps {
  selection: SemanticSelection
  subjectDetails?: SemanticSubjectDetails | null
  equationDetails?: EquationDetails | null
  loading?: boolean
  error?: string | null
  /**
   * The reader's own explanation of the selected term or equation. Rendered in
   * the same card so that both kinds of explanation live in one place.
   */
  note?: SemanticNote | null
  onEditNote?: (note: SemanticNote) => void
  onBack?: () => void
  onNavigate?: (domNodeId: string) => void
}

function NoteCard({ note, onEditNote }: { note: SemanticNote; onEditNote?: (note: SemanticNote) => void }) {
  return (
    <section className="semantic-note" data-testid="semantic-note">
      <h4 className="semantic-note-title">
        Your note
        {onEditNote && (
          <button
            type="button"
            className="semantic-note-edit"
            data-testid="semantic-note-edit"
            onClick={() => onEditNote(note)}
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </h4>
      <div className="semantic-note-content">
        <LatexText text={wrapBareMath(note.content)} />
      </div>
    </section>
  )
}

export function SemanticDetails({
  selection,
  subjectDetails,
  equationDetails,
  loading = false,
  error,
  note,
  onEditNote,
  onBack,
  onNavigate,
}: SemanticDetailsProps) {
  return (
    <div className="h-full overflow-y-auto p-3" data-testid="semantic-details">
      {onBack && (
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-slate-600">
          <ArrowLeft size={14} /> Back
        </button>
      )}
      {loading && <p className="text-sm text-slate-500">Loading details…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && selection.kind === 'equation' && equationDetails && (
        <>
          <EquationLens details={equationDetails} onNavigate={onNavigate} />
          {note && <NoteCard note={note} onEditNote={onEditNote} />}
        </>
      )}
      {!loading && !error && (selection.kind === 'occurrence' || selection.kind === 'node') && subjectDetails && (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {subjectDetails.subject.kind}
            </div>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">
              <LatexText text={wrapBareMath(subjectDetails.subject.label)} />
            </h3>
            {subjectDetails.explanation && (
              <p className="mt-2 text-sm leading-6 text-slate-700">
                <LatexText text={wrapBareMath(subjectDetails.explanation.base_content)} />
              </p>
            )}
          </div>
          {note && <NoteCard note={note} onEditNote={onEditNote} />}
          {subjectDetails.subject.roles.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {subjectDetails.subject.roles.map(role => (
                <span key={role} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {role.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          )}
          <EvidenceLocations
            evidence={subjectDetails.evidence}
            redundantQuote={subjectDetails.subject.label}
            onNavigate={onNavigate}
          />
        </div>
      )}
      {!loading && !error && selection.kind === 'edge' && (
        <div className="space-y-3 text-sm text-slate-700">
          <h3 className="font-semibold text-slate-900">{selection.sourceLabel} → {selection.targetLabel}</h3>
          <p>{selection.relationshipType.replaceAll('_', ' ')}</p>
          {selection.qualifiers && selection.qualifiers.length > 0 && (
            <p className="text-xs text-slate-500">{selection.qualifiers.join(', ')}</p>
          )}
        </div>
      )}
      {!loading && !error && selection.kind === 'evidence' && (
        <p className="text-sm leading-6 text-slate-700">
          <LatexText text={wrapBareMath(selection.evidence.source.quote)} />
        </p>
      )}
    </div>
  )
}
