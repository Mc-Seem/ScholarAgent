import * as React from 'react'
import { MessageService } from '@theia/core'
import { Message, ReactWidget } from '@theia/core/lib/browser'
import type { Saveable, SaveableSource } from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import { LLM_WORKFLOWS, type LlmProvider, type LlmWorkflow } from '../../../../lib/llm-settings-api'
import {
  ScholarLlmSettingsService,
  type LlmWorkflowTestState,
} from './scholar-llm-settings-service'


export const SCHOLAR_LLM_SETTINGS_WIDGET_ID = 'scholar-agent:llm-settings'

const PROVIDERS: readonly { id: LlmProvider; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'ollama', label: 'Ollama Cloud' },
  { id: 'custom', label: 'Custom OpenAI-compatible' },
]

const WORKFLOWS: Readonly<Record<LlmWorkflow, { label: string; description: string }>> = {
  kg_extraction: {
    label: 'Knowledge Graph extraction',
    description: 'Use a capable model for graph structure and academic entities.',
  },
  html_injection: {
    label: 'HTML injection',
    description: 'A smaller, lower-cost model is usually sufficient for this workflow.',
  },
  tooltip_suggestion: {
    label: 'Term Highlights',
    description: 'Choose the model used to select terms and draft highlight content.',
  },
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : 'Unknown error'
}

@injectable()
export class ScholarLlmSettingsWidget extends ReactWidget implements SaveableSource {
  private loadStarted = false

  constructor(
    @inject(ScholarLlmSettingsService) private readonly settings: ScholarLlmSettingsService,
    @inject(MessageService) private readonly messageService: MessageService,
  ) {
    super()
    this.id = SCHOLAR_LLM_SETTINGS_WIDGET_ID
    this.title.label = 'LLM Settings'
    this.title.caption = 'LLM Provider and Workflow Model Settings'
    this.title.iconClass = 'codicon codicon-settings-gear'
    this.title.closable = true
    this.node.tabIndex = 0
    this.node.classList.add('scholar-widget', 'scholar-llm-settings')
    this.toDispose.push(this.settings.onDidChange(() => this.update()))
    this.update()
  }

  get saveable(): Saveable {
    return this.settings
  }

  ensureLoaded(): void {
    if (!this.loadStarted && this.settings.getSnapshot().loadStatus === 'idle') {
      this.loadStarted = true
      void this.settings.load().catch(reason => {
        void this.messageService.error(`Could not load LLM settings: ${errorMessage(reason)}`)
      })
    }
  }

  protected override onAfterAttach(message: Message): void {
    super.onAfterAttach(message)
    this.ensureLoaded()
  }

  protected override render(): React.ReactNode {
    return (
      <ScholarLlmSettingsContent
        settings={this.settings}
        messageService={this.messageService}
      />
    )
  }
}

