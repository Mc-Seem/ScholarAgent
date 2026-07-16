import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScholarAnnotationPreview } from '@/theia/scholar-extension/src/browser/scholar-annotation-preview'

describe('ScholarAnnotationPreview', () => {
  afterEach(() => {
    delete (window as any).MathJax
  })

  it('renders the target first and the annotation as a muted LaTeX preview', () => {
    ;(window as any).MathJax = { typesetPromise: vi.fn().mockResolvedValue(undefined) }

    const { container } = render(
      <ScholarAnnotationPreview
        targetText="Objective $f(x)$"
        annotation="Check $x^2$ carefully"
      />,
    )

    expect(container.querySelector('.scholar-tree-comment-target')?.textContent)
      .toBe('Objective \\(f(x)\\)')
    expect(container.querySelector('.scholar-tree-comment-separator')).toHaveTextContent('—')
    expect(container.querySelector('.scholar-tree-comment-content')?.textContent)
      .toBe('Check \\(x^2\\) carefully')
  })

  it('omits the separator when only one preview part is available', () => {
    const { container } = render(
      <ScholarAnnotationPreview targetText="Attached passage" />,
    )

    expect(container).toHaveTextContent('Attached passage')
    expect(container.querySelector('.scholar-tree-comment-separator')).toBeNull()
    expect(container.querySelector('.scholar-tree-comment-content')).toBeNull()
  })
})