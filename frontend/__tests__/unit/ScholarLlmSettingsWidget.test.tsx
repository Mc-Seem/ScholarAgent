import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type {
  LlmSettingsApi,
  LlmSettingsDraft,
  LlmSettingsSnapshot,
} from '@/lib/llm-settings-api'
import { ScholarLlmSettingsService } from '@/theia/scholar-extension/src/browser/scholar-llm-settings-service'
import type {
  ScholarLlmSettingsContent as ScholarLlmSettingsContentComponent,
  ScholarLlmSettingsWidget as ScholarLlmSettingsWidgetClass,
} from '@/theia/scholar-extension/src/browser/scholar-llm-settings-widget'


let ScholarLlmSettingsContent: typeof ScholarLlmSettingsContentComponent
let ScholarLlmSettingsWidget: typeof ScholarLlmSettingsWidgetClass
let SCHOLAR_LLM_SETTINGS_WIDGET_ID: string
beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({
    ScholarLlmSettingsContent,
    ScholarLlmSettingsWidget,
    SCHOLAR_LLM_SETTINGS_WIDGET_ID,
  } = await import('@/theia/scholar-extension/src/browser/scholar-llm-settings-widget'))
})

afterEach(() => cleanup())

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

function serverSnapshot(
  overrides: Partial<LlmSettingsSnapshot> = {},
): LlmSettingsSnapshot {
  return {
    id: 3,
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
    },
    isActive: true,
    ...overrides,
  }
}

function createApi(initial = serverSnapshot()) {
  return {
    load: vi.fn<() => Promise<LlmSettingsSnapshot>>().mockResolvedValue(initial),
    listModels: vi.fn<LlmSettingsApi['listModels']>().mockResolvedValue({
      provider: initial.provider,
      baseUrl: initial.baseUrl,
      source: 'provider',
      models: [{ id: 'available-model', name: 'Available Model' }],
      warning: null,
    }),
    test: vi.fn<LlmSettingsApi['test']>().mockImplementation(async (draft, workflow) => ({
      success: true,
      message: 'Connection succeeded.',
      workflow,
      modelUsed: draft.models[workflow],
    })),
    save: vi.fn<(draft: LlmSettingsDraft) => Promise<LlmSettingsSnapshot>>()
      .mockResolvedValue(initial),
  }
}

function createMessages() {
  return {
    error: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
  }
}

async function readyContext(initial = serverSnapshot()) {
  const api = createApi(initial)
  const service = new ScholarLlmSettingsService(api)
  await service.load()
  const messages = createMessages()
  return { api, service, messages }
}

function renderContent(
  service: ScholarLlmSettingsService,
  messages = createMessages(),
): void {
  render(
    <ScholarLlmSettingsContent
      settings={service}
      messageService={messages as never}
    />,
  )
}

