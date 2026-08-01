'use client'

import type { EquationDetails } from '../../lib/semantic-api'
import { LatexText } from './LatexText'

interface EquationLensProps {
  details: EquationDetails
  onNavigate?: (domNodeId: string) => void
}

function mathSource(value: string, display = false): string {
  let source = value.trim()
  const delimiters: Array<[string, string]> = [
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$', '$'],
  ]
  for (const [opening, closing] of delimiters) {
    if (source.startsWith(opening) && source.endsWith(closing)) {
      source = source.slice(opening.length, -closing.length).trim()
      break
    }
  }
  return display ? `\\[${source}\\]` : `\\(${source}\\)`
}

export function EquationLens({ details, onNavigate }: EquationLensProps) {
  const { equation, notation, objects, evidence } = details
  return (
    <div className="equation-lens" data-testid="equation-lens">
      <header className="equation-lens-header">
        <div className="equation-lens-role">
          {equation.paper_role.replaceAll('_', ' ')}
        </div>
        <h3 className="equation-lens-title">{equation.summary}</h3>
      </header>
      <div className="equation-lens-formula" data-testid="equation-math">
        <LatexText text={mathSource(equation.latex, true)} />
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
                  <LatexText text={mathSource(item.symbol)} />
                </dt>
                <dd className="equation-lens-meaning">
                  <LatexText text={item.meaning} />
                  {(item.units || item.constraints.length > 0) && (
                    <span className="equation-lens-notation-meta">
                      {item.units && <span>{item.units}</span>}
                      {item.constraints.map(constraint => <span key={constraint}>{constraint}</span>)}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {objects.length > 0 && (
        <div className="equation-lens-related">
          <span>Related</span> {objects.map(item => item.label).join(', ')}
        </div>
      )}
      {evidence.length > 0 && (
        <details className="equation-lens-evidence">
          <summary>Sources ({evidence.length})</summary>
          <div>
            {evidence.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => item.source.dom_node_id && onNavigate?.(item.source.dom_node_id)}
              >
                {item.source.quote}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}