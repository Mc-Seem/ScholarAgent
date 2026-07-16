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
  it('builds a plain-text outline while preserving section hierarchy', () => {
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
        children: [{ kind: 'comment', tooltipId: 'orphan', label: 'Orphan target' }],
      },
    ])
  })

  it('groups glossary entries by entity type and handles manual entries', () => {
    const entries = [
      tooltip({ id: 'manual', dom_node_id: null, entity_id: 'manual_note', target_text: 'My term' }),
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
  })

  it('returns empty trees for empty inputs', () => {
    expect(buildOutlineTree([])).toEqual([])
    expect(buildCommentTree([], toc, () => undefined)).toEqual([])
    expect(buildGlossaryTree([])).toEqual([])
  })
})