describe('ScholarLlmSettingsContent', () => {
  it('renders an accessible loading state before settings resolve', () => {
    const api = createApi()
    api.load.mockReturnValueOnce(new Promise(() => undefined))
    const service = new ScholarLlmSettingsService(api)
    void service.load()

    renderContent(service)

    expect(screen.getByRole('status', { name: 'Loading LLM settings' })).toBeTruthy()
    expect(screen.queryByLabelText('Provider')).toBeNull()
  })

  it('renders native fields for one connection and three independent workflows', async () => {
    const { service, messages } = await readyContext()

    renderContent(service, messages)

    expect(screen.getByLabelText('Provider')).toHaveValue('openai')
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1')
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(screen.getByLabelText('Model for kg_extraction')).toHaveValue('kg-model')
    expect(screen.getByLabelText('Model for html_injection')).toHaveValue('html-model')
    expect(screen.getByLabelText('Model for tooltip_suggestion')).toHaveValue('tooltip-model')
    expect(screen.getByText(/Saved in database/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save LLM settings' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Revert LLM settings' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: /^Test .* connection$/ })).toHaveLength(3)
  })

  it('edits connection, model, and database-key intent through native controls', async () => {
    const { service } = await readyContext()
    renderContent(service)

    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://proxy.example.test/v1' },
    })
    fireEvent.change(screen.getByLabelText('Model for html_injection'), {
      target: { value: 'cheap-html' },
    })
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'draft-secret' },
    })

    expect(service.getSnapshot().draft).toMatchObject({
      baseUrl: 'https://proxy.example.test/v1',
      secretIntent: 'replace',
      apiKeyInput: 'draft-secret',
      models: { html_injection: 'cheap-html' },
    })
    expect(screen.getByRole('button', { name: 'Save LLM settings' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove saved API key' }))
    expect(service.getSnapshot().draft).toMatchObject({
      secretIntent: 'clear',
      apiKeyInput: '',
    })
    expect(screen.getByLabelText('API key')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep saved API key' }))
    expect(service.getSnapshot().draft?.secretIntent).toBe('keep')
  })

  it('never offers server-side removal for an environment credential', async () => {
    const { service } = await readyContext(serverSnapshot({
      credentialSource: 'environment',
      apiKeyMasked: 'sk-e...ment',
    }))

    renderContent(service)

    expect(screen.getByText(/Environment variable/)).toBeTruthy()
    expect(screen.getByText(/cannot be removed here/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove saved API key' })).toBeNull()
  })

  it('discovers models for the draft while keeping manual model inputs editable', async () => {
    const { api, service } = await readyContext()
    api.listModels.mockResolvedValueOnce({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      source: 'catalog',
      models: [{ id: 'catalog-model', name: 'Catalog Model' }],
      warning: 'Provider unavailable; showing catalog.',
    })
    renderContent(service)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh model list' }))

    await waitFor(() => expect(api.listModels).toHaveBeenCalledWith({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      clearApiKey: false,
    }))
    expect(await screen.findByText('Provider unavailable; showing catalog.')).toBeTruthy()
    expect(document.querySelector('option[value="catalog-model"]')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Model for kg_extraction'), {
      target: { value: 'manual-model-id' },
    })
    expect(screen.getByLabelText('Model for kg_extraction')).toHaveValue('manual-model-id')
  })

  it('tests one selected row and hides its result after a relevant edit', async () => {
    const { api, service } = await readyContext()
    renderContent(service)

    fireEvent.click(screen.getByRole('button', { name: 'Test html_injection connection' }))

    await waitFor(() => expect(api.test).toHaveBeenCalledWith(expect.objectContaining({
      models: expect.objectContaining({ html_injection: 'html-model' }),
    }), 'html_injection'))
    expect(await screen.findByText('Connection succeeded.')).toBeTruthy()
    expect(screen.getByText('Model: html-model')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Model for html_injection'), {
      target: { value: 'new-html-model' },
    })
    expect(screen.queryByText('Connection succeeded.')).toBeNull()
    fireEvent.change(screen.getByLabelText('Model for tooltip_suggestion'), {
      target: { value: '' },
    })
    expect(screen.getByRole('button', { name: 'Test tooltip_suggestion connection' }))
      .toBeDisabled()
  })

  it('keeps failed Save dirty, reports it, and supports full Revert', async () => {
    const { api, service, messages } = await readyContext()
    api.save.mockRejectedValueOnce(new Error('Save failed'))
    renderContent(service, messages)
    fireEvent.change(screen.getByLabelText('Model for kg_extraction'), {
      target: { value: 'new-kg' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save LLM settings' }))

    await waitFor(() => expect(messages.error).toHaveBeenCalledWith(
      'Could not save LLM settings: Save failed',
    ))
    expect(service.dirty).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed')
    fireEvent.click(screen.getByRole('button', { name: 'Revert LLM settings' }))
    expect(screen.getByLabelText('Model for kg_extraction')).toHaveValue('kg-model')
    expect(service.dirty).toBe(false)
  })
})

describe('ScholarLlmSettingsWidget SaveableSource', () => {
  it('exposes the singleton service without serializing draft or plaintext state', async () => {
    const api = createApi()
    const service = new ScholarLlmSettingsService(api)
    const messages = createMessages()
    const widget = new ScholarLlmSettingsWidget(service, messages as never)

    expect(widget.id).toBe(SCHOLAR_LLM_SETTINGS_WIDGET_ID)
    expect(widget.title.label).toBe('LLM Settings')
    expect(widget.title.closable).toBe(true)
    expect(widget.saveable).toBe(service)
    expect('storeState' in widget).toBe(false)
    expect('restoreState' in widget).toBe(false)

    widget.ensureLoaded()
    await waitFor(() => expect(api.load).toHaveBeenCalledTimes(1))
    widget.ensureLoaded()
    expect(api.load).toHaveBeenCalledTimes(1)
    widget.dispose()
  })
})