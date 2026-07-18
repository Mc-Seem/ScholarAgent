import { Emitter, Event } from '@theia/core'
import type { Saveable, SaveOptions } from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import {
  HttpLlmSettingsApi,
  LLM_WORKFLOWS,
  type LlmConnectionDraft,
  type LlmModelsResult,
  type LlmProvider,
  type LlmSettingsApi,
  type LlmSettingsDraft,
  type LlmSettingsSnapshot,
  type LlmTestResult,
  type LlmWorkflow,
  type WorkflowModels,
} from '../../../../lib/llm-settings-api'


export type LlmSecretIntent = 'keep' | 'replace' | 'clear'
export type LlmSettingsLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type LlmAsyncStatus = 'idle' | 'loading' | 'ready' | 'error'
export type LlmWorkflowTestStatus = 'idle' | 'pending' | 'success' | 'failure'

export interface LlmSettingsDraftState {
  readonly provider: LlmProvider
  readonly baseUrl: string
  readonly secretIntent: LlmSecretIntent
  readonly apiKeyInput: string
  readonly models: WorkflowModels
}

export interface LlmModelsState {
  readonly status: LlmAsyncStatus
  readonly result: LlmModelsResult | null
  readonly error: string | null
  readonly fingerprint: string | null
}

export interface LlmWorkflowTestState {
  readonly status: LlmWorkflowTestStatus
  readonly result: LlmTestResult | null
  readonly error: string | null
  readonly fingerprint: string | null
}

export interface LlmSettingsValidation {
  readonly canSave: boolean
  readonly canListModels: boolean
  readonly canTest: Readonly<Record<LlmWorkflow, boolean>>
  readonly errors: readonly string[]
  readonly testErrors: Readonly<Record<LlmWorkflow, readonly string[]>>
}

export interface ScholarLlmSettingsSnapshot {
  readonly loadStatus: LlmSettingsLoadStatus
  readonly loadError: string | null
  readonly baseline: LlmSettingsSnapshot | null
  readonly draft: LlmSettingsDraftState | null
  readonly dirty: boolean
  readonly saving: boolean
  readonly saveError: string | null
  readonly models: LlmModelsState
  readonly testByWorkflow: Readonly<Record<LlmWorkflow, LlmWorkflowTestState>>
  readonly validation: LlmSettingsValidation
}

type Listener = () => void

const WORKFLOW_LABELS: Record<LlmWorkflow, string> = {
  kg_extraction: 'Knowledge Graph',
  html_injection: 'HTML Injection',
  tooltip_suggestion: 'Tooltip Suggestions',
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : 'Unknown error'
}

function emptyModelsState(): LlmModelsState {
  return {
    status: 'idle',
    result: null,
    error: null,
    fingerprint: null,
  }
}

function emptyTestState(): LlmWorkflowTestState {
  return {
    status: 'idle',
    result: null,
    error: null,
    fingerprint: null,
  }
}

function emptyTests(): Record<LlmWorkflow, LlmWorkflowTestState> {
  return {
    kg_extraction: emptyTestState(),
    html_injection: emptyTestState(),
    tooltip_suggestion: emptyTestState(),
  }
}

function cloneWorkflowModels(models: WorkflowModels): WorkflowModels {
  return {
    kg_extraction: models.kg_extraction,
    html_injection: models.html_injection,
    tooltip_suggestion: models.tooltip_suggestion,
  }
}

function cloneServerSnapshot(snapshot: LlmSettingsSnapshot): LlmSettingsSnapshot {
  return {
    ...snapshot,
    models: cloneWorkflowModels(snapshot.models),
  }
}

function draftFromBaseline(baseline: LlmSettingsSnapshot): LlmSettingsDraftState {
  return {
    provider: baseline.provider,
    baseUrl: baseline.baseUrl,
    secretIntent: 'keep',
    apiKeyInput: '',
    models: cloneWorkflowModels(baseline.models),
  }
}

