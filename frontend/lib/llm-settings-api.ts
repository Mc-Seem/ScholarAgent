import { API_BASE, apiUrl } from '../hooks/useApi'


export const LLM_PROVIDERS = ['anthropic', 'openai', 'ollama', 'custom'] as const
export const LLM_WORKFLOWS = [
  'kg_extraction',
  'html_injection',
  'tooltip_suggestion',
  'chat',
] as const

export type LlmProvider = typeof LLM_PROVIDERS[number]
export type LlmWorkflow = typeof LLM_WORKFLOWS[number]
export type CredentialSource = 'database' | 'environment' | 'none'
export type ModelListSource = 'provider' | 'catalog'
export type WorkflowModels = Record<LlmWorkflow, string>

export interface LlmConnectionDraft {
  provider: LlmProvider
  baseUrl: string
  apiKey: string
  clearApiKey: boolean
}

export interface LlmSettingsDraft extends LlmConnectionDraft {
  models: WorkflowModels
}

export interface LlmSettingsSnapshot {
  id: number
  provider: LlmProvider
  baseUrl: string
  apiKeyMasked: string | null
  hasApiKey: boolean
  credentialSource: CredentialSource
  credentialRequired: boolean
  models: WorkflowModels
  isActive: boolean
}

export interface LlmModelInfo {
  id: string
  name: string
}

export interface LlmModelsResult {
  provider: LlmProvider
  baseUrl: string
  source: ModelListSource
  models: LlmModelInfo[]
  warning: string | null
}

export interface LlmTestResult {
  success: boolean
  message: string
  workflow: LlmWorkflow
  modelUsed: string
}

export interface LlmSettingsApi {
  load(): Promise<LlmSettingsSnapshot>
  listModels(draft: LlmConnectionDraft): Promise<LlmModelsResult>
  test(draft: LlmSettingsDraft, workflow: LlmWorkflow): Promise<LlmTestResult>
  save(draft: LlmSettingsDraft): Promise<LlmSettingsSnapshot>
}

interface WireConnectionDraft {
  provider: LlmProvider
  base_url: string
  api_key: string
  clear_api_key: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && LLM_PROVIDERS.includes(value as LlmProvider)
}

function isWorkflow(value: unknown): value is LlmWorkflow {
  return typeof value === 'string' && LLM_WORKFLOWS.includes(value as LlmWorkflow)
}

function isCredentialSource(value: unknown): value is CredentialSource {
  return value === 'database' || value === 'environment' || value === 'none'
}

function isModelListSource(value: unknown): value is ModelListSource {
  return value === 'provider' || value === 'catalog'
}

function malformedResponse(): never {
  throw new Error('Malformed response from server')
}

function parseWorkflowModels(value: unknown): WorkflowModels {
  if (!isRecord(value)) {
    return malformedResponse()
  }
  const models = {} as WorkflowModels
  for (const workflow of LLM_WORKFLOWS) {
    const model = value[workflow]
    if (typeof model !== 'string') {
      return malformedResponse()
    }
    models[workflow] = model
  }
  return models
}

function parseSnapshot(value: unknown): LlmSettingsSnapshot {
  if (!isRecord(value)
    || typeof value.id !== 'number'
    || !Number.isInteger(value.id)
    || value.id < 0
    || !isProvider(value.provider)
    || typeof value.base_url !== 'string'
    || !value.base_url
    || !(value.api_key_masked === null || typeof value.api_key_masked === 'string')
    || typeof value.has_api_key !== 'boolean'
    || !isCredentialSource(value.credential_source)
    || typeof value.credential_required !== 'boolean'
    || typeof value.is_active !== 'boolean') {
    return malformedResponse()
  }

  if ((value.credential_source === 'none') !== !value.has_api_key) {
    return malformedResponse()
  }

  return {
    id: value.id,
    provider: value.provider,
    baseUrl: value.base_url,
    apiKeyMasked: value.api_key_masked,
    hasApiKey: value.has_api_key,
    credentialSource: value.credential_source,
    credentialRequired: value.credential_required,
    models: parseWorkflowModels(value.models),
    isActive: value.is_active,
  }
}

