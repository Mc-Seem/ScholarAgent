'use client'

import { toMathSource, wrapBareMath } from '../../lib/inline-math'
import type { DefinedSubjectDetails, EquationDetails } from '../../lib/semantic-api'
import { EditableSemanticText } from './EditableSemanticText'
import type { SemanticTextEditor } from './EditableSemanticText'
import { EvidenceLocations } from './EvidenceLocations'
import { LatexText } from './LatexText'
import { SemanticSubjectSummary } from './SemanticSubjectSummary'

interface EquationLensProps {
  details: EquationDetails
  /** Supplied by the term endpoint; direct equation reads carry the same data. */
  definedSubject?: DefinedSubjectDetails | null
  definedSubjectTitleAction?: React.ReactNode
  onNavigate?: (domNodeId: string) => void
  /** Enables replacing the agent's wording for the equation and its symbols. */
  editor?: SemanticTextEditor
}

const renderMath = (text: string) => <LatexText text={wrapBareMath(text)} />

export function EquationLens({
  details,
  definedSubject,
  definedSubjectTitleAction,
  onNavigate,
  editor,
}: EquationLensProps) {
  const { equation, notation, objects, evidence } = details
  const definition = definedSubject ?? details.defined_subject
  const relatedObjects = objects.filter(item => item.stable_id !== definition?.subject.stable_id)
  return (
    <div className="semantic-lens" data-testid="equation-lens">
      {definition && (
        <SemanticSubjectSummary
          details={definition}
          editor={editor}
          titleAction={definedSubjectTitleAction}
        />
      )}
      <header className="semantic-lens-header">
        <EditableSemanticText
          as={definition ? 'h4' : 'h3'}
          className={definition ? 'semantic-lens-section-title' : 'semantic-lens-title'}
          subjectId={equation.stable_id}
          agentText={equation.summary}
          label="equation name"
          targetText={equation.summary}
          renderText={renderMath}
          editor={editor}
        />
      </header>
      <div className="equation-lens-formula" data-testid="equation-math">
        <LatexText text={toMathSource(equation.latex, true)} />
      </div>
      {notation.length > 0 && (
        <section>
          <h4 className="semantic-lens-section-title">
            Notation <span>{notation.length}</span>
          </h4>
          <dl className="equation-lens-notation" data-testid="equation-notation">
            {notation.map(item => (
              <div key={item.stable_id} className="equation-lens-notation-item" data-testid="equation-notation-item">
                <dt
                  className="equation-lens-symbol"
                  data-testid={`notation-symbol-${item.stable_id}`}
                >
                  <LatexText text={toMathSource(item.symbol)} />
                </dt>
                <EditableSemanticText
                  as="dd"
                  className="semantic-lens-text"
                  subjectId={item.stable_id}
                  agentText={item.meaning}
                  label={`meaning of ${item.symbol}`}
                  targetText={item.symbol}
                  renderText={renderMath}
                  editor={editor}
                >
                  {(item.units || item.constraints.length > 0) && (
                    <span className="semantic-chips equation-lens-notation-meta">
                      {item.units && (
                        <LatexText className="semantic-chip" text={wrapBareMath(item.units)} />
                      )}
                      {item.constraints.map(constraint => (
                        <LatexText
                          key={constraint}
                          className="semantic-chip"
                          text={wrapBareMath(constraint)}
                        />
                      ))}
                    </span>
                  )}
                </EditableSemanticText>
              </div>
            ))}
          </dl>
        </section>
      )}
      {relatedObjects.length > 0 && (
        <div className="equation-lens-related">
          <span className="equation-lens-related-label">Related</span>
          {relatedObjects.map(item => (
            <LatexText
              key={item.stable_id}
              className="equation-lens-related-item"
              text={wrapBareMath(item.label)}
            />
          ))}
        </div>
      )}
      {definition && (
        <EvidenceLocations
          evidence={definition.evidence}
          redundantQuote={definition.subject.label}
          onNavigate={onNavigate}
        />
      )}
      <EvidenceLocations
        evidence={evidence}
        redundantQuote={equation.latex}
        title={definition ? 'Formula location' : undefined}
        onNavigate={onNavigate}
      />
    </div>
  )
}
