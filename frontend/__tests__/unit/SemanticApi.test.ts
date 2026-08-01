import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpSemanticApi } from '../../lib/semantic-api'


describe('HttpSemanticApi', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const api = new HttpSemanticApi('http://api.test')

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads equation details from the semantic paper endpoint', async () => {
    const response = {
      schema_version: '3.0',
      equation: { equation_id: 'eq 7' },
      notation: [],
      objects: [],
      evidence: [],
    }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(response)))

    await expect(api.equationDetails('paper-a', 'eq 7')).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper-a/semantic/equations/eq%207',
    )
  })
})