function parseModelInfo(value: unknown): LlmModelInfo {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.name !== 'string'
    || !value.name.trim()) {
    return malformedResponse()
  }
  return { id: value.id, name: value.name }
}

function parseModelsResult(value: unknown): LlmModelsResult {
  if (!isRecord(value)
    || !isProvider(value.provider)
    || typeof value.base_url !== 'string'
    || !value.base_url
    || !isModelListSource(value.source)
    || !Array.isArray(value.models)
    || !(value.warning === null || typeof value.warning === 'string')) {
    return malformedResponse()
  }
  return {
    provider: value.provider,
    baseUrl: value.base_url,
    source: value.source,
    models: value.models.map(parseModelInfo),
    warning: value.warning,
  }
}

function parseTestResult(value: unknown): LlmTestResult {
  if (!isRecord(value)
    || typeof value.success !== 'boolean'
    || typeof value.message !== 'string'
    || !isWorkflow(value.workflow)
    || typeof value.model_used !== 'string'
    || !value.model_used.trim()) {
    return malformedResponse()
  }
  return {
    success: value.success,
    message: value.message,
    workflow: value.workflow,
    modelUsed: value.model_used,
  }
}

function wireConnection(draft: LlmConnectionDraft): WireConnectionDraft {
  return {
    provider: draft.provider,
    base_url: draft.baseUrl,
    api_key: draft.apiKey,
    clear_api_key: draft.clearApiKey,
  }
}

function sanitizeMessage(message: string, secrets: readonly string[]): string {
  let sanitized = message
  for (const secret of secrets) {
    if (secret) {
      sanitized = sanitized.split(secret).join('[redacted]')
    }
  }
  sanitized = sanitized
    .replace(/(Authorization\s*:?\s*Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/([?&]api_key=)[^&\s]+/gi, '$1[redacted]')
  return sanitized.slice(0, 500)
}

export class HttpLlmSettingsApi implements LlmSettingsApi {
  constructor(private readonly apiBase = API_BASE) {}

  async load(): Promise<LlmSettingsSnapshot> {
    return parseSnapshot(await this.request('/api/settings/llm'))
  }

  async listModels(draft: LlmConnectionDraft): Promise<LlmModelsResult> {
    const result = parseModelsResult(await this.request(
      '/api/settings/llm/models',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wireConnection(draft)),
      },
      [draft.apiKey],
    ))
    return result.provider === draft.provider ? result : malformedResponse()
  }

  async test(draft: LlmSettingsDraft, workflow: LlmWorkflow): Promise<LlmTestResult> {
    const result = parseTestResult(await this.request(
      '/api/settings/llm/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...wireConnection(draft),
          workflow,
          model: draft.models[workflow],
        }),
      },
      [draft.apiKey],
    ))
    return result.workflow === workflow ? result : malformedResponse()
  }

  async save(draft: LlmSettingsDraft): Promise<LlmSettingsSnapshot> {
    return parseSnapshot(await this.request(
      '/api/settings/llm',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...wireConnection(draft),
          models: draft.models,
        }),
      },
      [draft.apiKey],
    ))
  }

  private async request(
    endpoint: string,
    options?: RequestInit,
    secrets: readonly string[] = [],
  ): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(apiUrl(endpoint, this.apiBase), options)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Request failed'
      throw new Error(sanitizeMessage(message, secrets))
    }

    if (!response.ok) {
      let detail = response.statusText || 'Request failed'
      try {
        const body = await response.json() as unknown
        if (isRecord(body) && typeof body.detail === 'string' && body.detail) {
          detail = body.detail
        }
      } catch {
        // Keep the status text when the error body is not JSON.
      }
      throw new Error(sanitizeMessage(detail, secrets))
    }

    try {
      return await response.json() as unknown
    } catch {
      return malformedResponse()
    }
  }
}