export function ScholarLlmSettingsContent({
  settings,
  messageService,
}: {
  settings: ScholarLlmSettingsService
  messageService: MessageService
}): React.ReactElement {
  const snapshot = React.useSyncExternalStore(
    settings.subscribe,
    settings.getSnapshot,
    settings.getSnapshot,
  )
  const [showApiKey, setShowApiKey] = React.useState(false)

  const reportFailure = React.useCallback((prefix: string, reason: unknown): void => {
    void messageService.error(`${prefix}: ${errorMessage(reason)}`)
  }, [messageService])

  const reload = React.useCallback((): void => {
    void settings.load().catch(reason => reportFailure('Could not load LLM settings', reason))
  }, [reportFailure, settings])

  if (snapshot.loadStatus === 'idle') {
    return (
      <div className="scholar-llm-settings-empty">
        <p>LLM settings have not loaded.</p>
        <button type="button" className="theia-button" onClick={reload}>
          Load Settings
        </button>
      </div>
    )
  }

  if (snapshot.loadStatus === 'loading' && !snapshot.draft) {
    return (
      <div
        className="scholar-llm-settings-loading"
        role="status"
        aria-label="Loading LLM settings"
      >
        <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
        Loading LLM settings…
      </div>
    )
  }

  if (!snapshot.draft || !snapshot.baseline) {
    return (
      <div className="scholar-llm-settings-empty">
        <p className="scholar-error" role="alert">
          {snapshot.loadError || 'LLM settings are unavailable.'}
        </p>
        <button type="button" className="theia-button" onClick={reload}>
          Retry
        </button>
      </div>
    )
  }

  const { baseline, draft, validation } = snapshot
  const modelResult = settings.isModelsResultCurrent() ? snapshot.models.result : null
  const modelOptions = modelResult?.models ?? []
  const modelListId = 'scholar-llm-settings-model-list'
  const credentialDescription = baseline.credentialSource === 'database'
    ? `Saved in database${baseline.apiKeyMasked ? ` (${baseline.apiKeyMasked})` : ''}.`
    : baseline.credentialSource === 'environment'
      ? `Environment variable${baseline.apiKeyMasked ? ` (${baseline.apiKeyMasked})` : ''}. Environment credentials cannot be removed here.`
      : 'No credential is currently available.'
  const disabled = snapshot.saving

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    try {
      await settings.save()
      void messageService.info('LLM settings saved.')
    } catch (reason) {
      reportFailure('Could not save LLM settings', reason)
    }
  }

  const revert = (): void => {
    void settings.revert().catch(reason => reportFailure('Could not revert LLM settings', reason))
  }

  const refreshModels = (): void => {
    void settings.listModels().catch(reason => reportFailure('Could not refresh models', reason))
  }

  const testWorkflow = (workflow: LlmWorkflow): void => {
    void settings.testWorkflow(workflow).catch(reason => {
      reportFailure(`Could not test ${WORKFLOWS[workflow].label}`, reason)
    })
  }

  return (
    <form className="scholar-native-editor-form scholar-llm-settings-form" onSubmit={save}>
      <header className="scholar-llm-settings-header">
        <div>
          <h2>LLM Settings</h2>
          <p>Configure the connection and choose an independent model for each workflow.</p>
        </div>
        {snapshot.dirty && <span className="scholar-llm-settings-modified">Modified</span>}
      </header>

      {snapshot.loadError && (
        <div className="scholar-error" role="alert">{snapshot.loadError}</div>
      )}
      {snapshot.saveError && (
        <div className="scholar-error" role="alert">{snapshot.saveError}</div>
      )}

      <section className="scholar-llm-settings-section" aria-labelledby="llm-connection-heading">
        <h3 id="llm-connection-heading">Connection</h3>
        <label className="scholar-field">
          <span>Provider</span>
          <select
            className="theia-select"
            aria-label="Provider"
            value={draft.provider}
            onChange={event => settings.updateDraft({
              provider: event.currentTarget.value as LlmProvider,
            })}
            disabled={disabled}
          >
            {PROVIDERS.map(provider => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label>
        <label className="scholar-field">
          <span>Base URL</span>
          <input
            className="theia-input"
            type="url"
            aria-label="Base URL"
            value={draft.baseUrl}
            onChange={event => settings.updateDraft({ baseUrl: event.currentTarget.value })}
            disabled={disabled}
            placeholder="https://api.example.com/v1"
          />
        </label>

        <div className="scholar-field scholar-llm-settings-credential">
          <span>API key</span>
          <div className="scholar-llm-settings-secret-input">
            <input
              className="theia-input"
              type={showApiKey ? 'text' : 'password'}
              aria-label="API key"
              value={draft.secretIntent === 'replace' ? draft.apiKeyInput : ''}
              onChange={event => settings.setSecretReplace(event.currentTarget.value)}
              disabled={disabled || draft.secretIntent === 'clear'}
              autoComplete="new-password"
              placeholder="Enter a replacement key"
            />
            <button
              type="button"
              className="theia-button secondary"
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowApiKey(value => !value)}
              disabled={disabled || draft.secretIntent === 'clear'}
            >
              <span
                className={`codicon codicon-${showApiKey ? 'eye-closed' : 'eye'}`}
                aria-hidden="true"
              />
            </button>
          </div>
          <p className="scholar-llm-settings-hint">Credential source: {credentialDescription}</p>
          {baseline.credentialSource === 'database' && (
            <button
              type="button"
              className="theia-button secondary"
              aria-label={draft.secretIntent === 'clear'
                ? 'Keep saved API key'
                : 'Remove saved API key'}
              onClick={() => draft.secretIntent === 'clear'
                ? settings.setSecretKeep()
                : settings.setSecretClear()}
              disabled={disabled}
            >
              <span
                className={`codicon codicon-${draft.secretIntent === 'clear' ? 'discard' : 'trash'}`}
                aria-hidden="true"
              />
              {draft.secretIntent === 'clear' ? 'Keep Saved Key' : 'Remove Saved Key'}
            </button>
          )}
          {draft.secretIntent === 'replace' && (
            <p className="scholar-llm-settings-hint">The replacement key is sent only when testing, discovering models, or saving.</p>
          )}
          {draft.secretIntent === 'clear' && (
            <p className="scholar-llm-settings-warning" role="status">
              The saved database key will be removed on Save. Environment variables are unchanged.
            </p>
          )}
        </div>
      </section>

      <section className="scholar-llm-settings-section" aria-labelledby="llm-models-heading">
        <div className="scholar-llm-settings-section-heading">
          <div>
            <h3 id="llm-models-heading">Workflow Models</h3>
            <p>Model IDs remain editable even when discovery is unavailable.</p>
          </div>
          <button
            type="button"
            className="theia-button secondary"
            aria-label="Refresh model list"
            onClick={refreshModels}
            disabled={disabled
              || snapshot.models.status === 'loading'
              || !validation.canListModels}
          >
            <span
              className={`codicon codicon-${snapshot.models.status === 'loading' ? 'loading codicon-modifier-spin' : 'refresh'}`}
              aria-hidden="true"
            />
            Refresh Models
          </button>
        </div>

        {modelResult?.warning && (
          <p className="scholar-llm-settings-warning" role="status">{modelResult.warning}</p>
        )}
        {snapshot.models.error && settings.isModelsResultCurrent() && (
          <p className="scholar-error" role="alert">{snapshot.models.error}</p>
        )}
        <datalist id={modelListId}>
          {modelOptions.map(model => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </datalist>

        <div className="scholar-llm-settings-models">
          {LLM_WORKFLOWS.map(workflow => (
            <WorkflowModelRow
              key={workflow}
              workflow={workflow}
              model={draft.models[workflow]}
              modelListId={modelListId}
              test={snapshot.testByWorkflow[workflow]}
              testIsCurrent={settings.isTestResultCurrent(workflow)}
              canTest={validation.canTest[workflow]}
              disabled={disabled}
              onModelChange={model => settings.setModel(workflow, model)}
              onTest={() => testWorkflow(workflow)}
            />
          ))}
        </div>
      </section>

      {snapshot.dirty && !validation.canSave && (
        <ul className="scholar-llm-settings-validation" role="alert">
          {validation.errors.map(validationError => (
            <li key={validationError}>{validationError}</li>
          ))}
        </ul>
      )}

      <div className="scholar-native-editor-actions scholar-llm-settings-actions">
        <button
          type="button"
          className="theia-button secondary"
          aria-label="Revert LLM settings"
          onClick={revert}
          disabled={!snapshot.dirty || disabled}
        >
          <span className="codicon codicon-discard" aria-hidden="true" />
          Revert
        </button>
        <button
          type="submit"
          className="theia-button"
          aria-label="Save LLM settings"
          disabled={!snapshot.dirty || disabled || !validation.canSave}
        >
          <span
            className={`codicon codicon-${snapshot.saving ? 'loading codicon-modifier-spin' : 'save'}`}
            aria-hidden="true"
          />
          Save
        </button>
      </div>
    </form>
  )
}

function WorkflowModelRow({
  workflow,
  model,
  modelListId,
  test,
  testIsCurrent,
  canTest,
  disabled,
  onModelChange,
  onTest,
}: {
  workflow: LlmWorkflow
  model: string
  modelListId: string
  test: LlmWorkflowTestState
  testIsCurrent: boolean
  canTest: boolean
  disabled: boolean
  onModelChange(model: string): void
  onTest(): void
}): React.ReactElement {
  const metadata = WORKFLOWS[workflow]
  const result = testIsCurrent ? test.result : null
  const error = testIsCurrent ? test.error : null
  const pending = testIsCurrent && test.status === 'pending'

  return (
    <div className="scholar-llm-settings-model-row">
      <label className="scholar-field">
        <span>{metadata.label}</span>
        <small>{metadata.description}</small>
        <div className="scholar-llm-settings-model-control">
          <input
            className="theia-input"
            aria-label={`Model for ${workflow}`}
            value={model}
            list={modelListId}
            onChange={event => onModelChange(event.currentTarget.value)}
            disabled={disabled}
            placeholder="Enter any model ID"
          />
          <button
            type="button"
            className="theia-button secondary"
            aria-label={`Test ${workflow} connection`}
            onClick={onTest}
            disabled={disabled || pending || !canTest}
          >
            <span
              className={`codicon codicon-${pending ? 'loading codicon-modifier-spin' : 'debug-start'}`}
              aria-hidden="true"
            />
            Test
          </button>
        </div>
      </label>
      {pending && (
        <p className="scholar-llm-settings-test pending" role="status">Testing {model}…</p>
      )}
      {result && !pending && (
        <div
          className={`scholar-llm-settings-test ${result.success ? 'success' : 'failure'}`}
          role={result.success ? 'status' : 'alert'}
          aria-live="polite"
        >
          <span
            className={`codicon codicon-${result.success ? 'pass-filled' : 'error'}`}
            aria-hidden="true"
          />
          <span>
            {result.message}
            <small>Model: {result.modelUsed}</small>
          </span>
        </div>
      )}
      {!result && error && !pending && (
        <p className="scholar-llm-settings-test failure" role="alert">{error}</p>
      )}
    </div>
  )
}