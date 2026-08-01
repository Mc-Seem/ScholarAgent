'use client'

import type { KnowledgeGraphEvidence, KnowledgeGraphSource } from '../../lib/knowledge-graph-api'
import type { SemanticEvidence } from '../../lib/semantic-api'
import { wrapBareMath } from '../../lib/inline-math'
import { LatexText } from './LatexText'

type EvidenceLike = SemanticEvidence | KnowledgeGraphEvidence

interface EvidenceLocationsProps {
  evidence: EvidenceLike[]
  /**
   * Quote that merely repeats the subject itself. Equation observations are
   * anchored with the equation LaTeX as their quote, so showing it would just
   * duplicate the formula already rendered above.
   */
  redundantQuote?: string
  title?: string
  onNavigate?: (domNodeId: string) => void
}

interface LocationEntry {
  key: string
  place: string
  kind: string
  quote: string | null
  domNodeId: string | null
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function placeLabel(source: KnowledgeGraphSource): string {
  const section = source.section_title?.trim()
  if (section) {
    return section
  }
  if (source.equation_id) {
    return 'Displayed equation'
  }
  return 'This paper'
}

export function toLocationEntries(
  evidence: EvidenceLike[],
  redundantQuote?: string,
): LocationEntry[] {
  const redundant = redundantQuote ? normalize(redundantQuote) : ''
  const entries: LocationEntry[] = []
  const seen = new Set<string>()

  for (const item of evidence) {
    const source = item.source
    const quote = normalize(source.quote ?? '')
    const visibleQuote = quote && quote !== redundant ? quote : null
    const entry: LocationEntry = {
      key: 'id' in item ? item.id : item.observation_id,
      place: placeLabel(source),
      kind: (item.kind ?? '').replaceAll('_', ' '),
      quote: visibleQuote,
      domNodeId: source.dom_node_id,
    }
    const identity = `${entry.place}|${entry.kind}|${entry.quote ?? ''}|${entry.domNodeId ?? ''}`
    if (seen.has(identity)) {
      continue
    }
    seen.add(identity)
    entries.push(entry)
  }

  return entries
}

/**
 * Lists where a subject is grounded in the paper.
 *
 * Every entry names its place first (section, or the displayed equation when a
 * section is unknown) and only then the supporting quote, if that quote adds
 * anything beyond the subject itself.
 */
export function EvidenceLocations({
  evidence,
  redundantQuote,
  title = 'Appears in',
  onNavigate,
}: EvidenceLocationsProps) {
  const entries = toLocationEntries(evidence, redundantQuote)
  if (entries.length === 0) {
    return null
  }

  return (
    <section className="semantic-locations" data-testid="evidence-locations">
      <h4 className="semantic-locations-title">
        {title} <span>{entries.length}</span>
      </h4>
      <ul className="semantic-locations-list">
        {entries.map(entry => (
          <li key={entry.key}>
            <button
              type="button"
              className="semantic-location"
              data-testid="evidence-location"
              disabled={!entry.domNodeId}
              onClick={() => entry.domNodeId && onNavigate?.(entry.domNodeId)}
            >
              <span className="semantic-location-place">{entry.place}</span>
              {entry.kind && <span className="semantic-location-kind">{entry.kind}</span>}
              {entry.quote && (
                <span className="semantic-location-quote">
                  <LatexText text={wrapBareMath(entry.quote)} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
