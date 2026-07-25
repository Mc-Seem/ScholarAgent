import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpKnowledgeGraphApi } from '../../lib/knowledge-graph-api'


function source() {
  return {
    paper_id: 'paper-1', section_id: 'sec-1', section_title: 'Method', dom_node_id: 'p-1',
    equation_id: null, quote: 'Evidence.', char_start: 0, char_end: 9,
  }
}

function node() {
  return {
    stable_id: 'concept:1', type: 'concept', label: 'ELBO', aliases: ['Evidence lower bound'],
    facets: [],
    signals: { contribution: 1, prominence: 0.8, recurrence: 0.5, confidence: 0.9, familiarity: 0.2 },
    rank: 0.9,
    evidence: [{ observation_id: 'obs-1', kind: 'concept', label: 'ELBO', source: source() }],
  }
}

function projection() {
  return {
    status: 'ready', schema_version: '1.0', nodes: [node()], relations: [],
    total_entity_count: 100, total_relation_count: 20, truncated: true,
  }
}

describe('HttpKnowledgeGraphApi', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const api = new HttpKnowledgeGraphApi('http://api.test')

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads the bounded overview rather than the full export', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(projection())))

    await expect(api.overview('paper 1', { expertise: 'expert', limit: 20 })).resolves.toEqual(projection())

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper%201/knowledge-graph/overview?expertise=expert&limit=20',
    )
  })

  it('encodes repeated seeds and hard budgets for one-hop expansion', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(projection())))

    await api.subgraph('paper-1', { seedIds: ['concept:1', 'claim:2'], nodeBudget: 12, edgeBudget: 20 })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper-1/knowledge-graph/subgraph?seed_ids=concept%3A1&seed_ids=claim%3A2&node_budget=12&edge_budget=20',
    )
  })

  it('parses search results without turning them into projection nodes', async () => {
    const { rank, ...searchNode } = node()
    const response = { status: 'ready', schema_version: '1.0', results: [{ ...searchNode, score: 1.1 }] }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(response)))

    await expect(api.search('paper-1', 'ELBO', { limit: 5 })).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper-1/knowledge-graph/search?query=ELBO&limit=5',
    )
  })

  it('rejects malformed responses at the API boundary', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ready', nodes: 'all' })))

    await expect(api.overview('paper-1')).rejects.toThrow('Malformed knowledge graph response')
  })
})