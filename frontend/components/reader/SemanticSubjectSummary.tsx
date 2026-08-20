'use client'

import { wrapBareMath } from '../../lib/inline-math'
import type { DefinedSubjectDetails } from '../../lib/semantic-api'
import { EditableSemanticText } from './EditableSemanticText'
import type { SemanticTextEditor } from './EditableSemanticText'
import { LatexText } from './LatexText'

interface SemanticSubjectSummaryProps {
  details: DefinedSubjectDetails
  editor?: SemanticTextEditor
}

const renderMath = (text: string) => <LatexText text={wrapBareMath(text)} />

/** The shared definition header used from both sides of an equation link. */
export function SemanticSubjectSummary({ details, editor }: SemanticSubjectSummaryProps) {
  const { subject, explanation } = details
  return (
    <>
      <header className="semantic-lens-header">
        <h3 className="semantic-lens-title">
          <LatexText text={wrapBareMath(subject.label)} />
        </h3>
        {(explanation || editor) && (
          <EditableSemanticText
            as="p"
            className="semantic-lens-text"
            subjectId={subject.stable_id}
            agentText={explanation?.base_content ?? ''}
            label={`description of ${subject.label}`}
            targetText={subject.label}
            renderText={renderMath}
            editor={editor}
          />
        )}
      </header>
      {subject.roles.length > 0 && (
        <div className="semantic-chips">
          {subject.roles.map(role => (
            <span key={role} className="semantic-chip">
              {role.replaceAll('_', ' ')}
            </span>
          ))}
        </div>
      )}
    </>
  )
}