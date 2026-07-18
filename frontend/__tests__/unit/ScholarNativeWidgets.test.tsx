import { render } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
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

interface NativeTreeWidget {
  store: {
    getSnapshot: () => unknown
  }
  getEntries: () => Array<{ id: string }>
}

interface CaptionRenderer {
  getCaptionChildren: (node: CommentTreeNode, props: { depth: number }) => ReactNode
}

let ScholarCommentsWidget: CommentsWidgetConstructor
let ScholarOutlineWidget: CommentsWidgetConstructor

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
    ;({ ScholarCommentsWidget, ScholarOutlineWidget } = await vi.importActual<{
      ScholarCommentsWidget: CommentsWidgetConstructor
      ScholarOutlineWidget: CommentsWidgetConstructor
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

  it('omits an article-title root with a generated id in outline and comments widgets', () => {
    const title = 'Slime Stabilized Likelihood Implicit Margin Enforcement for Preference Optimization'
    const paper = {
      id: 'paper-1',
      html_content: `<h1 data-id="ltxid1">${title}</h1><h2 data-id="ltxid2">Introduction</h2><p data-id="node-1">Text</p>`,
      sections: [
        { id: 'ltxid1', title, title_html: title, level: 1, parent_id: null, content_html: '' },
        { id: 'ltxid2', title: 'Introduction', title_html: 'Introduction', level: 2, parent_id: 'ltxid1', content_html: '' },
      ],
      paper_metadata: { title },
    }
    const snapshot = {
      activePaperId: paper.id,
      papersById: { [paper.id]: paper },
      tooltipsByPaperId: {
        [paper.id]: [{
          id: 'tooltip-1',
          paper_id: paper.id,
          dom_node_id: 'node-1',
          entity_id: null,
          content: 'Comment',
          target_text: null,
          created_at: '',
          updated_at: '',
          is_pinned: false,
          user_id: 'default',
          display_order: null,
        }],
      },
    }
    const outline = Object.create(ScholarOutlineWidget.prototype) as NativeTreeWidget
    const comments = Object.create(ScholarCommentsWidget.prototype) as NativeTreeWidget
    outline.store = comments.store = { getSnapshot: () => snapshot }

    expect(outline.getEntries().map(entry => entry.id)).toEqual(['section:ltxid2'])
    expect(comments.getEntries().map(entry => entry.id)).toEqual(['comment-group:ltxid2'])
  })
})

describe('Scholar annotation details', () => {
  it('uses the compact applied-suggestion layout without attachment prose', () => {
    const source = fs.readFileSync(path.resolve(
      process.cwd(),
      'theia/scholar-extension/src/browser/scholar-native-widgets.tsx',
    ), 'utf-8')

    expect(source).toContain("this.title.label = 'Annotation Details'")
    expect(source).not.toContain('Attached to:')
    expect(source).toMatch(
      /scholar-annotation-detail-header[\s\S]*?<strong><LatexText text=\{tooltip\.target_text\}/,
    )
    expect(source).toContain(
      '<div className="scholar-suggestion-preview scholar-annotation-content"',
    )
  })
})