function normalizeComparableUrl(value: string): string {
  const trimmed = value.trim()
  try {
    const parsed = new URL(trimmed)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}`
  } catch {
    return trimmed
  }
}

function isValidEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value.trim())
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
  } catch {
    return false
  }
}

function connectionErrors(draft: LlmSettingsDraftState): string[] {
  const errors: string[] = []
  if (!isValidEndpoint(draft.baseUrl)) {
    errors.push('Base URL must be an HTTP(S) endpoint.')
  }
  if (draft.secretIntent === 'replace' && !draft.apiKeyInput.trim()) {
    errors.push('A replacement API key cannot be empty.')
  }
  return errors
}

export function validateLlmSettingsDraft(
  draft: LlmSettingsDraftState | null,
): LlmSettingsValidation {
  if (!draft) {
    const errors = ['LLM settings have not loaded.']
    return {
      canSave: false,
      canListModels: false,
      canTest: {
        kg_extraction: false,
        html_injection: false,
        tooltip_suggestion: false,
      },
      errors,
      testErrors: {
        kg_extraction: errors,
        html_injection: errors,
        tooltip_suggestion: errors,
      },
    }
  }

  const sharedErrors = connectionErrors(draft)
  const testErrors = {} as Record<LlmWorkflow, readonly string[]>
  const canTest = {} as Record<LlmWorkflow, boolean>
  const errors = [...sharedErrors]
  for (const workflow of LLM_WORKFLOWS) {
    const workflowErrors = [...sharedErrors]
    if (!draft.models[workflow].trim()) {
      const message = `A model is required for ${WORKFLOW_LABELS[workflow]}.`
      workflowErrors.push(message)
      errors.push(message)
    }
    testErrors[workflow] = workflowErrors
    canTest[workflow] = workflowErrors.length === 0
  }

  return {
    canSave: errors.length === 0,
    canListModels: sharedErrors.length === 0,
    canTest,
    errors,
    testErrors,
  }
}

function computeDirty(
  baseline: LlmSettingsSnapshot | null,
  draft: LlmSettingsDraftState | null,
): boolean {
  if (!baseline || !draft) {
    return false
  }
  if (baseline.provider !== draft.provider
    || normalizeComparableUrl(baseline.baseUrl) !== normalizeComparableUrl(draft.baseUrl)) {
    return true
  }
  for (const workflow of LLM_WORKFLOWS) {
    if (baseline.models[workflow].trim() !== draft.models[workflow].trim()) {
      return true
    }
  }
  if (draft.secretIntent === 'replace') {
    return Boolean(draft.apiKeyInput.trim())
  }
  return draft.secretIntent === 'clear' && baseline.credentialSource === 'database'
}

function hashFingerprint(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function connectionFingerprint(draft: LlmSettingsDraftState): string {
  return hashFingerprint(JSON.stringify([
    draft.provider,
    normalizeComparableUrl(draft.baseUrl),
    draft.secretIntent,
    draft.apiKeyInput,
  ]))
}

function workflowFingerprint(
  draft: LlmSettingsDraftState,
  workflow: LlmWorkflow,
): string {
  return hashFingerprint(JSON.stringify([
    connectionFingerprint(draft),
    workflow,
    draft.models[workflow].trim(),
  ]))
}

function toConnectionDraft(draft: LlmSettingsDraftState): LlmConnectionDraft {
  return {
    provider: draft.provider,
    baseUrl: draft.baseUrl,
    apiKey: draft.secretIntent === 'replace' ? draft.apiKeyInput : '',
    clearApiKey: draft.secretIntent === 'clear',
  }
}

function toSettingsDraft(draft: LlmSettingsDraftState): LlmSettingsDraft {
  return {
    ...toConnectionDraft(draft),
    models: cloneWorkflowModels(draft.models),
  }
}

function initialSnapshot(): ScholarLlmSettingsSnapshot {
  return {
    loadStatus: 'idle',
    loadError: null,
    baseline: null,
    draft: null,
    dirty: false,
    saving: false,
    saveError: null,
    models: emptyModelsState(),
    testByWorkflow: emptyTests(),
    validation: validateLlmSettingsDraft(null),
  }
}

@injectable()
export class ScholarLlmSettingsService implements Saveable {
  private readonly changeEmitter = new Emitter<void>()
  private readonly dirtyChangedEmitter = new Emitter<void>()
  private readonly contentChangedEmitter = new Emitter<void>()
  private snapshot = initialSnapshot()
  private loadGeneration = 0
  private modelsGeneration = 0
  private testGenerations: Record<LlmWorkflow, number> = {
    kg_extraction: 0,
    html_injection: 0,
    tooltip_suggestion: 0,
  }
  private savePromise: Promise<void> | null = null

  readonly autosaveable = false
  readonly onDidChange: Event<void> = this.changeEmitter.event
  readonly onDirtyChanged: Event<void> = this.dirtyChangedEmitter.event
  readonly onContentChanged: Event<void> = this.contentChangedEmitter.event

  constructor(
    @inject(HttpLlmSettingsApi) private readonly api: LlmSettingsApi,
  ) {}

  get dirty(): boolean {
    return this.snapshot.dirty
  }

  getSnapshot = (): ScholarLlmSettingsSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    const disposable = this.onDidChange(listener)
    return () => disposable.dispose()
  }

  getValidation(): LlmSettingsValidation {
    return this.snapshot.validation
  }

  isModelsResultCurrent(): boolean {
    const { draft, models } = this.snapshot
    return Boolean(
      draft
      && models.fingerprint
      && models.fingerprint === connectionFingerprint(draft)
    )
  }

  isTestResultCurrent(workflow: LlmWorkflow): boolean {
    const { draft } = this.snapshot
    const test = this.snapshot.testByWorkflow[workflow]
    return Boolean(
      draft
      && test.fingerprint
      && test.fingerprint === workflowFingerprint(draft, workflow)
    )
  }

  async load(): Promise<void> {
    if (this.snapshot.saving) {
      throw new Error('LLM settings are being saved.')
    }
    const generation = ++this.loadGeneration
    this.publish({ loadStatus: 'loading', loadError: null })
    try {
      const loaded = await this.api.load()
      if (generation !== this.loadGeneration) {
        return
      }
      this.invalidateAsyncOperations()
      const baseline = cloneServerSnapshot(loaded)
      this.publish({
        loadStatus: 'ready',
        loadError: null,
        baseline,
        draft: draftFromBaseline(baseline),
        saveError: null,
        models: emptyModelsState(),
        testByWorkflow: emptyTests(),
      })
    } catch (reason) {
      if (generation !== this.loadGeneration) {
        return
      }
      this.publish({
        loadStatus: 'error',
        loadError: errorMessage(reason),
      })
      throw reason
    }
  }

  updateDraft(patch: Partial<Pick<LlmSettingsDraftState, 'provider' | 'baseUrl'>>): void {
    this.ensureMutable()
    const draft = this.requireDraft()
    const provider = patch.provider ?? draft.provider
    const baseUrl = patch.baseUrl ?? draft.baseUrl
    if (provider === draft.provider && baseUrl === draft.baseUrl) {
      return
    }
    const providerChanged = provider !== draft.provider
    this.invalidateAsyncOperations()
    this.publish({
      draft: {
        ...draft,
        provider,
        baseUrl,
        secretIntent: providerChanged ? 'keep' : draft.secretIntent,
        apiKeyInput: providerChanged ? '' : draft.apiKeyInput,
        models: cloneWorkflowModels(draft.models),
      },
      models: emptyModelsState(),
      testByWorkflow: emptyTests(),
      saveError: null,
    }, true)
  }

  setModel(workflow: LlmWorkflow, model: string): void {
    this.ensureMutable()
    const draft = this.requireDraft()
    if (draft.models[workflow] === model) {
      return
    }
    this.testGenerations[workflow] += 1
    this.publish({
      draft: {
        ...draft,
        models: { ...draft.models, [workflow]: model },
      },
      testByWorkflow: {
        ...this.snapshot.testByWorkflow,
        [workflow]: emptyTestState(),
      },
      saveError: null,
    }, true)
  }

  setSecretReplace(apiKeyInput: string): void {
    if (!apiKeyInput) {
      this.setSecretKeep()
      return
    }
    this.ensureMutable()
    const draft = this.requireDraft()
    if (draft.secretIntent === 'replace' && draft.apiKeyInput === apiKeyInput) {
      return
    }
    this.updateSecret(draft, 'replace', apiKeyInput)
  }

  setSecretClear(): void {
    this.ensureMutable()
    const draft = this.requireDraft()
    if (this.snapshot.baseline?.credentialSource !== 'database') {
      this.setSecretKeep()
      return
    }
    if (draft.secretIntent === 'clear') {
      return
    }
    this.updateSecret(draft, 'clear', '')
  }

  setSecretKeep(): void {
    this.ensureMutable()
    const draft = this.requireDraft()
    if (draft.secretIntent === 'keep' && !draft.apiKeyInput) {
      return
    }
    this.updateSecret(draft, 'keep', '')
  }

  async listModels(): Promise<void> {
    this.ensureMutable()
    const draft = this.requireDraft()
    const sharedErrors = connectionErrors(draft)
    if (sharedErrors.length) {
      throw new Error(sharedErrors[0])
    }
    const generation = ++this.modelsGeneration
    const fingerprint = connectionFingerprint(draft)
    this.publish({
      models: {
        status: 'loading',
        result: null,
        error: null,
        fingerprint,
      },
    })
    try {
      const result = await this.api.listModels(toConnectionDraft(draft))
      if (generation !== this.modelsGeneration
        || fingerprint !== connectionFingerprint(this.requireDraft())) {
        return
      }
      this.publish({
        models: {
          status: 'ready',
          result: {
            ...result,
            models: result.models.map(model => ({ ...model })),
          },
          error: null,
          fingerprint,
        },
      })
    } catch (reason) {
      if (generation !== this.modelsGeneration) {
        return
      }
      this.publish({
        models: {
          status: 'error',
          result: null,
          error: errorMessage(reason),
          fingerprint,
        },
      })
      throw reason
    }
  }

  async testWorkflow(workflow: LlmWorkflow): Promise<void> {
    this.ensureMutable()
    const draft = this.requireDraft()
    const validation = validateLlmSettingsDraft(draft)
    const errors = validation.testErrors[workflow]
    if (errors.length) {
      throw new Error(errors[0])
    }
    const generation = ++this.testGenerations[workflow]
    const fingerprint = workflowFingerprint(draft, workflow)
    this.publish({
      testByWorkflow: {
        ...this.snapshot.testByWorkflow,
        [workflow]: {
          status: 'pending',
          result: null,
          error: null,
          fingerprint,
        },
      },
    })
    try {
      const result = await this.api.test(toSettingsDraft(draft), workflow)
      if (generation !== this.testGenerations[workflow]
        || fingerprint !== workflowFingerprint(this.requireDraft(), workflow)) {
        return
      }
      this.publish({
        testByWorkflow: {
          ...this.snapshot.testByWorkflow,
          [workflow]: {
            status: result.success ? 'success' : 'failure',
            result: { ...result },
            error: result.success ? null : result.message,
            fingerprint,
          },
        },
      })
    } catch (reason) {
      if (generation !== this.testGenerations[workflow]) {
        return
      }
      this.publish({
        testByWorkflow: {
          ...this.snapshot.testByWorkflow,
          [workflow]: {
            status: 'failure',
            result: null,
            error: errorMessage(reason),
            fingerprint,
          },
        },
      })
      throw reason
    }
  }

  save(_options?: SaveOptions): Promise<void> {
    if (this.savePromise) {
      return this.savePromise
    }
    const operation = this.performSave()
    this.savePromise = operation
    void operation.then(
      () => {
        if (this.savePromise === operation) {
          this.savePromise = null
        }
      },
      () => {
        if (this.savePromise === operation) {
          this.savePromise = null
        }
      },
    )
    return operation
  }

  async revert(_options?: Saveable.RevertOptions): Promise<void> {
    this.ensureMutable()
    const baseline = this.snapshot.baseline
    if (!baseline) {
      return
    }
    this.invalidateAsyncOperations()
    this.publish({
      draft: draftFromBaseline(baseline),
      saveError: null,
      models: emptyModelsState(),
      testByWorkflow: emptyTests(),
    }, true)
  }

  dispose(): void {
    this.changeEmitter.dispose()
    this.dirtyChangedEmitter.dispose()
    this.contentChangedEmitter.dispose()
  }

  private async performSave(): Promise<void> {
    const draft = this.requireDraft()
    const validation = validateLlmSettingsDraft(draft)
    if (!validation.canSave) {
      const error = new Error(validation.errors[0])
      this.publish({ saveError: error.message })
      throw error
    }

    this.invalidateAsyncOperations()
    this.publish({
      saving: true,
      saveError: null,
      models: emptyModelsState(),
      testByWorkflow: emptyTests(),
    })
    try {
      const saved = await this.api.save(toSettingsDraft(draft))
      const baseline = cloneServerSnapshot(saved)
      this.publish({
        baseline,
        draft: draftFromBaseline(baseline),
        saving: false,
        saveError: null,
        models: emptyModelsState(),
        testByWorkflow: emptyTests(),
      }, true)
    } catch (reason) {
      this.publish({
        saving: false,
        saveError: errorMessage(reason),
      })
      throw reason
    }
  }

  private updateSecret(
    draft: LlmSettingsDraftState,
    secretIntent: LlmSecretIntent,
    apiKeyInput: string,
  ): void {
    this.invalidateAsyncOperations()
    this.publish({
      draft: {
        ...draft,
        secretIntent,
        apiKeyInput,
        models: cloneWorkflowModels(draft.models),
      },
      models: emptyModelsState(),
      testByWorkflow: emptyTests(),
      saveError: null,
    }, true)
  }

  private invalidateAsyncOperations(): void {
    this.modelsGeneration += 1
    for (const workflow of LLM_WORKFLOWS) {
      this.testGenerations[workflow] += 1
    }
  }

  private requireDraft(): LlmSettingsDraftState {
    if (!this.snapshot.draft) {
      throw new Error('LLM settings have not loaded.')
    }
    return this.snapshot.draft
  }

  private ensureMutable(): void {
    if (this.snapshot.saving) {
      throw new Error('LLM settings are being saved.')
    }
  }

  private publish(
    patch: Partial<ScholarLlmSettingsSnapshot>,
    contentChanged = false,
  ): void {
    const previous = this.snapshot
    const combined = { ...previous, ...patch }
    const dirty = computeDirty(combined.baseline, combined.draft)
    this.snapshot = {
      ...combined,
      dirty,
      validation: validateLlmSettingsDraft(combined.draft),
    }
    this.changeEmitter.fire()
    if (previous.dirty !== dirty) {
      this.dirtyChangedEmitter.fire()
    }
    if (contentChanged) {
      this.contentChangedEmitter.fire()
    }
  }
}