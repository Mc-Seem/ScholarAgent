'use client'

import { ArrowLeft } from 'lucide-react'
import { wrapBareMath } from '../../lib/inline-math'
import type {
  EquationDetails,
  SemanticSelection,
  SemanticSubjectDetails,
} from '../../lib/semantic-api'
import { EditableSemanticText } from './EditableSemanticText'
import type { SemanticTextEditor } from './EditableSemanticText'
import { EquationLens } from './EquationLens'
import { EvidenceLocations } from './EvidenceLocations'
import { LatexText } from './LatexText'

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
  onNavigate?: (domNodeId: string) => void
}

const renderMath = (text: string) => <LatexText text={wrapBareMath(text)} />

export function SemanticDetails({
  selection,
  subjectDetails,
  equationDetails,
  loading = false,
  error,
  editor,
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
        <EquationLens details={equationDetails} onNavigate={onNavigate} editor={editor} />
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
            {(subjectDetails.explanation || editor) && (
              <EditableSemanticText
                as="p"
                className="mt-2 text-sm leading-6 text-slate-700"
                subjectId={subjectDetails.subject.stable_id}
                agentText={subjectDetails.explanation?.base_content ?? ''}
                label={`description of ${subjectDetails.subject.label}`}
                targetText={subjectDetails.subject.label}
                renderText={renderMath}
                editor={editor}
              />
            )}
          </div>
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
