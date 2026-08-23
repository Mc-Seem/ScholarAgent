import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  LlmModelsResult,
  LlmSettingsApi,
  LlmSettingsDraft,
  LlmSettingsSnapshot,
  LlmTestResult,
  LlmWorkflow,
} from '@/lib/llm-settings-api'
import { ScholarLlmSettingsService } from '@/theia/scholar-extension/src/browser/scholar-llm-settings-service'


interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function serverSnapshot(
  overrides: Partial<LlmSettingsSnapshot> = {},
): LlmSettingsSnapshot {
  return {
    id: 2,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyMasked: 'sk-o...cret',
    hasApiKey: true,
    credentialSource: 'database',
    credentialRequired: true,
    models: {
      kg_extraction: 'kg-model',
      html_injection: 'html-model',
      tooltip_suggestion: 'tooltip-model',
      chat: 'chat-model',
    },
    isActive: true,
    ...overrides,
  }
}

function modelResult(
  overrides: Partial<LlmModelsResult> = {},
): LlmModelsResult {
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    source: 'provider',
    models: [{ id: 'available-model', name: 'Available Model' }],
    warning: null,
    ...overrides,
  }
}

function testResult(workflow: LlmWorkflow, modelUsed: string): LlmTestResult {
  return {
    success: true,
    message: 'Connection succeeded.',
    workflow,
    modelUsed,
  }
}

function createApi(initial = serverSnapshot()) {
  return {
    load: vi.fn<() => Promise<LlmSettingsSnapshot>>().mockResolvedValue(initial),
    listModels: vi.fn<LlmSettingsApi['listModels']>().mockResolvedValue(modelResult()),
    test: vi.fn<LlmSettingsApi['test']>().mockImplementation(
      async (draft, workflow) => testResult(workflow, draft.models[workflow]),
    ),
    save: vi.fn<(draft: LlmSettingsDraft) => Promise<LlmSettingsSnapshot>>()
      .mockResolvedValue(initial),
  }
}

async function loadedService(initial = serverSnapshot()) {
  const api = createApi(initial)
  const service = new ScholarLlmSettingsService(api)
  await service.load()
  return { api, service }
}

let Saveable: typeof import('@theia/core/lib/browser').Saveable

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ Saveable } = await import('@theia/core/lib/browser'))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

