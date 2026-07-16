import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

interface CommentTreeNode {
  id: string
  name: string
  parent: unknown
  children: CommentTreeNode[]
  expanded: boolean
  selected: boolean
  entry: {
    id: string
    kind: 'comment'
    label: string
    description: string
    children: []
  }
}

interface CommentsWidgetConstructor {
  prototype: object
}

interface CaptionRenderer {
  getCaptionChildren: (node: CommentTreeNode, props: { depth: number }) => ReactNode
}

let ScholarCommentsWidget: CommentsWidgetConstructor

function createCommentNode(): CommentTreeNode {
  const root = {
    id: 'comments:root',
    name: 'Comments',
    parent: undefined,
    children: [] as CommentTreeNode[],
  }
  const node: CommentTreeNode = {
    id: 'comment:tooltip-1',
    name: 'Target $d_x$ — Comment $\\pi$',
    parent: root,
    children: [],
    expanded: false,
    selected: false,
    entry: {
      id: 'comment:tooltip-1',
      kind: 'comment',
      label: 'Target $d_x$',
      description: 'Comment $\\pi$',
      children: [],
    },
  }
  root.children.push(node)
  return node
}

function createCaptionRenderer(): CaptionRenderer {
  const widget = Object.create(ScholarCommentsWidget.prototype) as {
    decorations: Map<string, unknown>
    labelProvider: { getName: (node: CommentTreeNode) => string }
  }
  widget.decorations = new Map()
  widget.labelProvider = { getName: (node: CommentTreeNode) => node.name }
  return widget as unknown as CaptionRenderer
}

describe('Scholar native tree widgets', () => {
  beforeAll(async () => {
    vi.stubGlobal('DragEvent', class DragEvent extends Event {})
    document.queryCommandSupported = vi.fn(() => false)
    ;({ ScholarCommentsWidget } = await vi.importActual<{
      ScholarCommentsWidget: CommentsWidgetConstructor
    }>(
      '@/theia/scholar-extension/src/browser/scholar-native-widgets'
    ))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    delete (document as Partial<Document>).queryCommandSupported
  })

  it('renders a LaTeX comment before tree search has initialized its highlights', () => {
    const widget = createCaptionRenderer()

    const caption = widget.getCaptionChildren(createCommentNode(), { depth: 2 })
    const { container } = render(<>{caption}</>)

    expect(container.querySelector('.scholar-tree-comment-target')?.textContent)
      .toBe('Target \\(d_x\\)')
    expect(container.querySelector('.scholar-tree-comment-content')?.textContent)
      .toBe('Comment \\(\\pi\\)')
  })
})