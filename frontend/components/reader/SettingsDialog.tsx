'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Save, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Zap } from 'lucide-react';
import { componentStyles, textStyles } from '@/lib/design-system';
import { apiFetch } from '@/hooks/useApi';
import { ModelSelect } from './ModelSelect';

// ---- Types ----

interface LLMConfig {
  id: number;
  provider: string;
  base_url: string | null;
  api_key_masked: string | null;
  has_api_key: boolean;
  models: Record<string, string>;
  is_active: boolean;
}

interface ModelInfo {
  id: string;
  name: string;
}

interface TestResult {
  success: boolean;
  message: string;
  model_used?: string;
}

// Provider metadata
const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude)', defaultBaseUrl: '' },
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'ollama', label: 'Ollama Cloud', defaultBaseUrl: 'https://ollama.com/v1' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultBaseUrl: '' },
] as const;

const WORKFLOWS = [
  { id: 'kg_extraction', label: 'KG Extraction', description: 'Knowledge graph extraction from papers (most token-heavy)' },
  { id: 'html_injection', label: 'HTML Injection', description: 'Semantic span injection into HTML' },
  { id: 'tooltip_suggestion', label: 'Tooltip Suggestion', description: 'Entity filtering and tooltip content generation' },
] as const;

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [provider, setProvider] = useState('ollama');
  const [baseUrl, setBaseUrl] = useState('https://api.ollama.cloud/v1');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsFetched, setModelsFetched] = useState(false);

  // Load current config on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    apiFetch<LLMConfig>('/api/settings/llm')
      .then((cfg) => {
        setConfig(cfg);
        if (cfg.id > 0) {
          setProvider(cfg.provider);
          setBaseUrl(cfg.base_url || '');
          setModels(cfg.models || {});
        }
      })
      .catch((err) => setError(err.detail || 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Fetch available models when provider or baseUrl changes
  const fetchModels = useCallback(async () => {
    if (!provider) return;
    setModelsFetched(false);
    try {
      const params = new URLSearchParams({ provider });
      if (baseUrl) params.set('base_url', baseUrl);
      // Include current API key for the models endpoint auth if user typed it
      if (apiKey) params.set('api_key', apiKey);
      const data = await apiFetch<{ models: ModelInfo[] }>(`/api/settings/llm/models?${params}`);
      setAvailableModels(data.models);
    } catch {
      setAvailableModels([]);
    } finally {
      setModelsFetched(true);
    }
  }, [provider, baseUrl, apiKey]);

  // Auto-fetch models when provider changes (but not on every keystroke)
  useEffect(() => {
    if (isOpen && provider) {
      // Debounce slightly
      const timer = setTimeout(() => fetchModels(), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, provider, fetchModels]);

  // Update base URL when provider changes
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    setTestResult(null);
    const p = PROVIDERS.find((p) => p.id === newProvider);
    if (p && p.defaultBaseUrl) {
      setBaseUrl(p.defaultBaseUrl);
    } else if (newProvider === 'anthropic') {
      setBaseUrl('');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        provider,
        models,
      };
      if (baseUrl) body.base_url = baseUrl;
      // Only send api_key if user typed a new one
      if (apiKey) body.api_key = apiKey;

      const updated = await apiFetch<LLMConfig>('/api/settings/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setConfig(updated);
      setApiKey(''); // Clear the input after save
      setShowApiKey(false);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setError(e.detail || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // If there are unsaved changes, save first then test
      if (apiKey || !config?.is_active) {
        await handleSave();
      }
      const result = await apiFetch<TestResult>('/api/settings/llm/test', {
        method: 'POST',
      });
      setTestResult(result);
    } catch (err: unknown) {
      const e = err as { detail?: string };
      setTestResult({ success: false, message: e.detail || 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleModelChange = (workflow: string, modelId: string) => {
    setModels((prev) => ({ ...prev, [workflow]: modelId }));
  };

  if (!isOpen) return null;

  const hasKey = config?.has_api_key || !!apiKey;
  const canSave = provider && (hasKey || provider === 'ollama' || provider === 'custom');

  return (
    <div className={componentStyles.dialog.overlay}>
      <div className={componentStyles.dialog.container + ' max-w-2xl'}>
        {/* Header */}
        <div className={componentStyles.dialog.header}>
          <div>
            <h2 className={textStyles.h1}>LLM Provider Settings</h2>
            <p className="text-sm text-slate-500 mt-1">
              Configure which AI provider and models power the agentic workflows
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className={componentStyles.dialog.body}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
          ) : (
            <div className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              {/* Provider Selection */}
              <div>
                <label className={textStyles.label + ' block mb-2'}>
                  Provider
                </label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className={componentStyles.input.default}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Base URL (for non-Anthropic) */}
              {provider !== 'anthropic' && (
                <div>
                  <label className={textStyles.label + ' block mb-2'}>
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className={componentStyles.input.default}
                  />
                  {provider === 'ollama' ? (
                    <p className={textStyles.caption + ' mt-1'}>
                      Get your API key from <code className="text-slate-600">ollama.com</code> → Settings → API Keys.
                      Cloud models require an active subscription (Ollama Max or Pro).
                    </p>
                  ) : (
                    <p className={textStyles.caption + ' mt-1'}>
                      OpenAI-compatible API endpoint
                    </p>
                  )}
                </div>
              )}

              {/* API Key */}
              <div>
                <label className={textStyles.label + ' block mb-2'}>
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      config?.has_api_key
                        ? `Saved key: ${config.api_key_masked} (type new key to replace)`
                        : 'Enter your API key...'
                    }
                    className={componentStyles.input.default + ' pr-10'}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className={textStyles.caption + ' mt-1'}>
                  {config?.has_api_key
                    ? 'Key is encrypted at rest. Leave empty to keep the existing key.'
                    : 'Key will be encrypted with Fernet (AES-128) before storage in the database.'}
                </p>
              </div>

              {/* Per-workflow model selection */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className={textStyles.sectionHeader}>Models per Workflow</div>
                {WORKFLOWS.map((wf) => (
                  <div key={wf.id}>
                    <label className={textStyles.label + ' block mb-1'}>
                      {wf.label}
                    </label>
                    <p className={textStyles.caption + ' mb-2'}>{wf.description}</p>
                    <div className="flex gap-2 items-start">
                      <ModelSelect
                        value={models[wf.id] || ''}
                        options={availableModels}
                        placeholder="Type or select a model (e.g. glm-5.2:cloud)"
                        onChange={(val) => handleModelChange(wf.id, val)}
                      />
                      {/* Refresh models button */}
                      <button
                        type="button"
                        onClick={fetchModels}
                        className="flex-shrink-0 px-3 py-2 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                        title="Refresh model list"
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${
                  testResult.success
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {testResult.success ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />}
                  <div>
                    <div>{testResult.message}</div>
                    {testResult.model_used && (
                      <div className="text-xs opacity-70 mt-1">Model: {testResult.model_used}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={componentStyles.dialog.footer + ' justify-end gap-3'}>
          <button
            onClick={handleTest}
            disabled={testing || !canSave}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Test Connection
          </button>
          <button
            onClick={onClose}
            className={componentStyles.button.secondary}
          >
            Close
          </button>
          <button
            onClick={handleSave}
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