'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { componentStyles, textStyles } from '../../lib/design-system';
import {
  HttpLlmSettingsApi,
  LLM_WORKFLOWS,
  type LlmConnectionDraft,
  type LlmModelInfo,
  type LlmProvider,
  type LlmSettingsApi,
  type LlmSettingsDraft,
  type LlmSettingsSnapshot,
  type LlmTestResult,
  type LlmWorkflow,
  type WorkflowModels,
} from '../../lib/llm-settings-api';
import { ModelSelect } from './ModelSelect';

// Provider metadata
const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude)', defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'ollama', label: 'Ollama Cloud', defaultBaseUrl: 'https://ollama.com/v1' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultBaseUrl: '' },
] as const;

const WORKFLOWS = [
  { id: 'kg_extraction', label: 'KG Extraction', description: 'Knowledge graph extraction from papers (most token-heavy)' },
  { id: 'html_injection', label: 'HTML Injection', description: 'Semantic span injection into HTML' },
  { id: 'tooltip_suggestion', label: 'Tooltip Suggestion', description: 'Entity filtering and tooltip content generation' },
  { id: 'chat', label: 'Chat', description: 'Grounded questions and answers for the active paper' },
] as const;

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  api?: LlmSettingsApi;
}

const DEFAULT_API = new HttpLlmSettingsApi();
const EMPTY_MODELS: WorkflowModels = {
  kg_extraction: '',
  html_injection: '',
  tooltip_suggestion: '',
  chat: '',
};

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export default function SettingsDialog({ isOpen, onClose, api = DEFAULT_API }: SettingsDialogProps) {
  const [config, setConfig] = useState<LlmSettingsSnapshot | null>(null);
  const [provider, setProvider] = useState<LlmProvider>('anthropic');
  const [baseUrl, setBaseUrl] = useState('https://api.anthropic.com');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [models, setModels] = useState<WorkflowModels>({ ...EMPTY_MODELS });
  const [availableModels, setAvailableModels] = useState<LlmModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Partial<Record<LlmWorkflow, boolean>>>({});
  const [testResult, setTestResult] = useState<Partial<Record<LlmWorkflow, LlmTestResult>>>({});
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelWarning, setModelWarning] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const modelsGeneration = useRef(0);
  const testGenerations = useRef<Record<LlmWorkflow, number>>({
    kg_extraction: 0,
    html_injection: 0,
    tooltip_suggestion: 0,
    chat: 0,
  });
  const draftRef = useRef<LlmSettingsDraft>({
    provider,
    baseUrl,
    apiKey,
    clearApiKey,
    models,
  });
  draftRef.current = { provider, baseUrl, apiKey, clearApiKey, models };

  const invalidateTests = useCallback(() => {
    for (const workflow of LLM_WORKFLOWS) {
      testGenerations.current[workflow] += 1;
    }
    setTesting({});
    setTestResult({});
  }, []);

  const invalidateConnection = useCallback(() => {
    modelsGeneration.current += 1;
    setAvailableModels([]);
    setModelWarning(null);
    invalidateTests();
  }, [invalidateTests]);

  // Load current config on open
  useEffect(() => {
    if (!isOpen) {
      loadGeneration.current += 1;
      modelsGeneration.current += 1;
      return;
    }
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    api.load()
      .then((cfg) => {
        if (generation !== loadGeneration.current) return;
        setConfig(cfg);
        setProvider(cfg.provider);
        setBaseUrl(cfg.baseUrl);
        setModels({ ...cfg.models });
        setApiKey('');
        setClearApiKey(false);
        setAvailableModels([]);
        setModelWarning(null);
        invalidateTests();
      })
      .catch((reason) => {
        if (generation === loadGeneration.current) {
          setError(errorMessage(reason, 'Failed to load settings'));
        }
      })
      .finally(() => {
        if (generation === loadGeneration.current) {
          setLoading(false);
        }
      });
    return () => {
      loadGeneration.current += 1;
      modelsGeneration.current += 1;
      for (const workflow of LLM_WORKFLOWS) {
        testGenerations.current[workflow] += 1;
      }
    };
  }, [api, invalidateTests, isOpen]);

  // Fetch available models when provider or baseUrl changes
  const fetchModels = useCallback(async () => {
    const draft: LlmConnectionDraft = { provider, baseUrl, apiKey, clearApiKey };
    const generation = ++modelsGeneration.current;
    setModelsFetched(false);
    setModelWarning(null);
    try {
      const data = await api.listModels(draft);
      if (generation !== modelsGeneration.current) return;
      setAvailableModels(data.models);
      setModelWarning(data.warning);
    } catch (reason) {
      if (generation !== modelsGeneration.current) return;
      setAvailableModels([]);
      setModelWarning(errorMessage(reason, 'Failed to load models'));
    } finally {
      if (generation === modelsGeneration.current) {
        setModelsFetched(true);
      }
    }
  }, [api, apiKey, baseUrl, clearApiKey, provider]);

  // Auto-fetch models when provider changes (but not on every keystroke)
  useEffect(() => {
    if (isOpen && !loading && config) {
      const timer = setTimeout(() => fetchModels(), 300);
      return () => clearTimeout(timer);
    }
  }, [config, fetchModels, isOpen, loading]);

  // Update base URL when provider changes
  const handleProviderChange = (newProvider: string) => {
    const nextProvider = newProvider as LlmProvider;
    setProvider(nextProvider);
    const p = PROVIDERS.find((p) => p.id === newProvider);
    setBaseUrl(p?.defaultBaseUrl || '');
    setApiKey('');
    setClearApiKey(false);
    invalidateConnection();
  };

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value);
    setClearApiKey(false);
    invalidateConnection();
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setClearApiKey(false);
    invalidateConnection();
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    invalidateTests();
    const draft = { ...draftRef.current, models: { ...draftRef.current.models } };
    try {
      const updated = await api.save(draft);
      setConfig(updated);
      setProvider(updated.provider);
      setBaseUrl(updated.baseUrl);
      setModels({ ...updated.models });
      setApiKey('');
      setClearApiKey(false);
      setShowApiKey(false);
      modelsGeneration.current += 1;
    } catch (reason) {
      setError(errorMessage(reason, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (workflow: LlmWorkflow) => {
    const generation = ++testGenerations.current[workflow];
    const draft = { ...draftRef.current, models: { ...draftRef.current.models } };
    setTesting((previous) => ({ ...previous, [workflow]: true }));
    setTestResult((previous) => {
      const next = { ...previous };
      delete next[workflow];
      return next;
    });
    try {
      const result = await api.test(draft, workflow);
      if (generation === testGenerations.current[workflow]) {
        setTestResult((previous) => ({ ...previous, [workflow]: result }));
      }
    } catch (reason) {
      if (generation === testGenerations.current[workflow]) {
        setTestResult((previous) => ({
          ...previous,
          [workflow]: {
            success: false,
            message: errorMessage(reason, 'Test failed'),
            workflow,
            modelUsed: draft.models[workflow],
          },
        }));
      }
    } finally {
      if (generation === testGenerations.current[workflow]) {
        setTesting((previous) => ({ ...previous, [workflow]: false }));
      }
    }
  };

  const handleModelChange = (workflow: LlmWorkflow, modelId: string) => {
    testGenerations.current[workflow] += 1;
    setTesting((previous) => ({ ...previous, [workflow]: false }));
    setTestResult((previous) => {
      const next = { ...previous };
      delete next[workflow];
      return next;
    });
    setModels((prev) => ({ ...prev, [workflow]: modelId }));
  };

  if (!isOpen) return null;

  const sameConnection = config?.provider === provider && config.baseUrl === baseUrl;
  const canRemoveDatabaseKey = config?.credentialSource === 'database'
    && !clearApiKey;
  const canSave = Boolean(baseUrl.trim())
    && LLM_WORKFLOWS.every((workflow) => models[workflow].trim());
  const credentialLabel = config?.credentialSource === 'database'
    ? 'Saved in database'
    : config?.credentialSource === 'environment'
      ? 'Environment variable'
      : 'No credential';

  return (
    <div className={componentStyles.dialog.overlay}>
      <div
        className={componentStyles.dialog.container + ' max-w-2xl'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-settings-title"
      >
        {/* Header */}
        <div className={componentStyles.dialog.header}>
          <div>
            <h2 id="llm-settings-title" className={textStyles.h1}>LLM Provider Settings</h2>
            <p className="text-sm text-slate-500 mt-1">
              Configure which AI provider and models power the agentic workflows
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close LLM settings"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className={componentStyles.dialog.body}>
          {loading ? (
            <div className="flex items-center justify-center py-12" role="status" aria-label="Loading LLM settings">
              <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
          ) : (
            <div className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700" role="alert">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              {/* Provider Selection */}
              <div>
                <label htmlFor="llm-provider" className={textStyles.label + ' block mb-2'}>
                  Provider
                </label>
                <select
                  id="llm-provider"
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className={componentStyles.input.default}
                  disabled={saving}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Effective Base URL */}
              <div>
                <label htmlFor="llm-base-url" className={textStyles.label + ' block mb-2'}>
                  Base URL
                </label>
                <input
                  id="llm-base-url"
                  type="url"
                  value={baseUrl}
                  onChange={(e) => handleBaseUrlChange(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className={componentStyles.input.default}
                  disabled={saving}
                />
                {provider === 'ollama' ? (
                  <p className={textStyles.caption + ' mt-1'}>
                    Get your API key from <code className="text-slate-600">ollama.com</code> → Settings → API Keys.
                    Cloud models require an active subscription (Ollama Max or Pro).
                  </p>
                ) : (
                  <p className={textStyles.caption + ' mt-1'}>
                    Effective HTTP(S) endpoint for this provider
                  </p>
                )}
              </div>

              {/* API Key */}
              <div>
                <label htmlFor="llm-api-key" className={textStyles.label + ' block mb-2'}>
                  API Key
                </label>
                <div className="relative">
                  <input
                    id="llm-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder={
                      config?.hasApiKey && sameConnection && !clearApiKey
                        ? `Current key: ${config.apiKeyMasked || 'masked'} (type new key to replace)`
                        : 'Enter your API key...'
                    }
                    className={componentStyles.input.default + ' pr-10'}
                    autoComplete="new-password"
                    disabled={saving}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    disabled={saving}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className={textStyles.caption}>
                    Credential source: <strong>{credentialLabel}</strong>.
                    {config?.credentialSource === 'environment' && ' Environment variables cannot be removed here.'}
                  </p>
                  {canRemoveDatabaseKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setApiKey('');
                        setClearApiKey(true);
                        invalidateConnection();
                      }}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
                      aria-label="Remove saved API key"
                      disabled={saving}
                    >
                      <Trash2 size={14} />
                      Remove saved key
                    </button>
                  )}
                  {clearApiKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setClearApiKey(false);
                        invalidateConnection();
                      }}
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800"
                      aria-label="Keep saved API key"
                      disabled={saving}
                    >
                      <Undo2 size={14} />
                      Keep saved key
                    </button>
                  )}
                </div>
                {clearApiKey && (
                  <p className="mt-2 text-xs text-amber-700" role="status">
                    The saved database key will be removed on Save. An environment credential, if present, remains unchanged.
                  </p>
                )}
              </div>

              {/* Per-workflow model selection */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <div className={textStyles.sectionHeader}>Models per Workflow</div>
                  <button
                    type="button"
                    onClick={() => void fetchModels()}
                    disabled={!modelsFetched || saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Refresh model list"
                  >
                    <RefreshCw size={14} className={!modelsFetched ? 'animate-spin' : ''} />
                    Refresh Models
                  </button>
                </div>
                {modelWarning && (
                  <p className="text-xs text-amber-700" role="status" aria-live="polite">
                    {modelWarning}
                  </p>
                )}
                {WORKFLOWS.map((wf) => {
                  const result = testResult[wf.id];
                  const isTesting = Boolean(testing[wf.id]);
                  const resultId = `llm-test-result-${wf.id}`;
                  return (
                    <div key={wf.id} className="rounded-lg border border-slate-200 p-3">
                      <label htmlFor={`llm-model-${wf.id}`} className={textStyles.label + ' block mb-1'}>
                        {wf.label}
                      </label>
                      <p className={textStyles.caption + ' mb-2'}>{wf.description}</p>
                      <div className="flex gap-2 items-start">
                        <ModelSelect
                          id={`llm-model-${wf.id}`}
                          ariaLabel={`${wf.label} model`}
                          value={models[wf.id]}
                          options={availableModels}
                          placeholder="Type or select any model ID"
                          onChange={(val) => handleModelChange(wf.id, val)}
                          disabled={saving}
                        />
                        <button
                          type="button"
                          onClick={() => void handleTest(wf.id)}
                          disabled={isTesting || saving || !models[wf.id].trim() || !baseUrl.trim()}
                          className="inline-flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label={`Test ${wf.label} model`}
                          aria-describedby={result ? resultId : undefined}
                        >
                          {isTesting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                          Test
                        </button>
                      </div>
                      {result && (
                        <div
                          id={resultId}
                          className={`mt-2 flex items-start gap-2 rounded-md p-2 text-xs ${
                            result.success
                              ? 'bg-green-50 text-green-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                          role="status"
                          aria-live="polite"
                        >
                          {result.success
                            ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
                            : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}
                          <div>
                            <div>{result.message}</div>
                            <div className="mt-1 opacity-70">Model: {result.modelUsed}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={componentStyles.dialog.footer + ' justify-end gap-3'}>
          <button
            type="button"
            onClick={onClose}
            className={componentStyles.button.secondary}
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !canSave}
            className={componentStyles.button.primary}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}