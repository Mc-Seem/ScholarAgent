import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsDialog from '@/components/reader/SettingsDialog'
import type {
  LlmModelsResult,
  LlmSettingsSnapshot,
  LlmTestResult,
  LlmWorkflow,
} from '@/lib/llm-settings-api'


function makeSnapshot(
  overrides: Partial<LlmSettingsSnapshot> = {},
): LlmSettingsSnapshot {
  return {
    id: 4,
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

function makeModelsResult(
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

function createApi(snapshot = makeSnapshot()) {
  return {
    load: vi.fn(async () => snapshot),
    listModels: vi.fn(async () => makeModelsResult({
      provider: snapshot.provider,
      baseUrl: snapshot.baseUrl,
    })),
    test: vi.fn(async (_draft, workflow: LlmWorkflow): Promise<LlmTestResult> => ({
      success: true,
      message: 'Connection succeeded.',
      workflow,
      modelUsed: `${workflow}-actual`,
    })),
    save: vi.fn(async () => snapshot),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('SettingsDialog draft-aware LLM settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the normalized snapshot as three independent accessible model controls', async () => {
    const api = createApi()

    render(<SettingsDialog isOpen onClose={vi.fn()} api={api} />)

    expect(await screen.findByRole('dialog', { name: 'LLM Provider Settings' }))
      .toBeInTheDocument()
    expect(screen.getByLabelText('Provider')).toHaveValue('openai')
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1')
    expect(screen.getByLabelText('KG Extraction model')).toHaveValue('kg-model')
    expect(screen.getByLabelText('HTML Injection model')).toHaveValue('html-model')
    expect(screen.getByLabelText('Tooltip Suggestion model')).toHaveValue('tooltip-model')
    expect(screen.getByText(/Saved in database/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Test .* model$/ })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Test Connection' })).not.toBeInTheDocument()
  })

  it('tests one exact unsaved model row without implicitly saving or coupling models', async () => {
    const user = userEvent.setup()
    const api = createApi()
    api.test.mockResolvedValueOnce({
      success: true,
      message: 'HTML draft works.',
      workflow: 'html_injection',
      modelUsed: 'budget-html-server',
    })
    render(<SettingsDialog isOpen onClose={vi.fn()} api={api} />)

    const htmlModel = await screen.findByLabelText('HTML Injection model')
    await user.clear(htmlModel)
    await user.type(htmlModel, 'budget-html')
    await user.type(screen.getByLabelText('API Key'), 'draft-secret')
    await user.click(screen.getByRole('button', { name: 'Test HTML Injection model' }))

    await waitFor(() => expect(api.test).toHaveBeenCalledWith({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'draft-secret',
      clearApiKey: false,
      models: {
        kg_extraction: 'kg-model',
        html_injection: 'budget-html',
        tooltip_suggestion: 'tooltip-model',
      },
    }, 'html_injection'))
    expect(api.save).not.toHaveBeenCalled()
    expect(screen.getByLabelText('KG Extraction model')).toHaveValue('kg-model')
    expect(screen.getByLabelText('Tooltip Suggestion model')).toHaveValue('tooltip-model')
    expect(await screen.findByText('HTML draft works.')).toBeInTheDocument()
    expect(screen.getByText('Model: budget-html-server')).toBeInTheDocument()
  })

  it('persists explicit database-key removal and then shows the environment source honestly', async () => {
    const user = userEvent.setup()
    const api = createApi()
    api.save.mockResolvedValueOnce(makeSnapshot({
      apiKeyMasked: 'sk-e...ment',
      credentialSource: 'environment',
    }))
    render(<SettingsDialog isOpen onClose={vi.fn()} api={api} />)

    await user.type(await screen.findByLabelText('Base URL'), '/')
    await user.click(await screen.findByRole('button', { name: 'Remove saved API key' }))
    expect(screen.getByText(/database key will be removed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    await waitFor(() => expect(api.save).toHaveBeenCalledWith({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1/',
      apiKey: '',
      clearApiKey: true,
      models: {
        kg_extraction: 'kg-model',
        html_injection: 'html-model',
        tooltip_suggestion: 'tooltip-model',
      },
    }))
    expect(await screen.findByText('Environment variable', { selector: 'strong' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove saved API key' }))
      .not.toBeInTheDocument()
  })

  it('does not offer to remove an environment credential from the server', async () => {
    const api = createApi(makeSnapshot({
      apiKeyMasked: 'sk-e...ment',
      credentialSource: 'environment',
    }))

    render(<SettingsDialog isOpen onClose={vi.fn()} api={api} />)

    expect(await screen.findByText('Environment variable', { selector: 'strong' }))
      .toBeInTheDocument()
    expect(screen.getByText(/cannot be removed here/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove saved API key' }))
      .not.toBeInTheDocument()
  })

  it('keeps the newest model discovery result when an older draft responds later', async () => {
    const api = createApi()
    const oldRequest = deferred<LlmModelsResult>()
    const newRequest = deferred<LlmModelsResult>()
    api.listModels
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)
    render(<SettingsDialog isOpen onClose={vi.fn()} api={api} />)

    await screen.findByLabelText('Provider')
    await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1), { timeout: 1500 })
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'ollama' } })
    await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(2), { timeout: 1500 })

    await act(async () => {
      newRequest.resolve(makeModelsResult({
        provider: 'ollama',
        baseUrl: 'https://ollama.com/v1',
        models: [{ id: 'fresh-ollama', name: 'Fresh Ollama' }],
      }))
    })
    await act(async () => {
      oldRequest.resolve(makeModelsResult({
        models: [{ id: 'stale-openai', name: 'Stale OpenAI' }],
      }))
    })

    fireEvent.focus(screen.getByLabelText('KG Extraction model'))
    expect(await screen.findByText('fresh-ollama')).toBeInTheDocument()
    expect(screen.queryByText('stale-openai')).not.toBeInTheDocument()
  })

  it('discards a row test result when that row model changes before completion', async () => {
    const api = createApi()
    const pending = deferred<LlmTestResult>()
    api.test.mockReturnValueOnce(pending.promise)
    render(<SettingsDialog isOpen onClose={vi.fn()} api={api} />)

    await screen.findByLabelText('HTML Injection model')
    fireEvent.click(screen.getByRole('button', { name: 'Test HTML Injection model' }))
    await waitFor(() => expect(api.test).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('HTML Injection model'), {
      target: { value: 'new-html-model' },
    })
    await act(async () => {
      pending.resolve({
        success: true,
        message: 'Stale HTML result',
        workflow: 'html_injection',
        modelUsed: 'html-model',
      })
    })

    expect(screen.queryByText('Stale HTML result')).not.toBeInTheDocument()
  })

  it('keeps manual model entry available when discovery fails', async () => {
    const user = userEvent.setup()
    const api = createApi()
    api.listModels.mockRejectedValueOnce(new Error('Catalog unavailable'))
    render(<SettingsDialog isOpen onClose={vi.fn()} api={api} />)

    const model = await screen.findByLabelText('Tooltip Suggestion model')
    await waitFor(() => expect(api.listModels).toHaveBeenCalled())
    await user.clear(model)
    await user.type(model, 'manual-custom-id')

    expect(model).toHaveValue('manual-custom-id')
    expect(await screen.findByText('Catalog unavailable')).toBeInTheDocument()
  })
})