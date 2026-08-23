import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EditableSemanticText } from '@/components/reader/EditableSemanticText'
import { SemanticDetails } from '@/components/reader/SemanticDetails'
import type {
  EquationDetails,
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
    defining_equation: null,
    ...overrides,
  }
}

const equationSelection: SemanticSelection = {
  kind: 'equation',
  equationId: 'eq-kto',
  label: 'KTO loss function',
}

const equationDetails: EquationDetails = {
  schema_version: '3.0',
  equation: {
    stable_id: 'equation:eq-kto',
    equation_id: 'eq-kto',
    latex: 'L_{KTO}=1',
    summary: 'KTO loss function',
    notation_ids: [],
    object_ids: [],
    defined_object_id: null,
    evidence_ids: [],
  },
  notation: [],
  objects: [],
  evidence: [],
  defined_subject: null,
}

describe('SemanticDetails', () => {
  it('marks only a lone Edit or Add control for out-of-flow hiding', () => {
    const editor = {
      notesBySubjectId: {},
      onSave: () => {},
      onRestore: () => {},
    }
    const { rerender } = render(
      <EditableSemanticText
        subjectId="artifact:kto"
        agentText="Agent explanation"
        label="explanation of KTO"
        editor={editor}
      />,
    )

    expect(screen.getByTestId('semantic-editable-edit').parentElement)
      .toHaveClass('semantic-editable-actions-single')

    rerender(
      <EditableSemanticText
        subjectId="artifact:kto"
        agentText="Agent explanation"
        label="explanation of KTO"
        editor={{ ...editor, notesBySubjectId: { 'artifact:kto': 'Reader explanation' } }}
      />,
    )

    expect(screen.getByTestId('semantic-editable-badge')).toBeInTheDocument()
    expect(screen.getByTestId('semantic-editable-edit').parentElement)
      .not.toHaveClass('semantic-editable-actions-single')
  })
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

  it('dresses a term and an equation in the same shell', () => {
    // The two are read in the same side view, one after the other, so a
    // different heading size or rhythm between them reads as a bug.
    const term = render(<SemanticDetails selection={selection} subjectDetails={subjectDetails()} />)
    const termHeading = screen.getByRole('heading', { name: 'KTO' })
    expect(termHeading).toHaveClass('semantic-lens-title')
    expect(termHeading.closest('.semantic-lens')).not.toBeNull()
    term.unmount()

    render(
      <SemanticDetails selection={equationSelection} equationDetails={equationDetails} />,
    )
    const equationHeading = screen.getByRole('heading', { name: 'KTO loss function' })
    expect(equationHeading).toHaveClass('semantic-lens-title')
    expect(equationHeading.closest('.semantic-lens')).not.toBeNull()
  })

  it('shows a term with its one defining formula and notation in the same lens', () => {
    const linkedEquation: EquationDetails = {
      ...equationDetails,
      equation: {
        ...equationDetails.equation,
        defined_object_id: 'artifact:kto',
        notation_ids: ['notation:kto-loss'],
      },
      notation: [{
        stable_id: 'notation:kto-loss',
        symbol: 'L_{KTO}',
        meaning: 'KTO loss',
        scope_id: 'eq-kto',
        units: null,
        constraints: [],
        object_ids: [],
        evidence_ids: [],
      }],
    }

    render(
      <SemanticDetails
        selection={selection}
        subjectDetails={subjectDetails({ defining_equation: linkedEquation })}
      />,
    )

    expect(screen.getByRole('heading', { name: 'KTO' })).toBeInTheDocument()
    expect(screen.getByText('A preference optimization method that needs no pairs.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'KTO loss function' })).toBeInTheDocument()
    expect(screen.getByTestId('equation-math')).toHaveTextContent('L_{KTO}=1')
    expect(screen.getByTestId('equation-notation')).toHaveTextContent('KTO loss')
  })

  it('shows the same term definition when the defining formula is selected directly', () => {
    const defined = subjectDetails()
    render(
      <SemanticDetails
        selection={equationSelection}
        equationDetails={{
          ...equationDetails,
          equation: { ...equationDetails.equation, defined_object_id: 'artifact:kto' },
          defined_subject: {
            subject: defined.subject,
            explanation: defined.explanation,
            occurrences: defined.occurrences,
            evidence: defined.evidence,
            occurrence_total: defined.occurrence_total,
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'KTO' })).toBeInTheDocument()
    expect(screen.getByText('A preference optimization method that needs no pairs.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'KTO loss function' })).toBeInTheDocument()
  })

  it('leaves Tailwind colour and spacing utilities out of the panel', () => {
    // The Theia bundle loads Tailwind's utilities without its preflight, so a
    // utility-styled heading keeps the browser's own margin there and slate
    // text ignores the active theme: that is how the term view drifted away
    // from the equation view in the first place.
    const { container } = render(
      <SemanticDetails selection={selection} subjectDetails={subjectDetails()} onBack={() => {}} />,
    )

    const classes = [...container.querySelectorAll('[class]')]
      .flatMap(element => (element.getAttribute('class') ?? '').split(/\s+/))
      .filter(Boolean)
    expect(classes).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(text|bg|border)-(slate|red|indigo)-/)]),
    )
    expect(classes).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(space-y|p|mt|mb|text)-\w+$/)]),
    )
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

  it('states the margins the lens needs, instead of inheriting a reset', () => {
    // Tailwind's preflight is absent from the Theia stylesheet, so a heading or
    // paragraph that does not set its own margin keeps the browser default -
    // the unexplained gap above a term.
    const theia = fs.readFileSync(
      path.resolve(process.cwd(), 'theia/scholar-extension/src/browser/style/scholar.css'),
      'utf-8',
    )
    expect(theia).not.toMatch(/tailwindcss\/preflight/)

    expect(css.match(/\.semantic-lens-title \{[^}]*\}/)?.[0] ?? '').toMatch(/margin: 0;/)
    expect(css.match(/\.semantic-lens-text \{[^}]*\}/)?.[0] ?? '').toMatch(/margin: 0;/)
  })

  it('keeps one rule per shared part of the lens', () => {
    // Equation and term headings, and the two section headings, used to be
    // separate copies; copies are what let the halves drift apart.
    expect(css).not.toMatch(/\.equation-lens-title/)
    expect(css).not.toMatch(/\.equation-lens-meaning/)
    expect(css).toMatch(/\.semantic-lens-section-title,\s*\n\.semantic-locations-title \{/)
  })

  it('draws chips with a border rather than a pale fill', () => {
    const chip = css.match(/\.semantic-chip \{[^}]*\}/)?.[0] ?? ''

    expect(chip).toMatch(/background: transparent/)
    expect(chip).toMatch(/border: 1px solid/)
  })

  it('hides the edit buttons until the reader points at the text they belong to', () => {
    // A notation table has one row per symbol; permanently visible buttons put a
    // ragged column of `Edit` labels next to the meanings.
    const action = css.match(/\.semantic-editable-action \{[^}]*\}/)?.[0] ?? ''
    const single = css.match(/\.semantic-editable-actions-single \{[^}]*\}/)?.[0] ?? ''

    expect(action).toMatch(/opacity: 0;/)
    expect(single).toMatch(/position: absolute;/)
    expect(css).toMatch(/\.semantic-editable:hover \.semantic-editable-action/)
    expect(css).toMatch(/\.semantic-editable:focus-within \.semantic-editable-action/)
    expect(css).toMatch(/@media \(hover: none\)/)
  })

  it('does not apply the formula-title pill background to hidden edit actions', () => {
    expect(css).toMatch(
      /\.semantic-lens-section-title > span:not\(\.semantic-editable-actions\)/,
    )
    expect(css).not.toMatch(/\.semantic-lens-section-title span,/)
  })

  it('dims a busy button through colour, so it does not reappear while hidden', () => {
    const disabled = css.match(/\.semantic-editable-action:disabled \{[^}]*\}/)?.[0] ?? ''

    expect(disabled).not.toMatch(/opacity/)
  })
})
