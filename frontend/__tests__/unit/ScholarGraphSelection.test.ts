import { describe, expect, it } from 'vitest'

import {
  SCHOLAR_GRAPH_SELECTION_KIND,
  ScholarGraphSelection,
  type ScholarGraphSelectionSource,
} from '@/theia/scholar-extension/src/browser/scholar-graph-selection'

function createSource(paperId: string, owner: object = {}): ScholarGraphSelectionSource {
  return { kind: SCHOLAR_GRAPH_SELECTION_KIND, paperId, owner }
}

describe('ScholarGraphSelection.create / is', () => {
  it('creates a node selection carrying the paperId, source, and node payload', () => {
    const source = createSource('paper-a')
    const selection = ScholarGraphSelection.create('paper-a', source, {
      kind: 'node',
      id: 'node-1',
      label: 'Theorem 1',
      nodeType: 'theorem',
      definition: 'A well-known result.',
      incomingConnections: [],
      outgoingConnections: [],
    })

    expect(ScholarGraphSelection.is(selection)).toBe(true)
    expect(selection.paperId).toBe('paper-a')
    expect(selection.payload.kind).toBe('node')
  })

  it('creates an edge selection carrying source/target labels, relation type and evidence', () => {
    const source = createSource('paper-a')
    const selection = ScholarGraphSelection.create('paper-a', source, {
      kind: 'edge',
      sourceId: 'node-1',
      targetId: 'node-2',
      sourceLabel: 'Theorem 1',
      targetLabel: 'Lemma 2',
      relationshipType: 'depends_on',
      evidence: 'See Section 3.',
    })

    expect(ScholarGraphSelection.is(selection)).toBe(true)
    expect(selection.payload.kind).toBe('edge')
  })

  it('accepts a node payload without any optional fields (missing definition/context/connections)', () => {
    const selection = ScholarGraphSelection.create('paper-a', createSource('paper-a'), {
      kind: 'node',
      id: 'node-1',
      label: 'x',
      nodeType: 'symbol',
      incomingConnections: [],
      outgoingConnections: [],
    })
    expect(ScholarGraphSelection.is(selection)).toBe(true)
  })

  it('accepts an edge payload without evidence', () => {
    const selection = ScholarGraphSelection.create('paper-a', createSource('paper-a'), {
      kind: 'edge',
      sourceId: 'a',
      targetId: 'b',
      sourceLabel: 'A',
      targetLabel: 'B',
      relationshipType: 'uses',
    })
    expect(ScholarGraphSelection.is(selection)).toBe(true)
  })

  it.each([
    {
      kind: 'occurrence' as const,
      occurrenceId: 'occ-1',
      subjectId: 'procedure:supg',
      label: 'SUPG',
      scopeId: 'sec-1',
      domNodeId: 'p-1',
    },
    { kind: 'equation' as const, equationId: 'eq-7' },
    {
      kind: 'evidence' as const,
      evidence: {
        observation_id: 'obs-1',
        kind: 'topic',
        label: 'SUPG',
        source: {
          paper_id: 'paper-a', section_id: 'sec-1', section_title: 'Method',
          dom_node_id: 'p-1', equation_id: null, quote: 'SUPG stabilizes transport.',
          char_start: 0, char_end: 4,
        },
      },
    },
  ])('accepts shared semantic payload $kind', payload => {
    const selection = ScholarGraphSelection.create('paper-a', createSource('paper-a'), payload)
    expect(ScholarGraphSelection.is(selection)).toBe(true)
  })
})

describe('ScholarGraphSelection.is (negative / edge cases)', () => {
  it('rejects undefined, null, and primitive selections', () => {
    expect(ScholarGraphSelection.is(undefined)).toBe(false)
    expect(ScholarGraphSelection.is(null)).toBe(false)
    expect(ScholarGraphSelection.is('paper-a')).toBe(false)
    expect(ScholarGraphSelection.is(42)).toBe(false)
  })

  it('rejects a plain object that merely resembles the shape', () => {
    expect(ScholarGraphSelection.is({ paperId: 'paper-a', payload: { kind: 'node' } })).toBe(false)
  })

  it('rejects a Theia TreeNode-shaped selection', () => {
    const treeNode = {
      id: 'tree-node-1',
      name: 'Some section',
      parent: undefined,
      children: [],
      selected: true,
      expanded: false,
    }
    expect(ScholarGraphSelection.is(treeNode)).toBe(false)
  })

  it('rejects a selection with an invalid source (missing owner)', () => {
    const selection = {
      type: SCHOLAR_GRAPH_SELECTION_KIND,
      paperId: 'paper-a',
      source: { kind: SCHOLAR_GRAPH_SELECTION_KIND, paperId: 'paper-a' },
      payload: {
        kind: 'node',
        id: 'n',
        label: 'n',
        nodeType: 'symbol',
        incomingConnections: [],
        outgoingConnections: [],
      },
    }
    expect(ScholarGraphSelection.is(selection)).toBe(false)
  })

  it('rejects a selection whose payload kind is neither node nor edge', () => {
    const selection = {
      type: SCHOLAR_GRAPH_SELECTION_KIND,
      paperId: 'paper-a',
      source: createSource('paper-a'),
      payload: { kind: 'unknown' },
    }
    expect(ScholarGraphSelection.is(selection)).toBe(false)
  })

  it('rejects a node payload missing required fields', () => {
    const selection = {
      type: SCHOLAR_GRAPH_SELECTION_KIND,
      paperId: 'paper-a',
      source: createSource('paper-a'),
      payload: { kind: 'node', id: 'n' },
    }
    expect(ScholarGraphSelection.is(selection)).toBe(false)
  })
})

describe('ScholarGraphSelection.isSelectionSource (widget instance ownership)', () => {
  it('matches only the exact same owner reference, not merely the same paperId', () => {
    const ownerA = {}
    const ownerB = {}
    const sourceA = createSource('paper-a', ownerA)
    const sourceB = createSource('paper-a', ownerB)
    const selection = ScholarGraphSelection.create('paper-a', sourceA, {
      kind: 'node',
      id: 'n',
      label: 'n',
      nodeType: 'symbol',
      incomingConnections: [],
      outgoingConnections: [],
    })

    expect(ScholarGraphSelection.isSource(selection, sourceA)).toBe(true)
    expect(ScholarGraphSelection.isSource(selection, sourceB)).toBe(false)
  })

  it('does not let a disposed/replaced widget instance with the same id clear a new instance selection', () => {
    // Simulates two ScholarPaperGraphWidget instances created for the same paperId
    // (e.g. after closing and reopening a tab): the old instance must not be
    // mistaken for the new one just because paperId matches.
    const firstInstanceOwner = { disposed: true }
    const secondInstanceOwner = { disposed: false }
    const firstSource = createSource('paper-a', firstInstanceOwner)
    const secondSource = createSource('paper-a', secondInstanceOwner)

    const selectionFromSecondInstance = ScholarGraphSelection.create('paper-a', secondSource, {
      kind: 'node',
      id: 'n',
      label: 'n',
      nodeType: 'symbol',
      incomingConnections: [],
      outgoingConnections: [],
    })

    expect(ScholarGraphSelection.isSource(selectionFromSecondInstance, firstSource)).toBe(false)
    expect(ScholarGraphSelection.isSource(selectionFromSecondInstance, secondSource)).toBe(true)
  })
})
