import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { LatexText } from '@/components/reader/LatexText'

// Mock MathJax
const mockTypesetPromise = vi.fn()
const mockTypesetClear = vi.fn()

describe('LatexText', () => {
  beforeEach(() => {
    mockTypesetPromise.mockResolvedValue(undefined)
    ;(window as any).MathJax = {
      typesetPromise: mockTypesetPromise,
      typesetClear: mockTypesetClear,
      startup: {
        promise: Promise.resolve()
      }
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (window as any).MathJax
  })

  it('renders plain text without math', () => {
    const { container } = render(<LatexText text="Hello, world!" />)

    expect(container.textContent).toBe('Hello, world!')
  })

  it('converts single dollar signs to inline math delimiters', () => {
    const { container } = render(<LatexText text="Let $x = 5$ be a number" />)

    expect(container.textContent).toContain('\\(')
    expect(container.textContent).toContain('\\)')
    expect(container.textContent).toBe('Let \\(x = 5\\) be a number')
  })

  it('preserves double-dollar display math delimiters', () => {
    const { container} = render(<LatexText text="Formula: $$E = mc^2$$" />)

    expect(container.textContent).toBe('Formula: $$E = mc^2$$')
  })

  it('handles mixed inline and display math', () => {
    const text = 'Inline $a + b$ and display $$c = d$$'

    const { container } = render(<LatexText text={text} />)

    expect(container.textContent).toBe('Inline \\(a + b\\) and display $$c = d$$')
  })

  it('calls MathJax.typesetPromise on mount', async () => {
    render(<LatexText text="Test $x$" />)

    await waitFor(() => {
      expect(mockTypesetPromise).toHaveBeenCalledTimes(1)
    })
  })

  it('preserves typeset output when a parent rerenders with the same text', async () => {
    mockTypesetPromise.mockImplementation(async ([element]: [HTMLElement]) => {
      const output = document.createElement('mjx-container')
      output.textContent = 'typeset math'
      element.replaceChildren(output)
    })

    const { container, rerender } = render(
      <div data-revision="first">
        <LatexText text="Test $x$" />
      </div>,
    )

    await waitFor(() => {
      expect(container.querySelector('mjx-container')).not.toBeNull()
    })

    rerender(
      <div data-revision="second">
        <LatexText text="Test $x$" />
      </div>,
    )

    expect(container.querySelector('mjx-container')).not.toBeNull()
    expect(container.textContent).toBe('typeset math')
  })

  it('retypesetshtml when text changes', async () => {
    const { rerender } = render(<LatexText text="First $x$" />)

    await waitFor(() => {
      expect(mockTypesetPromise).toHaveBeenCalledTimes(1)
    })

    rerender(<LatexText text="Second $y$" />)

    await waitFor(() => {
      expect(mockTypesetPromise).toHaveBeenCalledTimes(2)
    })
  })

  it('clears typeset previews before React removes them', async () => {
    const connectedDuringClear: boolean[] = []
    mockTypesetPromise.mockImplementation(async ([element]: [HTMLElement]) => {
      const output = document.createElement('mjx-container')
      output.textContent = 'typeset math'
      element.replaceChildren(output)
    })
    mockTypesetClear.mockImplementation(([element]: [HTMLElement]) => {
      connectedDuringClear.push(element.isConnected)
    })

    const { rerender } = render(
      <span>
        <LatexText text="Target $x$" />
        <span> — </span>
        <LatexText text="Comment $y$" />
      </span>,
    )

    await waitFor(() => {
      expect(mockTypesetPromise).toHaveBeenCalledTimes(2)
    })

    expect(() => rerender(
      <span>
        Target $x$ — Comment $y$
      </span>,
    )).not.toThrow()
    expect(mockTypesetClear).toHaveBeenCalledTimes(2)
    expect(connectedDuringClear).toEqual([true, true])
  })

  it('applies custom className', () => {
    const { container } = render(
      <LatexText text="Test" className="custom-class" />
    )

    const span = container.querySelector('span')
    expect(span).toHaveClass('custom-class')
  })

  it('renders HTML-like input as text', () => {
    const { container } = render(<LatexText text={'Use <tag> & "quotes" with $x$'} />)

    expect(container.textContent).toBe('Use <tag> & "quotes" with \\(x\\)')
    expect(container.querySelector('tag')).toBeNull()
  })

  it('handles complex LaTeX expressions', () => {
    const text = 'Using $\\mathbb{R}$ and $\\mathcal{F}$'

    const { container } = render(<LatexText text={text} />)

    expect(container.textContent).toContain('\\mathbb{R}')
    expect(container.textContent).toContain('\\mathcal{F}')
  })

  it('handles multiple inline math expressions', () => {
    const text = 'Let $a = 1$, $b = 2$, and $c = 3$'

    const { container } = render(<LatexText text={text} />)

    const result = container.textContent || ''
    expect(result).toContain('\\(a = 1\\)')
    expect(result).toContain('\\(b = 2\\)')
    expect(result).toContain('\\(c = 3\\)')
  })

  it('handles display math delimiters', () => {
    const text = '$$x + y = z$$'

    const { container } = render(<LatexText text={text} />)

    expect(container.textContent).toBe('$$x + y = z$$')
  })

  it('leaves escaped and unmatched dollar signs as literal text', () => {
    const escaped = render(<LatexText text={'Price: \\$5; formula $x$'} />)
    const unmatched = render(<LatexText text="Unmatched $" />)

    expect(escaped.container.textContent).toBe('Price: \\$5; formula \\(x\\)')
    expect(unmatched.container.textContent).toBe('Unmatched $')
  })

  it('handles MathJax not available gracefully', async () => {
    delete (window as any).MathJax

    const { container } = render(<LatexText text="Test $x$" />)

    // Should render without crashing
    expect(container.textContent).toContain('\\(x\\)')
    expect(mockTypesetPromise).not.toHaveBeenCalled()
  })

  it('typesets after MathJax becomes ready', async () => {
    delete (window as any).MathJax
    render(<LatexText text="Late $x$" />)

    ;(window as any).MathJax = {
      typesetPromise: mockTypesetPromise,
      startup: { promise: Promise.resolve() },
    }
    window.dispatchEvent(new CustomEvent('MathJaxReady'))

    await waitFor(() => {
      expect(mockTypesetPromise).toHaveBeenCalledTimes(1)
    })
  })

  it('handles MathJax typesetting errors gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTypesetPromise.mockRejectedValueOnce(new Error('Typesetting failed'))

    render(<LatexText text="Test $x$" />)

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[LatexText] MathJax typesetting error:',
        expect.any(Error)
      )
    })

    consoleErrorSpy.mockRestore()
  })

  it('waits for MathJax startup promise if available', async () => {
    let resolveStartup: () => void
    const startupPromise = new Promise<void>((resolve) => {
      resolveStartup = resolve
    })

    ;(window as any).MathJax = {
      typesetPromise: mockTypesetPromise,
      startup: {
        promise: startupPromise
      }
    }

    render(<LatexText text="Test $x$" />)

    // Should not have called typeset yet
    expect(mockTypesetPromise).not.toHaveBeenCalled()

    // Resolve startup
    resolveStartup!()

    await waitFor(() => {
      expect(mockTypesetPromise).toHaveBeenCalled()
    })
  })

  it('handles empty text', () => {
    const { container } = render(<LatexText text="" />)

    expect(container.textContent).toBe('')
  })

  it('handles text with only dollar signs', () => {
    const { container } = render(<LatexText text="$$$" />)

    // Should handle edge case without crashing
    expect(container).toBeInTheDocument()
  })

  it('preserves text outside of math delimiters', () => {
    const text = 'Normal text before $x$ and after'

    const { container } = render(<LatexText text={text} />)

    expect(container.textContent).toContain('Normal text before')
    expect(container.textContent).toContain('and after')
  })
})
