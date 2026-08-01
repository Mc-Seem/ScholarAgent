import { describe, expect, it } from 'vitest'

import { toMathSource, wrapBareMath } from '@/lib/inline-math'

describe('wrapBareMath', () => {
  it('wraps a bare symbol with a subscript', () => {
    expect(wrapBareMath('token in the rejected sequence y_l')).toBe(
      'token in the rejected sequence $y_l$',
    )
  })

  it('wraps braced subscripts and LaTeX commands', () => {
    expect(wrapBareMath('the ratio \\pi_{\\theta} over y_{i,t}')).toBe(
      'the ratio $\\pi_{\\theta}$ over $y_{i,t}$',
    )
  })

  it('keeps punctuation outside the math delimiters', () => {
    expect(wrapBareMath('bounded by m_s, then x^2.')).toBe('bounded by $m_s$, then $x^2$.')
  })

  it('leaves prose and snake_case identifiers alone', () => {
    expect(wrapBareMath('the reward model uses paper_role as a field')).toBe(
      'the reward model uses paper_role as a field',
    )
  })

  it('never touches fragments that already carry delimiters', () => {
    expect(wrapBareMath('already $y_l$ and \\(x_i\\) and $$z_k$$')).toBe(
      'already $y_l$ and \\(x_i\\) and $$z_k$$',
    )
  })

  it('returns empty input unchanged', () => {
    expect(wrapBareMath('')).toBe('')
  })
})

describe('toMathSource', () => {
  it('adds inline delimiters to a bare expression', () => {
    expect(toMathSource('y_l')).toBe('\\(y_l\\)')
  })

  it('replaces existing delimiters instead of nesting them', () => {
    expect(toMathSource('$y_l$')).toBe('\\(y_l\\)')
    expect(toMathSource('$$y_l$$', true)).toBe('\\[y_l\\]')
  })

  it('does not mistake a lone dollar pair for a delimited expression', () => {
    expect(toMathSource('$')).toBe('\\($\\)')
  })
})
