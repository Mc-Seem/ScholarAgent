import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SemanticDetails } from '@/components/reader/SemanticDetails'
import type {
  SemanticSelection,
  SemanticSubjectDetails,
} from '@/lib/semantic-api'

const selection: SemanticSelection = {
  kind: 'occurrence',
  occurrenceId: 'occ-1',
  subjectId: 'artifact:kto',
  label: 'KTO',
  scopeId: 'sec-1',
}

function subjectDetails(overrides: Partial<SemanticSubjectDetails> = {}): SemanticSubjectDetails {
  return {
    schema_version: '3.0',
    subject: {
      stable_id: 'artifact:kto',
      kind: 'artifact',
      label: 'KTO',
      aliases: ['Kahneman-Tversky Optimization'],
      roles: ['main_contribution', 'study_object'],
      facets: [],
      units: null,
      constraints: [],
      object_ids: [],
    },
    explanation: {
      stable_id: 'explanation:kto',
      subject_id: 'artifact:kto',
      base_content: 'A preference optimization method that needs no pairs.',
      expertise: 'intermediate',
      evidence_ids: ['obs-1'],
    },
    occurrences: [],
    evidence: [{
      id: 'obs-1',
      kind: 'artifact',
      label: 'KTO',
      payload: {},
      confidence: 0.9,
      source: {
        paper_id: 'paper-a',
        section_id: 'sec-1',
        section_title: 'Method',
        dom_node_id: 'p-1',
        equation_id: null,
        quote: 'We build on KTO, which drops the pairwise requirement.',
        char_start: null,
        char_end: null,
      },
    }],
    occurrence_total: 1,
    ...overrides,
  }
}

describe('SemanticDetails', () => {
  it('heads the panel with the term itself, without the internal kind', () => {
    render(<SemanticDetails selection={selection} subjectDetails={subjectDetails()} />)

    expect(screen.getByRole('heading', { name: 'KTO' })).toBeInTheDocument()
    // `artifact` is our taxonomy bucket, not something a reader asked to see.
    expect(screen.getByTestId('semantic-details')).not.toHaveTextContent(/artifact/i)
  })

  it('never repeats that kind once per location either', () => {
    render(<SemanticDetails selection={selection} subjectDetails={subjectDetails()} />)

    const location = screen.getByTestId('evidence-location')
    expect(location).toHaveTextContent('Method')
    expect(location).toHaveTextContent('We build on KTO')
    expect(location).not.toHaveTextContent(/artifact/i)
  })

  it('outlines the role tags instead of tinting them into the panel', () => {
    render(<SemanticDetails selection={selection} subjectDetails={subjectDetails()} />)

    const roles = screen.getAllByText(/main contribution|study object/)
    expect(roles).toHaveLength(2)
    for (const role of roles) {
      expect(role).toHaveClass('semantic-chip')
      expect(role.className).not.toMatch(/bg-/)
    }
  })
})

describe('semantic lens chrome', () => {
  const css = fs.readFileSync(
    path.resolve(process.cwd(), 'styles/reader-interactions.css'),
    'utf-8',
  )

  it('draws chips with a border rather than a pale fill', () => {
    const chip = css.match(/\.semantic-chip \{[^}]*\}/)?.[0] ?? ''

    expect(chip).toMatch(/background: transparent/)
    expect(chip).toMatch(/border: 1px solid/)
  })

  it('hides the edit buttons until the reader points at the text they belong to', () => {
    // A notation table has one row per symbol; permanently visible buttons put a
    // ragged column of `Edit` labels next to the meanings.
    const action = css.match(/\.semantic-editable-action \{[^}]*\}/)?.[0] ?? ''

    expect(action).toMatch(/opacity: 0;/)
    expect(css).toMatch(/\.semantic-editable:hover \.semantic-editable-action/)
    expect(css).toMatch(/\.semantic-editable:focus-within \.semantic-editable-action/)
    // A subject with no text at all would otherwise offer no visible way in.
    expect(css).toMatch(/:has\(\.semantic-editable-empty\) \.semantic-editable-action/)
  })

  it('dims a busy button through colour, so it does not reappear while hidden', () => {
    const disabled = css.match(/\.semantic-editable-action:disabled \{[^}]*\}/)?.[0] ?? ''

    expect(disabled).not.toMatch(/opacity/)
  })
})
