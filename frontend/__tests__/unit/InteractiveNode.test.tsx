import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InteractiveNode } from '@/components/reader/InteractiveNode'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
      function MotionDiv({ children, ...props }, ref) {
        return <div ref={ref} {...props}>{children}</div>
      },
    ),
  },
}))

const props = {
  tag: 'p',
  dataId: 'paragraph-1',
  attributes: {},
  onTooltipCreate: vi.fn(),
  onTooltipUpdate: vi.fn(),
  onTooltipDelete: vi.fn(),
}

describe('InteractiveNode', () => {
  afterEach(() => vi.restoreAllMocks())
  it('uses right click for annotation creation in context-menu mode', () => {
    const onTooltipCreate = vi.fn()
    render(
      <InteractiveNode
        {...props}
        annotationActivation="context-menu"
        onTooltipCreate={onTooltipCreate}
      >
        Paragraph content
      </InteractiveNode>,
    )

    fireEvent.click(screen.getByText('Paragraph content'))
    expect(screen.queryByText('Annotations (0)')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByText('Paragraph content'), { clientX: 20, clientY: 30 })
    expect(screen.getByText('Annotations (0)')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Add your notes or explanation...'), {
      target: { value: 'A compact note' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(onTooltipCreate).toHaveBeenCalledWith('A compact note', undefined)
  })

  it('keeps the existing click interaction as the default', () => {
    render(<InteractiveNode {...props}>Paragraph content</InteractiveNode>)

    fireEvent.click(screen.getByText('Paragraph content'))

    expect(screen.getByText('Annotations (0)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Annotation' })).toBeInTheDocument()
  })

  it('keeps the context popover and its close control inside the reader view', () => {
    const rect = (
      left: number,
      top: number,
      width: number,
      height: number,
    ): DOMRect => ({
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    })
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBounds() {
        if (this.classList.contains('scholar-reader-widget')) {
          return rect(100, 100, 400, 300)
        }
        if (this.classList.contains('tooltip-popover')) {
          return rect(0, 0, 420, 500)
        }
        return rect(450, 360, 40, 30)
      })

    render(
      <div className="scholar-reader-widget">
        <InteractiveNode {...props} annotationActivation="context-menu">
          Paragraph content
        </InteractiveNode>
      </div>,
    )
    fireEvent.contextMenu(screen.getByText('Paragraph content'), { clientX: 490, clientY: 390 })

    const popover = screen.getByText('Annotations (0)').closest('.tooltip-popover')
    expect(popover).toHaveStyle({
      left: '108px',
      top: '108px',
      width: '384px',
      maxHeight: '284px',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close annotations' }))
    expect(screen.queryByText('Annotations (0)')).not.toBeInTheDocument()
    bounds.mockRestore()
  })
})