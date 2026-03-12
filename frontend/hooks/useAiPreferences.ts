'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from './useApi';

const STORAGE_KEY = 'scholar-agent-ai-preferences';

export type AiProvider = 'anthropic' | 'openrouter';

export interface AnthropicTaskModel {
  id: string;
  label: string;
}

export interface AiCapabilities {
  providers: {
    anthropic: {
      available: boolean;
      label: string;
      fixed_models: Record<string, AnthropicTaskModel>;
    };
    openrouter: {
      available: boolean;
      label: string;
      supports_arbitrary_models: boolean;
      supports_model_validation: boolean;
    };
  };
  default_provider: AiProvider | null;
}

export interface AiPreferences {
  provider: AiProvider | null;
  openrouterSharedModel: string;
  openrouterKnowledgeGraphModel: string;
  openrouterTooltipFilterModel: string;
  openrouterHtmlInjectionModel: string;
}

export interface OpenRouterModelCheck {
  model: string;
  exists: boolean;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: Record<string, string>;
  supports_tools?: boolean;
  supports_json_schema?: boolean;
  compatibility: 'good' | 'limited' | 'unsupported' | 'unknown';
  detail: string;
  supported_parameters: string[];
}

export interface AiConfigPayload {
  provider: AiProvider;
  openrouter?: {
    shared_model?: string;
    knowledge_graph_model?: string;
    tooltip_filter_model?: string;
    html_injection_model?: string;
  };
}

const DEFAULT_PREFERENCES: AiPreferences = {
  provider: null,
  openrouterSharedModel: '',
  openrouterKnowledgeGraphModel: '',
  openrouterTooltipFilterModel: '',
  openrouterHtmlInjectionModel: '',
};

function parseStoredPreferences(): AiPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_PREFERENCES;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function getFallbackProvider(
  capabilities: AiCapabilities | null,
  preferences?: AiPreferences
): AiProvider | null {
  if (!capabilities) {
    return null;
  }

  if (
    capabilities.default_provider &&
    capabilities.providers[capabilities.default_provider].available
  ) {
    return capabilities.default_provider;
  }

  if (capabilities.providers.anthropic.available) {
    return 'anthropic';
  }

  if (
    capabilities.providers.openrouter.available &&
    preferences &&
    hasOpenRouterModelSelection(preferences)
  ) {
    return 'openrouter';
  }

  return null;
}

function hasOpenRouterModelSelection(preferences: AiPreferences): boolean {
  return [
    preferences.openrouterSharedModel,
    preferences.openrouterKnowledgeGraphModel,
    preferences.openrouterTooltipFilterModel,
    preferences.openrouterHtmlInjectionModel,
  ].some((value) => value.trim());
}

export function useAiPreferences() {
  const [capabilities, setCapabilities] = useState<AiCapabilities | null>(null);
  const [preferences, setPreferences] = useState<AiPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<Record<string, OpenRouterModelCheck>>({});
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const validationRequestIdRef = useRef(0);

  useEffect(() => {
    setPreferences(parseStoredPreferences());
  }, []);

  const loadCapabilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AiCapabilities>('/api/ai/capabilities');
      setCapabilities(data);
    } catch (err: any) {
      setError(err.detail || 'Failed to load AI capabilities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const effectiveProvider = useMemo(() => {
    if (preferences.provider && capabilities?.providers[preferences.provider].available) {
      return preferences.provider;
    }
    return getFallbackProvider(capabilities, preferences);
  }, [capabilities, preferences]);

  const providerSummary = useMemo(() => {
    if (!effectiveProvider) {
      return 'AI unavailable';
    }

    if (effectiveProvider === 'anthropic') {
      return 'Anthropic';
    }
    return 'OpenRouter';
  }, [
    capabilities,
    effectiveProvider,
  ]);

  const updatePreferences = useCallback((next: AiPreferences) => {
    setPreferences(next);
  }, []);

  const buildAiConfig = useCallback(
    (source: AiPreferences = preferences): AiConfigPayload | undefined => {
      const provider = (
        source.provider && capabilities?.providers[source.provider].available
          ? source.provider
          : getFallbackProvider(capabilities, source)
      );

      if (!provider) {
        return undefined;
      }

      if (provider === 'anthropic') {
        return { provider };
      }

      const openrouter: AiConfigPayload['openrouter'] = {};
      if (source.openrouterSharedModel.trim()) {
        openrouter.shared_model = source.openrouterSharedModel.trim();
      }
      if (source.openrouterKnowledgeGraphModel.trim()) {
        openrouter.knowledge_graph_model = source.openrouterKnowledgeGraphModel.trim();
      }
      if (source.openrouterTooltipFilterModel.trim()) {
        openrouter.tooltip_filter_model = source.openrouterTooltipFilterModel.trim();
      }
      if (source.openrouterHtmlInjectionModel.trim()) {
        openrouter.html_injection_model = source.openrouterHtmlInjectionModel.trim();
      }

      if (!hasOpenRouterModelSelection(source)) {
        return undefined;
      }

      return {
        provider,
        openrouter: Object.keys(openrouter).length > 0 ? openrouter : undefined,
      };
    },
    [capabilities, preferences]
  );

  const validateOpenRouterModels = useCallback(async (source: AiPreferences = preferences) => {
    const requestId = ++validationRequestIdRef.current;
    const models = [
      source.openrouterSharedModel,
      source.openrouterKnowledgeGraphModel,
      source.openrouterTooltipFilterModel,
      source.openrouterHtmlInjectionModel,
    ]
      .map((value) => value.trim())
      .filter(Boolean);

    if (models.length === 0) {
      setValidationResults({});
      setValidationError(null);
      setValidationLoading(false);
      return {};
    }

    setValidationLoading(true);
    setValidationError(null);

    try {
      const response = await apiFetch<{ results: OpenRouterModelCheck[] }>(
        '/api/ai/openrouter/check-models',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ models }),
        }
      );

      const nextResults = response.results.reduce<Record<string, OpenRouterModelCheck>>((acc, item) => {
        acc[item.model] = item;
        return acc;
      }, {});
      if (requestId === validationRequestIdRef.current) {
        setValidationResults(nextResults);
      }
      return nextResults;
    } catch (err: any) {
      const message = err.detail || 'Failed to validate OpenRouter models';
      if (requestId === validationRequestIdRef.current) {
        setValidationError(message);
      }
      return {};
    } finally {
      if (requestId === validationRequestIdRef.current) {
        setValidationLoading(false);
      }
    }
  }, [preferences]);

  return {
    capabilities,
    preferences,
    effectiveProvider,
    providerSummary,
    loading,
    error,
    validationResults,
    validationLoading,
    validationError,
    updatePreferences,
    buildAiConfig,
    validateOpenRouterModels,
    reloadCapabilities: loadCapabilities,
  };
}
