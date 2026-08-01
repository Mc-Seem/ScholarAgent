import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EquationLens } from '@/components/reader/EquationLens'
import type { EquationDetails } from '@/lib/semantic-api'


const typesetPromise = vi.fn().mockResolvedValue(undefined)

const details: EquationDetails = {
  schema_version: '3.0',
  equation: {
    stable_id: 'equation:eq-kto',
    equation_id: 'eq-kto',
    latex: 'L_{KTO}=\\mathbb{E}_{(x,y)\\sim D}[w(y)]',
    summary: 'KTO loss function',
    paper_role: 'objective',
    notation_ids: ['notation:loss', 'notation:weight'],
    object_ids: [],
    evidence_ids: ['obs-1'],
  },
  notation: [
    {
      stable_id: 'notation:loss',
      symbol: 'L_{KTO}',
      meaning: 'KTO loss',
      scope_id: 'eq-kto',
      units: null,
      constraints: [],
      object_ids: [],
      evidence_ids: ['obs-1'],
    },
    {
      stable_id: 'notation:weight',
      symbol: 'w(y)',
      meaning: 'per-sample value weight',
      scope_id: 'eq-kto',
      units: 'unitless',
      constraints: ['non-negative'],
      object_ids: [],
      evidence_ids: ['obs-1'],
    },
  ],
  objects: [],
  evidence: [{
    id: 'obs-1',
    kind: 'equation',
    label: 'KTO loss',
    payload: {},
    confidence: 0.9,
    source: {
      paper_id: 'paper-a',
      section_id: 'sec-1',
      section_title: 'Losses',
      dom_node_id: 'p-1',
      equation_id: 'eq-kto',
      quote: 'We define the KTO loss as follows.',
      char_start: null,
      char_end: null,
    },
  }],
}

describe('EquationLens', () => {
  beforeEach(() => {
    typesetPromise.mockClear()
    ;(window as typeof window & { MathJax?: object }).MathJax = {
      typesetPromise,
      typesetClear: vi.fn(),
      startup: { promise: Promise.resolve() },
    }
  })

  afterEach(() => {
    delete (window as typeof window & { MathJax?: object }).MathJax
  })

  it('typesets the equation and notation instead of showing raw LaTeX', async () => {
    render(<EquationLens details={details} />)

    expect(screen.getByTestId('equation-math')).toHaveTextContent('\\[L_{KTO}=')
    expect(screen.getByTestId('notation-symbol-notation:loss')).toHaveTextContent('\\(L_{KTO}\\)')
    await waitFor(() => expect(typesetPromise).toHaveBeenCalledTimes(3))
  })

  it('uses compact notation rows and keeps source evidence collapsed', () => {
    render(<EquationLens details={details} />)

    expect(screen.getByTestId('equation-notation')).toHaveClass('equation-lens-notation')
    expect(screen.getAllByTestId('equation-notation-item')).toHaveLength(2)
    expect(screen.getByText('Sources (1)').closest('details')).not.toHaveAttribute('open')
  })
})