describe('ScholarLlmSettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads an immutable baseline and clean keep-secret draft', async () => {
    const initial = serverSnapshot()
    const api = createApi(initial)
    const service = new ScholarLlmSettingsService(api)
    const changed = vi.fn()
    service.onDidChange(changed)

    await service.load()

    const state = service.getSnapshot()
    expect(state.loadStatus).toBe('ready')
    expect(state.loadError).toBeNull()
    expect(state.baseline).toEqual(initial)
    expect(state.baseline).not.toBe(initial)
    expect(state.draft).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      secretIntent: 'keep',
      apiKeyInput: '',
      models: initial.models,
    })
    expect(state.draft?.models).not.toBe(initial.models)
    expect(state.dirty).toBe(false)
    expect(changed).toHaveBeenCalled()
  })

  it('keeps only the newest load response and reports a relevant load failure', async () => {
    const api = createApi()
    const first = deferred<LlmSettingsSnapshot>()
    const second = deferred<LlmSettingsSnapshot>()
    api.load
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const service = new ScholarLlmSettingsService(api)

    const firstLoad = service.load()
    const secondLoad = service.load()
    second.resolve(serverSnapshot({ provider: 'ollama', baseUrl: 'https://ollama.com/v1' }))
    await secondLoad
    first.resolve(serverSnapshot({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com' }))
    await firstLoad

    expect(service.getSnapshot().baseline?.provider).toBe('ollama')
    api.load.mockRejectedValueOnce(new Error('Settings unavailable'))
    await expect(service.load()).rejects.toThrow('Settings unavailable')
    expect(service.getSnapshot()).toMatchObject({
      loadStatus: 'error',
      loadError: 'Settings unavailable',
    })
  })

  it('tracks independent model and connection edits, normalized dirty state, and full revert', async () => {
    const { service } = await loadedService()
    const dirtyChanged = vi.fn()
    const contentChanged = vi.fn()
    service.onDirtyChanged(dirtyChanged)
    service.onContentChanged(contentChanged)

    service.setModel('html_injection', 'cheap-html')
    expect(service.getSnapshot().draft?.models).toEqual({
      kg_extraction: 'kg-model',
      html_injection: 'cheap-html',
      tooltip_suggestion: 'tooltip-model',
      chat: 'chat-model',
    })
    expect(service.dirty).toBe(true)
    expect(dirtyChanged).toHaveBeenCalledTimes(1)
    expect(contentChanged).toHaveBeenCalledTimes(1)

    await service.revert()
    expect(service.getSnapshot().draft?.models.html_injection).toBe('html-model')
    expect(service.dirty).toBe(false)
    expect(dirtyChanged).toHaveBeenCalledTimes(2)

    service.updateDraft({ baseUrl: ' https://API.OPENAI.COM/v1/ ' })
    service.setModel('kg_extraction', ' kg-model ')
    expect(service.dirty).toBe(false)
  })

  it('models replace/clear/keep secret intent without pretending to clear environment credentials', async () => {
    const { service } = await loadedService()

    service.setSecretReplace('sk-new')
    expect(service.getSnapshot().draft).toMatchObject({
      secretIntent: 'replace',
      apiKeyInput: 'sk-new',
    })
    expect(service.dirty).toBe(true)
    service.setSecretReplace('')
    expect(service.getSnapshot().draft?.secretIntent).toBe('keep')
    expect(service.dirty).toBe(false)

    service.setSecretClear()
    expect(service.getSnapshot().draft?.secretIntent).toBe('clear')
    expect(service.dirty).toBe(true)
    service.setSecretKeep()
    expect(service.dirty).toBe(false)

    const environment = await loadedService(serverSnapshot({ credentialSource: 'environment' }))
    environment.service.setSecretClear()
    expect(environment.service.getSnapshot().draft?.secretIntent).toBe('keep')
    expect(environment.service.dirty).toBe(false)
  })

  it('validates HTTP endpoints and all three models before save', async () => {
    const { api, service } = await loadedService()
    service.updateDraft({ baseUrl: 'ftp://example.test/v1' })
    service.setModel('tooltip_suggestion', '   ')

    const validation = service.getValidation()
    expect(validation.canSave).toBe(false)
    expect(validation.canListModels).toBe(false)
    expect(validation.canTest.tooltip_suggestion).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      'Base URL must be an HTTP(S) endpoint.',
      'A model is required for Term Highlights.',
    ]))
    await expect(service.save()).rejects.toThrow('Base URL must be an HTTP(S) endpoint.')
    expect(api.save).not.toHaveBeenCalled()
  })

  it('discovers models with the exact draft and ignores an answer after connection edits', async () => {
    const { api, service } = await loadedService()
    service.setSecretReplace('draft-secret')
    const pending = deferred<LlmModelsResult>()
    api.listModels.mockReturnValueOnce(pending.promise)

    const request = service.listModels()
    expect(api.listModels).toHaveBeenCalledWith({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'draft-secret',
      clearApiKey: false,
    })
    expect(service.getSnapshot().models.status).toBe('loading')
    service.updateDraft({ baseUrl: 'https://proxy.example.test/v1' })
    pending.resolve(modelResult())
    await request

    expect(service.getSnapshot().models).toMatchObject({
      status: 'idle',
      result: null,
      fingerprint: null,
    })
  })

  it('retains a recoverable model-list warning and reports discovery errors', async () => {
    const { api, service } = await loadedService()
    api.listModels.mockResolvedValueOnce(modelResult({
      source: 'catalog',
      warning: 'Provider unavailable; showing catalog.',
    }))

    await service.listModels()
    expect(service.getSnapshot().models).toMatchObject({
      status: 'ready',
      result: expect.objectContaining({ source: 'catalog' }),
      error: null,
    })
    expect(service.getSnapshot().models.result?.warning).toContain('showing catalog')

    api.listModels.mockRejectedValueOnce(new Error('Discovery failed'))
    await expect(service.listModels()).rejects.toThrow('Discovery failed')
    expect(service.getSnapshot().models).toMatchObject({
      status: 'error',
      error: 'Discovery failed',
    })
  })

  it('tests exact unsaved rows independently and invalidates only a changed row', async () => {
    const { api, service } = await loadedService()
    const kg = deferred<LlmTestResult>()
    const html = deferred<LlmTestResult>()
    api.test.mockImplementation((_draft, workflow) => (
      workflow === 'kg_extraction' ? kg.promise : html.promise
    ))

    const kgRequest = service.testWorkflow('kg_extraction')
    const htmlRequest = service.testWorkflow('html_injection')
    expect(api.test).toHaveBeenNthCalledWith(1, expect.objectContaining({
      models: {
        kg_extraction: 'kg-model',
        html_injection: 'html-model',
        tooltip_suggestion: 'tooltip-model',
        chat: 'chat-model',
      },
    }), 'kg_extraction')
    expect(service.getSnapshot().testByWorkflow.kg_extraction.status).toBe('pending')
    expect(service.getSnapshot().testByWorkflow.html_injection.status).toBe('pending')

    html.resolve(testResult('html_injection', 'html-model'))
    await htmlRequest
    expect(service.getSnapshot().testByWorkflow.html_injection.status).toBe('success')
    service.setModel('kg_extraction', 'new-kg')
    kg.resolve(testResult('kg_extraction', 'kg-model'))
    await kgRequest

    expect(service.getSnapshot().testByWorkflow.kg_extraction.status).toBe('idle')
    expect(service.getSnapshot().testByWorkflow.html_injection.status).toBe('success')
  })

  it('refuses to test an invalid selected row without calling the API', async () => {
    const { api, service } = await loadedService()
    service.setModel('tooltip_suggestion', '')

    await expect(service.testWorkflow('tooltip_suggestion'))
      .rejects.toThrow('A model is required for Term Highlights.')
    expect(api.test).not.toHaveBeenCalled()
  })

  it('serializes replace intent, adopts the normalized save response, and clears plaintext', async () => {
    const { api, service } = await loadedService()
    const normalized = serverSnapshot({
      baseUrl: 'https://proxy.example.test/v1',
      apiKeyMasked: 'sk-n...cret',
      models: {
        kg_extraction: 'new-kg',
        html_injection: 'html-model',
        tooltip_suggestion: 'tooltip-model',
        chat: 'chat-model',
      },
    })
    api.save.mockResolvedValueOnce(normalized)
    service.updateDraft({ baseUrl: 'https://proxy.example.test/v1/' })
    service.setModel('kg_extraction', 'new-kg')
    service.setSecretReplace('sk-new-secret')

    await service.save()

    expect(api.save).toHaveBeenCalledWith({
      provider: 'openai',
      baseUrl: 'https://proxy.example.test/v1/',
      apiKey: 'sk-new-secret',
      clearApiKey: false,
      models: {
        kg_extraction: 'new-kg',
        html_injection: 'html-model',
        tooltip_suggestion: 'tooltip-model',
        chat: 'chat-model',
      },
    })
    expect(service.getSnapshot()).toMatchObject({
      baseline: normalized,
      draft: {
        baseUrl: 'https://proxy.example.test/v1',
        secretIntent: 'keep',
        apiKeyInput: '',
      },
      dirty: false,
      saving: false,
      saveError: null,
    })
  })

  it('keeps a dirty draft after failed Save and serializes concurrent Save calls', async () => {
    const { api, service } = await loadedService()
    service.setModel('kg_extraction', 'new-kg')
    const pending = deferred<LlmSettingsSnapshot>()
    api.save.mockReturnValueOnce(pending.promise)

    const firstSave = service.save()
    const secondSave = service.save()
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot().saving).toBe(true)
    expect(() => service.setModel('html_injection', 'blocked'))
      .toThrow('LLM settings are being saved.')
    pending.reject(new Error('Save failed'))

    await expect(firstSave).rejects.toThrow('Save failed')
    await expect(secondSave).rejects.toThrow('Save failed')
    expect(service.getSnapshot()).toMatchObject({
      saving: false,
      saveError: 'Save failed',
      dirty: true,
      draft: { models: { kg_extraction: 'new-kg' } },
    })
  })

  it('serializes keep and clear intents distinctly', async () => {
    const { api, service } = await loadedService()
    service.setModel('kg_extraction', 'new-kg')
    await service.save()
    expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({
      apiKey: '',
      clearApiKey: false,
    }))

    api.save.mockResolvedValueOnce(serverSnapshot({
      apiKeyMasked: null,
      hasApiKey: false,
      credentialSource: 'none',
      models: { ...serverSnapshot().models, kg_extraction: 'second-kg' },
    }))
    service.setModel('kg_extraction', 'second-kg')
    service.setSecretClear()
    await service.save()
    expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({
      apiKey: '',
      clearApiKey: true,
    }))
  })

  it('is a real Theia Saveable whose revert restores data for Don’t Save', async () => {
    const { service } = await loadedService()
    expect(Saveable.is(service)).toBe(true)
    expect(Saveable.get(service)).toBe(service)

    service.setModel('kg_extraction', 'discard-me')
    expect(Saveable.isDirty(service)).toBe(true)
    await service.revert({ soft: true })

    expect(service.getSnapshot().draft?.models.kg_extraction).toBe('kg-model')
    expect(Saveable.isDirty(service)).toBe(false)
  })
})