import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  HttpReaderWorkspaceApi,
  type ApplyTooltipSuggestionsRequest,
  type CreateManualTooltipSuggestionRequest,
  type GenerateTooltipSuggestionsRequest,
  type TooltipSuggestion,
  type TooltipSuggestionApi,
} from '@/lib/reader-workspace-api'

const storedSuggestion: TooltipSuggestion = {
  id: 'suggestion-1',
  paper_id: 'paper /α',
  entity_id: 'entity-1',
  entity_label: 'Alpha',
  entity_type: 'symbol',
  tooltip_content: 'A parameter.',
  is_ai_generated: false,
  created_at: '2026-07-17T00:00:00Z',
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('HttpReaderWorkspaceApi tooltip suggestions', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let api: TooltipSuggestionApi

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    api = new HttpReaderWorkspaceApi('http://api.test')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists stored suggestions using an encoded paper id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([storedSuggestion]))

    await expect(api.listTooltipSuggestions('paper /α')).resolves.toEqual([storedSuggestion])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper%20%2F%CE%B1/suggestions',
      undefined,
    )
  })

  it('generates suggestions with the exact backend request and response contract', async () => {
    const request: GenerateTooltipSuggestionsRequest = {
      user_expertise: 'Graph theory researcher',
      entity_types: ['definition', 'theorem'],
    }
    const response = {
      suggestions: [{
        entity_id: 'entity-1',
        entity_label: 'Alpha',
        entity_type: 'symbol',
        tooltip_content: 'A parameter.',
        occurrences: [{
          section_id: 'section-1',
          dom_node_id: 'node-1',
          char_offset: 5,
          length: 5,
          snippet: 'Let Alpha be...',
        }],
      }],
      total_entities: 4,
      suggested_count: 1,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(response))

    await expect(api.generateTooltipSuggestions('paper /α', request)).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper%20%2F%CE%B1/tooltips/suggest',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
  })

  it('creates a manual suggestion with the exact backend request contract', async () => {
    const request: CreateManualTooltipSuggestionRequest = {
      entity_label: 'Alpha',
      entity_type: 'symbol',
      tooltip_content: 'A parameter.',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(storedSuggestion))

    await expect(api.createManualTooltipSuggestion('paper /α', request)).resolves.toEqual(
      storedSuggestion,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper%20%2F%CE%B1/suggestions/manual',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
  })

  it('deletes one encoded suggestion and validates the success response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'success' }))

    await expect(
      api.deleteTooltipSuggestion('paper /α', 'suggestion /β'),
    ).resolves.toEqual({ status: 'success' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper%20%2F%CE%B1/suggestions/suggestion%20%2F%CE%B2',
      { method: 'DELETE' },
    )
  })

  it('applies the selected suggestions with the exact backend request contract', async () => {
    const request: ApplyTooltipSuggestionsRequest = {
      suggestions: [{
        entity_id: 'entity-1',
        entity_label: 'Alpha',
        entity_type: 'symbol',
        tooltip_content: 'Edited content.',
        occurrences: [],
      }],
    }
    const response = {
      success: true,
      spans_injected: 2,
      tooltips_created: 1,
      errors: [],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(response))

    await expect(api.applyTooltipSuggestions('paper /α', request)).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/papers/paper%20%2F%CE%B1/tooltips/apply',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
  })

  it('uses backend detail for non-OK suggestion responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { detail: 'Knowledge graph is required' },
      { status: 400, statusText: 'Bad Request' },
    ))

    await expect(api.generateTooltipSuggestions('paper', {
      user_expertise: 'Researcher',
      entity_types: null,
    })).rejects.toThrow('Knowledge graph is required')
  })

  it('falls back to status text when an error response is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gateway error', {
      status: 502,
      statusText: 'Bad Gateway',
    }))

    await expect(api.listTooltipSuggestions('paper')).rejects.toThrow('Bad Gateway')
  })

  it('rejects malformed JSON and malformed successful response shapes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(jsonResponse({ suggestions: 'not-an-array' }))

    await expect(api.listTooltipSuggestions('paper')).rejects.toThrow('Malformed response')
    await expect(api.generateTooltipSuggestions('paper', {
      user_expertise: 'Researcher',
      entity_types: null,
    })).rejects.toThrow('Malformed response')
  })
})