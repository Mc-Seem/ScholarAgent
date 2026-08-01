'use client'

import { ArrowLeft, ExternalLink } from 'lucide-react'
import type {
  EquationDetails,
  SemanticSelection,
  SemanticSubjectDetails,
} from '../../lib/semantic-api'
import { EquationLens } from './EquationLens'

interface SemanticDetailsProps {
  selection: SemanticSelection
  subjectDetails?: SemanticSubjectDetails | null
  equationDetails?: EquationDetails | null
  loading?: boolean
  error?: string | null
  onBack?: () => void
  onNavigate?: (domNodeId: string) => void
}

export function SemanticDetails({
  selection,
  subjectDetails,
  equationDetails,
  loading = false,
  error,
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
        <EquationLens details={equationDetails} onNavigate={onNavigate} />
      )}
      {!loading && !error && (selection.kind === 'occurrence' || selection.kind === 'node') && subjectDetails && (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {subjectDetails.subject.kind}
            </div>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{subjectDetails.subject.label}</h3>
            {subjectDetails.explanation && (
              <p className="mt-2 text-sm leading-6 text-slate-700">{subjectDetails.explanation.base_content}</p>
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
          <div className="space-y-2">
            {subjectDetails.evidence.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => item.source.dom_node_id && onNavigate?.(item.source.dom_node_id)}
                className="flex w-full items-start gap-2 rounded-md border border-slate-200 p-2 text-left text-xs text-slate-600 hover:bg-slate-50"
              >
                <ExternalLink size={12} className="mt-0.5 shrink-0" />
                {item.source.quote}
              </button>
            ))}
          </div>
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
        <p className="text-sm leading-6 text-slate-700">{selection.evidence.source.quote}</p>
      )}
    </div>
  )
}