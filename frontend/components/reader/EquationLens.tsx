'use client'

import { toMathSource, wrapBareMath } from '../../lib/inline-math'
import type { EquationDetails } from '../../lib/semantic-api'
import { EditableSemanticText } from './EditableSemanticText'
import type { SemanticTextEditor } from './EditableSemanticText'
import { EvidenceLocations } from './EvidenceLocations'
import { LatexText } from './LatexText'

interface EquationLensProps {
  details: EquationDetails
  onNavigate?: (domNodeId: string) => void
  /** Enables replacing the agent's wording for the equation and its symbols. */
  editor?: SemanticTextEditor
}

const renderMath = (text: string) => <LatexText text={wrapBareMath(text)} />

export function EquationLens({ details, onNavigate, editor }: EquationLensProps) {
  const { equation, notation, objects, evidence } = details
  return (
    <div className="equation-lens" data-testid="equation-lens">
      <header className="equation-lens-header">
        <EditableSemanticText
          as="h3"
          className="equation-lens-title"
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
          <h4 className="equation-lens-section-title">
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
                  className="equation-lens-meaning"
                  subjectId={item.stable_id}
                  agentText={item.meaning}
                  label={`meaning of ${item.symbol}`}
                  targetText={item.symbol}
                  renderText={renderMath}
                  editor={editor}
                >
                  {(item.units || item.constraints.length > 0) && (
                    <span className="equation-lens-notation-meta">
                      {item.units && <LatexText text={wrapBareMath(item.units)} />}
                      {item.constraints.map(constraint => (
                        <LatexText key={constraint} text={wrapBareMath(constraint)} />
                      ))}
                    </span>
                  )}
                </EditableSemanticText>
              </div>
            ))}
          </dl>
        </section>
      )}
      {objects.length > 0 && (
        <div className="equation-lens-related">
          <span className="equation-lens-related-label">Related</span>
          {objects.map(item => (
            <LatexText
              key={item.stable_id}
              className="equation-lens-related-item"
              text={wrapBareMath(item.label)}
            />
          ))}
        </div>
      )}
      <EvidenceLocations
        evidence={evidence}
        redundantQuote={equation.latex}
        onNavigate={onNavigate}
      />
    </div>
  )
}
