import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HTMLRenderer } from '@/components/reader/HTMLRenderer'

// Mock the MathJaxNode component
vi.mock('@/components/reader/MathJaxNode', () => ({
  MathJaxNode: ({ mathml }: any) => <div data-testid="mathjax-node">MathJax Mock</div>
}))

// Mock the InteractiveNode component
vi.mock('@/components/reader/InteractiveNode', () => ({
  InteractiveNode: ({ children, dataId, tag, annotationActivation }: any) => {
    const Tag = tag || 'div'
    return (
      <Tag
        data-testid={`interactive-${tag}`}
        data-id={dataId}
        data-annotation-activation={annotationActivation}
      >
        {children}
      </Tag>
    )
  }
}))

describe('HTMLRenderer', () => {
  const mockProps = {
    paperId: 'test-paper-123',
    tooltips: {},
    onTooltipCreate: vi.fn(),
    onTooltipUpdate: vi.fn(),
    onTooltipDelete: vi.fn(),
  }

  it('renders basic HTML content', () => {
    const html = '<p>Hello World</p>'

    render(<HTMLRenderer {...mockProps} html={html} />)

    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('renders headings correctly', () => {
    const html = '<h1>Title</h1><h2>Subtitle</h2>'

    render(<HTMLRenderer {...mockProps} html={html} />)

    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Subtitle')).toBeInTheDocument()
  })

  it('intercepts math elements and renders MathJaxNode', () => {
    const html = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>'

    render(<HTMLRenderer {...mockProps} html={html} />)

    expect(screen.getByTestId('mathjax-node')).toBeInTheDocument()
  })

  it('intercepts elements with data-id and renders InteractiveNode', () => {
    const html = '<p data-id="node-123">Interactive paragraph</p>'

    render(<HTMLRenderer {...mockProps} html={html} />)

    const interactivePara = screen.getByTestId('interactive-p')
    expect(interactivePara).toBeInTheDocument()
    expect(interactivePara).toHaveAttribute('data-id', 'node-123')
  })

  it('reports the semantic entity id when an injected tooltip is clicked', () => {
    const onEntityClick = vi.fn()
    render(
      <HTMLRenderer
        {...mockProps}
        html='<p><span class="kg-entity" data-entity-id="entity-attention">attention</span></p>'
        onEntityClick={onEntityClick}
      />,
    )

    fireEvent.click(screen.getByText('attention'))

    expect(onEntityClick).toHaveBeenCalledWith('entity-attention')
  })

  it('activates occurrence-aware semantic links by click and keyboard but not hover', () => {
    const onSemanticSelect = vi.fn()
    render(
      <HTMLRenderer
        {...mockProps}
        html={'<p data-id="p-1"><span class="kg-entity" data-occurrence-id="occ-1" data-subject-id="procedure:supg" data-entity-id="procedure:supg">SUPG</span></p>'}
        onSemanticSelect={onSemanticSelect}
      />,
    )
    const link = screen.getByRole('button', { name: 'SUPG' })

    fireEvent.mouseOver(link)
    expect(onSemanticSelect).not.toHaveBeenCalled()
    fireEvent.click(link)
    fireEvent.keyDown(link, { key: 'Enter' })
    fireEvent.keyDown(link, { key: ' ' })

    expect(link).toHaveAttribute('tabindex', '0')
    expect(onSemanticSelect).toHaveBeenCalledTimes(3)
    expect(onSemanticSelect).toHaveBeenLastCalledWith({
      kind: 'occurrence',
      occurrenceId: 'occ-1',
      subjectId: 'procedure:supg',
      label: 'SUPG',
      subjectKind: undefined,
      domNodeId: 'p-1',
      equationId: undefined,
      scopeId: 'p-1',
    })
  })

  it('forwards context-menu annotation activation to interactive nodes', () => {
    render(
      <HTMLRenderer
        {...mockProps}
        html='<p data-id="node-123">Interactive paragraph</p>'
        annotationActivation="context-menu"
      />,
    )

    expect(screen.getByTestId('interactive-p'))
      .toHaveAttribute('data-annotation-activation', 'context-menu')
  })

  it('renders nested elements correctly', () => {
    const html = `
      <section data-id="section-1">
        <h2 data-id="heading-1">Section Title</h2>
        <p data-id="para-1">Section content with <strong>bold text</strong></p>
      </section>
    `

    render(<HTMLRenderer {...mockProps} html={html} />)

    expect(screen.getByText('Section Title')).toBeInTheDocument()
    expect(screen.getByText(/Section content with/)).toBeInTheDocument()
    expect(screen.getByText('bold text')).toBeInTheDocument()
  })

  it('handles complex HTML with multiple element types', () => {
    const html = `
      <article>
        <h1 data-id="title">Test Paper</h1>
        <section data-id="intro">
          <h2>Introduction</h2>
          <p data-id="para-1">Some text here.</p>
        </section>
        <section data-id="math-section">
          <h2>Mathematics</h2>
          <p data-id="para-2">Here is a formula:</p>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <mi>x</mi>
          </math>
        </section>
      </article>
    `

    render(<HTMLRenderer {...mockProps} html={html} />)

    expect(screen.getByText('Test Paper')).toBeInTheDocument()
    expect(screen.getByText('Introduction')).toBeInTheDocument()
    expect(screen.getByText('Mathematics')).toBeInTheDocument()
    expect(screen.getByTestId('mathjax-node')).toBeInTheDocument()
  })

  it('preserves class names and attributes', () => {
    const html = '<p class="ltx_para" data-id="para-1">Text</p>'

    const { container } = render(<HTMLRenderer {...mockProps} html={html} />)

    // The InteractiveNode mock should preserve the data-id
    const para = screen.getByTestId('interactive-p')
    expect(para).toHaveAttribute('data-id', 'para-1')
  })

  it('handles empty HTML gracefully', () => {
    const html = ''

    const { container } = render(<HTMLRenderer {...mockProps} html={html} />)

    expect(container.querySelector('article')).toBeInTheDocument()
  })

  it('handles malformed HTML without crashing', () => {
    const html = '<p>Unclosed paragraph'

    expect(() => {
      render(<HTMLRenderer {...mockProps} html={html} />)
    }).not.toThrow()
  })

  it('renders lists correctly', () => {
    const html = `
      <ul>
        <li data-id="item-1">First item</li>
        <li data-id="item-2">Second item</li>
      </ul>
    `

    render(<HTMLRenderer {...mockProps} html={html} />)

    expect(screen.getByText('First item')).toBeInTheDocument()
    expect(screen.getByText('Second item')).toBeInTheDocument()
  })

  it('applies the html-renderer CSS class', () => {
    const html = '<p>Test</p>'

    const { container } = render(<HTMLRenderer {...mockProps} html={html} />)

    const article = container.querySelector('article')
    expect(article).toHaveClass('html-renderer')
  })
})
