import { describe, expect, it } from 'vitest'

import type { Tooltip } from '@/hooks/useTooltips'
import {
  buildCommentTree,
  buildGlossaryTree,
  buildOutlineTree,
  mapHtmlNodesToSections,
} from '@/lib/scholar-native-tree'
import type { TOCNode } from '@/utils/parseTOC'

const toc: TOCNode[] = [
  {
    id: 'intro',
    title: 'Introduction',
    level: 1,
    children: [
      {
        id: 'motivation',
        title: 'Motivation with <math><mi>x</mi></math>',
        level: 2,
        children: [],
      },
    ],
  },
  {
    id: 'results',
    title: 'Results',
    level: 1,
    children: [],
  },
]

function tooltip(overrides: Partial<Tooltip>): Tooltip {
  return {
    id: 'tooltip-1',
    paper_id: 'paper-1',
    dom_node_id: 'paragraph-1',
    entity_id: null,
    user_id: 'user-1',
    target_text: null,
    content: 'A useful comment',
    is_pinned: false,
    display_order: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('Scholar native tree models', () => {
  it('builds a renderable outline while preserving section hierarchy', () => {
    const result = buildOutlineTree(toc)

    expect(result).toMatchObject([
      {
        id: 'section:intro',
        kind: 'section',
        label: 'Introduction',
        sourceId: 'intro',
        children: [
          {
            id: 'section:motivation',
            label: 'Motivation with x',
            sourceId: 'motivation',
          },
        ],
      },
      {
        id: 'section:results',
        label: 'Results',
        sourceId: 'results',
      },
    ])
  })

  it('converts embedded MathML TeX annotations into delimiters understood by LatexText', () => {
    const result = buildOutlineTree([{
      id: 'section-math',
      title: 'Rates <math alttext="\\alpha"><semantics><mi>α</mi><annotation encoding="application/x-tex">\\alpha</annotation></semantics></math>',
      level: 1,
      children: [],
    }])

    expect(result[0].label).toBe('Rates $\\alpha$')
  })

  it('keeps a legitimate single top-level section instead of treating it as the paper title', () => {
    const result = buildOutlineTree([{
      id: 'section-1',
      title: 'Introduction',
      level: 1,
      children: [{ id: 'section-1.1', title: 'Motivation', level: 2, children: [] }],
    }])

    expect(result[0].id).toBe('section:section-1')
  })

  it('unwraps a single paper-title root in the outline tree', () => {
    const result = buildOutlineTree([{
      id: 'LTX.title',
      title: 'The Great Research',
      level: 1,
      children: [
        { id: 'section-1', title: 'Introduction', level: 2, children: [] },
        { id: 'section-2', title: 'Method', level: 2, children: [] },
      ],
    }])

    expect(result.map(entry => entry.id)).toEqual(['section:section-1', 'section:section-2'])
  })

  it('unwraps the article title by metadata when its generated id has no title marker', () => {
    const paperTitle = 'Slime Stabilized Likelihood Implicit Margin Enforcement for Preference Optimization'
    const result = buildOutlineTree([{
      id: 'ltxid1',
      title: paperTitle,
      level: 1,
      children: [
        { id: 'ltxid2', title: 'Introduction', level: 2, children: [] },
        { id: 'ltxid3', title: 'Method', level: 2, children: [] },
      ],
    }], paperTitle)

    expect(result.map(entry => entry.id)).toEqual(['section:ltxid2', 'section:ltxid3'])
  })

  it('prunes empty sections and keeps pinned comments first', () => {
    const comments = [
      tooltip({ id: 'regular', content: 'Regular', dom_node_id: 'paragraph-1' }),
      tooltip({ id: 'pinned', content: 'Pinned', dom_node_id: 'paragraph-2', is_pinned: true }),
    ]
    const sectionByNode = new Map([
      ['paragraph-1', 'motivation'],
      ['paragraph-2', 'motivation'],
    ])

    const result = buildCommentTree(comments, toc, nodeId => sectionByNode.get(nodeId))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'group',
      sourceId: 'intro',
      count: 2,
      children: [
        {
          kind: 'group',
          sourceId: 'motivation',
          count: 2,
          children: [
            { kind: 'comment', tooltipId: 'pinned', label: 'Pinned' },
            { kind: 'comment', tooltipId: 'regular', label: 'Regular' },
          ],
        },
      ],
    })
  })

  it('unwraps a single paper-title root in the comment tree', () => {
    const result = buildCommentTree(
      [tooltip({ dom_node_id: 'paragraph-1' })],
      [{
        id: 'LTX.title',
        title: 'The Great Research',
        level: 1,
        children: [{ id: 'section-1', title: 'Introduction', level: 2, children: [] }],
      }],
      nodeId => nodeId === 'paragraph-1' ? 'section-1' : undefined,
    )

    expect(result.map(entry => entry.id)).toEqual(['comment-group:section-1'])
  })

  it('unwraps the article title from comments by metadata when its id is generated', () => {
    const paperTitle = 'Slime Stabilized Likelihood Implicit Margin Enforcement for Preference Optimization'
    const result = buildCommentTree(
      [tooltip({ dom_node_id: 'paragraph-1' })],
      [{
        id: 'ltxid1',
        title: paperTitle,
        level: 1,
        children: [{ id: 'ltxid2', title: 'Introduction', level: 2, children: [] }],
      }],
      nodeId => nodeId === 'paragraph-1' ? 'ltxid2' : undefined,
      paperTitle,
    )

    expect(result.map(entry => entry.id)).toEqual(['comment-group:ltxid2'])
  })

  it('maps nodes to their containing section after a nested subsection ends', () => {
    const result = mapHtmlNodesToSections(`
      <section data-id="intro">
        <p data-id="intro-paragraph">Intro</p>
        <section data-id="motivation">
          <p data-id="nested-paragraph">Nested</p>
        </section>
        <p data-id="closing-paragraph">Closing</p>
      </section>
    `, toc)

    expect(result.get('intro-paragraph')).toBe('intro')
    expect(result.get('nested-paragraph')).toBe('motivation')
    expect(result.get('closing-paragraph')).toBe('intro')
  })

  it('places unresolved comments in an Other group and ignores glossary entries', () => {
    const comments = [
      tooltip({ id: 'orphan', dom_node_id: 'missing', target_text: 'Orphan target' }),
      tooltip({ id: 'glossary', dom_node_id: null, entity_id: 'def_term' }),
      tooltip({ id: 'invalid', dom_node_id: null }),
    ]

    const result = buildCommentTree(comments, toc, () => undefined)

    expect(result).toMatchObject([
      {
        id: 'comment-group:other',
        label: 'Other',
        count: 1,
        children: [{
          kind: 'comment',
          tooltipId: 'orphan',
          label: 'Orphan target',
          description: 'A useful comment',
        }],
      },
    ])
  })

  it('preserves LaTeX delimiters in comment targets and previews', () => {
    const result = buildCommentTree([
      tooltip({
        target_text: '<span>Objective $f(x)$</span>',
        content: '<p>Check $x^2$ carefully</p>',
      }),
    ], toc, () => undefined)

    expect(result[0].children[0]).toMatchObject({
      kind: 'comment',
      label: 'Objective $f(x)$',
      description: 'Check $x^2$ carefully',
      searchText: 'Objective $f(x)$ — Check $x^2$ carefully',
    })
  })

  it('falls back to the attached text when a comment has no readable content', () => {
    const result = buildCommentTree([
      tooltip({ content: '  <span> </span> ', target_text: 'Attached passage' }),
    ], toc, () => undefined)

    expect(result[0].children[0]).toMatchObject({
      kind: 'comment',
      label: 'Attached passage',
      description: undefined,
    })
  })

  it('groups glossary entries by entity type and handles manual entries', () => {
    const entries = [
      tooltip({ id: 'manual', dom_node_id: null, entity_id: 'manual_note', target_text: '<span>My term $x$</span>' }),
      tooltip({ id: 'definition', dom_node_id: null, entity_id: 'def_entropy', target_text: 'Entropy' }),
      tooltip({ id: 'formula', dom_node_id: null, entity_id: 'formula_loss', target_text: 'Loss' }),
      tooltip({ id: 'comment', entity_id: null }),
    ]

    const result = buildGlossaryTree(entries)

    expect(result.map(group => [group.label, group.count])).toEqual([
      ['User-Created', 1],
      ['Definitions', 1],
      ['Formulas', 1],
    ])
    expect(result.flatMap(group => group.children).map(item => item.tooltipId)).toEqual([
      'manual',
      'definition',
      'formula',
    ])
    expect(result[0].children[0].label).toBe('My term $x$')
  })

  it('returns empty trees for empty inputs', () => {
    expect(buildOutlineTree([])).toEqual([])
    expect(buildCommentTree([], toc, () => undefined)).toEqual([])
    expect(buildGlossaryTree([])).toEqual([])
  })
})