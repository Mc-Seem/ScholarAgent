import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MathJaxNode } from '@/components/reader/MathJaxNode'
import type { Element } from 'html-react-parser'

// Mock MathJax
const mockTypesetPromise = vi.fn()

describe('MathJaxNode', () => {
  beforeEach(() => {
    // Setup MathJax mock
    mockTypesetPromise.mockResolvedValue(undefined)
    ;(window as any).MathJax = {
      typesetPromise: mockTypesetPromise
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (window as any).MathJax
  })

  const createMathElement = (display?: string, equationId?: string): Element => ({
    type: 'tag',
    name: 'math',
    attribs: {
      xmlns: 'http://www.w3.org/1998/Math/MathML',
      ...(display && { display }),
      ...(equationId && { 'data-id': equationId }),
    },
    children: [
      {
        type: 'tag',
        name: 'mi',
        attribs: {},
        children: [{ type: 'text', data: 'x' }]
      }
    ]
  } as Element)

  it('renders inline math by default', () => {
    const mathElement = createMathElement()

    render(<MathJaxNode mathml={mathElement} />)

    const container = screen.getByText((content, element) => {
      return element?.classList.contains('math-inline') ?? false
    })

    expect(container).toBeInTheDocument()
    expect(container.tagName.toLowerCase()).toBe('span')
  })

  it('renders display math when display="block"', () => {
    const mathElement = createMathElement('block')

    render(<MathJaxNode mathml={mathElement} />)

    const container = screen.getByText((content, element) => {
      return element?.classList.contains('math-display') ?? false
    })

    expect(container).toBeInTheDocument()
    expect(container.tagName.toLowerCase()).toBe('div')
  })

  it('calls MathJax.typesetPromise on mount', async () => {
    const mathElement = createMathElement()

    render(<MathJaxNode mathml={mathElement} />)

    await waitFor(() => {
      expect(mockTypesetPromise).toHaveBeenCalledTimes(1)
    })
  })

  it('converts MathML element to string correctly', () => {
    const mathElement = createMathElement()

    const { container } = render(<MathJaxNode mathml={mathElement} />)

    const mathNode = container.querySelector('.mathjax-node')
    expect(mathNode).toHaveAttribute('data-mathml-source')

    const mathmlSource = mathNode?.getAttribute('data-mathml-source')
    expect(mathmlSource).toContain('<math')
    expect(mathmlSource).toContain('<mi>x</mi>')
    expect(mathmlSource).toContain('</math>')
  })

  it('applies opacity transition when rendered', async () => {
    const mathElement = createMathElement()

    const { container } = render(<MathJaxNode mathml={mathElement} />)

    const mathNode = container.querySelector('.mathjax-node') as HTMLElement

    // Initially should have reduced opacity
    expect(mathNode.style.opacity).toBe('0.5')

    // After MathJax renders, should be fully opaque
    await waitFor(() => {
      expect(mathNode.style.opacity).toBe('1')
    })
  })

  it('activates Equation Lens by click and keyboard without reacting to hover', () => {
    const onEquationSelect = vi.fn()
    render(
      <MathJaxNode
        mathml={createMathElement('block', 'eq-7')}
        onEquationSelect={onEquationSelect}
      />,
    )
    const equation = screen.getByRole('button', { name: 'Open details for equation eq-7' })

    fireEvent.mouseOver(equation)
    expect(onEquationSelect).not.toHaveBeenCalled()
    fireEvent.click(equation)
    fireEvent.keyDown(equation, { key: 'Enter' })
    fireEvent.keyDown(equation, { key: ' ' })

    expect(onEquationSelect).toHaveBeenCalledTimes(3)
    expect(onEquationSelect).toHaveBeenLastCalledWith('eq-7')
  })

  it('does not offer Equation Lens for inline math excluded from the semantic document', () => {
    const onEquationSelect = vi.fn()
    const { container } = render(
      <MathJaxNode
        mathml={createMathElement(undefined, 'inline-1')}
        onEquationSelect={onEquationSelect}
      />,
    )

    const equation = container.querySelector('.mathjax-node') as HTMLElement
    expect(equation).not.toHaveAttribute('role', 'button')
    expect(equation).not.toHaveAttribute('tabindex')

    fireEvent.click(equation)
    fireEvent.keyDown(equation, { key: 'Enter' })
    expect(onEquationSelect).not.toHaveBeenCalled()
  })

  it('handles MathJax not being available initially', async () => {
    // Remove MathJax
    delete (window as any).MathJax

    const mathElement = createMathElement()

    render(<MathJaxNode mathml={mathElement} />)

    // Should not error, should poll for MathJax
    expect(mockTypesetPromise).not.toHaveBeenCalled()

    // Add MathJax after a delay
    await waitFor(() => {
      ;(window as any).MathJax = {
        typesetPromise: mockTypesetPromise
      }
    })

    // Should eventually call typeset
    await waitFor(() => {
      expect(mockTypesetPromise).toHaveBeenCalled()
    }, { timeout: 2000 })
  })

  it('handles complex MathML with multiple children', () => {
    const complexMath: Element = {
      type: 'tag',
      name: 'math',
      attribs: { xmlns: 'http://www.w3.org/1998/Math/MathML' },
      children: [
        {
          type: 'tag',
          name: 'mrow',
          attribs: {},
          children: [
            {
              type: 'tag',
              name: 'msup',
              attribs: {},
              children: [
                { type: 'tag', name: 'mi', attribs: {}, children: [{ type: 'text', data: 'e' }] },
                {
                  type: 'tag',
                  name: 'mrow',
                  attribs: {},
                  children: [
                    { type: 'tag', name: 'mi', attribs: {}, children: [{ type: 'text', data: 'i' }] },
                    { type: 'tag', name: 'mi', attribs: {}, children: [{ type: 'text', data: 'π' }] }
                  ]
                }
              ]
            },
            { type: 'tag', name: 'mo', attribs: {}, children: [{ type: 'text', data: '+' }] },
            { type: 'tag', name: 'mn', attribs: {}, children: [{ type: 'text', data: '1' }] }
          ]
        }
      ]
    } as Element

    const { container } = render(<MathJaxNode mathml={complexMath} />)

    const mathNode = container.querySelector('.mathjax-node')
    const mathmlSource = mathNode?.getAttribute('data-mathml-source')

    expect(mathmlSource).toContain('<msup>')
    expect(mathmlSource).toContain('<mi>e</mi>')
    expect(mathmlSource).toContain('<mi>π</mi>')
    expect(mathmlSource).toContain('<mo>+</mo>')
  })

  it('escapes HTML special characters in attributes', () => {
    const mathWithAttrs: Element = {
      type: 'tag',
      name: 'math',
      attribs: {
        xmlns: 'http://www.w3.org/1998/Math/MathML',
        'data-test': 'value with "quotes" & <brackets>'
      },
      children: [
        { type: 'tag', name: 'mi', attribs: {}, children: [{ type: 'text', data: 'x' }] }
      ]
    } as Element

    const { container } = render(<MathJaxNode mathml={mathWithAttrs} />)

    const mathNode = container.querySelector('.mathjax-node')
    const mathmlSource = mathNode?.getAttribute('data-mathml-source')

    expect(mathmlSource).toContain('&quot;')
    expect(mathmlSource).toContain('&amp;')
    expect(mathmlSource).toContain('&lt;')
    expect(mathmlSource).toContain('&gt;')
  })

  it('applies correct styling for display math', () => {
    const mathElement = createMathElement('block')

    const { container } = render(<MathJaxNode mathml={mathElement} />)

    const mathNode = container.querySelector('.math-display') as HTMLElement

    expect(mathNode.style.display).toBe('block')
    expect(mathNode.style.textAlign).toBe('center')
    // Browser may add 'px' suffix
    expect(mathNode.style.margin).toMatch(/^1em 0(px)?$/)
  })

  it('applies correct styling for inline math', () => {
    const mathElement = createMathElement()

    const { container } = render(<MathJaxNode mathml={mathElement} />)

    const mathNode = container.querySelector('.math-inline') as HTMLElement

    expect(mathNode.style.display).toBe('inline')
    expect(mathNode.style.textAlign).toBe('')
    expect(mathNode.style.margin).toBe('')
  })

  it('handles MathJax typesetting errors gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTypesetPromise.mockRejectedValueOnce(new Error('Typesetting failed'))

    const mathElement = createMathElement()

    render(<MathJaxNode mathml={mathElement} />)

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'MathJax typesetting failed:',
        expect.any(Error)
      )
    })

    consoleErrorSpy.mockRestore()
  })
})
