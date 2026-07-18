import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  HttpLlmSettingsApi,
  type LlmSettingsApi,
  type LlmSettingsDraft,
  type LlmSettingsSnapshot,
} from '@/lib/llm-settings-api'


const snapshotWire = {
  id: 7,
  provider: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key_masked: 'sk-o...cret',
  has_api_key: true,
  credential_source: 'database',
  credential_required: true,
  models: {
    kg_extraction: 'gpt-4.1',
    html_injection: 'gpt-4.1-mini',
    tooltip_suggestion: 'gpt-4.1-mini',
  },
  is_active: true,
}

const snapshot: LlmSettingsSnapshot = {
  id: 7,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyMasked: 'sk-o...cret',
  hasApiKey: true,
  credentialSource: 'database',
  credentialRequired: true,
  models: {
    kg_extraction: 'gpt-4.1',
    html_injection: 'gpt-4.1-mini',
    tooltip_suggestion: 'gpt-4.1-mini',
  },
  isActive: true,
}

const draft: LlmSettingsDraft = {
  provider: 'openai',
  baseUrl: 'https://draft.example.test/v1',
  apiKey: 'sk-openai-draft-secret',
  clearApiKey: false,
  models: {
    kg_extraction: 'expensive-kg',
    html_injection: 'cheap-html',
    tooltip_suggestion: 'tooltip-model',
  },
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('HttpLlmSettingsApi', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let api: LlmSettingsApi

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    api = new HttpLlmSettingsApi('http://api.test')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and maps a strict three-workflow snapshot to camelCase', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshotWire))

    await expect(api.load()).resolves.toEqual(snapshot)
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/settings/llm', undefined)
  })

  it('posts the unsaved connection draft for model discovery without putting secrets in the URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      provider: 'openai',
      base_url: 'https://draft.example.test/v1',
      source: 'provider',
      models: [
        { id: 'model-a', name: 'Model A' },
        { id: 'custom-model', name: 'custom-model' },
      ],
      warning: null,
    }))

    await expect(api.listModels(draft)).resolves.toEqual({
      provider: 'openai',
      baseUrl: 'https://draft.example.test/v1',
      source: 'provider',
      models: [
        { id: 'model-a', name: 'Model A' },
        { id: 'custom-model', name: 'custom-model' },
      ],
      warning: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/settings/llm/models',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          base_url: 'https://draft.example.test/v1',
          api_key: 'sk-openai-draft-secret',
          clear_api_key: false,
        }),
      },
    )
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(draft.apiKey)
  })

  it('tests only the selected workflow model without saving the draft', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      success: true,
      message: 'Connection succeeded.',
      workflow: 'html_injection',
      model_used: 'cheap-html',
    }))

    await expect(api.test(draft, 'html_injection')).resolves.toEqual({
      success: true,
      message: 'Connection succeeded.',
      workflow: 'html_injection',
      modelUsed: 'cheap-html',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/settings/llm/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          base_url: 'https://draft.example.test/v1',
          api_key: 'sk-openai-draft-secret',
          clear_api_key: false,
          workflow: 'html_injection',
          model: 'cheap-html',
        }),
      },
    )
  })

  it('saves all three models with explicit replace/remove intent and maps the baseline', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshotWire))

    await expect(api.save({ ...draft, clearApiKey: true, apiKey: '' })).resolves.toEqual(snapshot)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/settings/llm',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          base_url: 'https://draft.example.test/v1',
          api_key: '',
          clear_api_key: true,
          models: draft.models,
        }),
      },
    )
  })

  it('rejects malformed snapshots, lists, sources, and mismatched test workflows', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        ...snapshotWire,
        models: { kg_extraction: 'only-one-model' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        source: 'cache',
        models: [],
        warning: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        message: 'wrong row',
        workflow: 'kg_extraction',
        model_used: 'gpt-4.1',
      }))

    await expect(api.load()).rejects.toThrow('Malformed response from server')
    await expect(api.listModels(draft)).rejects.toThrow('Malformed response from server')
    await expect(api.test(draft, 'html_injection')).rejects.toThrow('Malformed response from server')
  })

  it('rejects malformed JSON and malformed model entries', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        source: 'provider',
        models: [{ id: '', name: 42 }],
        warning: null,
      }))

    await expect(api.load()).rejects.toThrow('Malformed response from server')
    await expect(api.listModels(draft)).rejects.toThrow('Malformed response from server')
  })

  it('sanitizes non-OK backend details that echo a submitted credential', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { detail: `Provider rejected Authorization Bearer ${draft.apiKey}` },
      { status: 422, statusText: 'Unprocessable Entity' },
    ))

    const error = await api.test(draft, 'kg_extraction').catch(reason => reason as Error)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('[redacted]')
    expect(error.message).not.toContain(draft.apiKey)
  })

  it('falls back to status text when a non-OK response is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gateway error', {
      status: 502,
      statusText: 'Bad Gateway',
    }))

    await expect(api.load()).rejects.toThrow('Bad Gateway')
  })
})