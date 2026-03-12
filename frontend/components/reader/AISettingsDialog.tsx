'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Info,
  Loader2,
  Settings2,
  X,
} from 'lucide-react';

import type {
  AiCapabilities,
  AiPreferences,
  AiProvider,
  OpenRouterModelCheck,
} from '@/hooks/useAiPreferences';

interface AISettingsDialogProps {
  isOpen: boolean;
  capabilities: AiCapabilities | null;
  preferences: AiPreferences;
  effectiveProvider: AiProvider | null;
  loading: boolean;
  error: string | null;
  validationResults: Record<string, OpenRouterModelCheck>;
  validationLoading: boolean;
  validationError: string | null;
  onClose: () => void;
  onSave: (preferences: AiPreferences) => void;
  onValidateOpenRouterModels: (
    preferences: AiPreferences
  ) => Promise<Record<string, OpenRouterModelCheck>>;
}

const EMPTY_PREFERENCES: AiPreferences = {
  provider: null,
  openrouterSharedModel: '',
  openrouterKnowledgeGraphModel: '',
  openrouterTooltipFilterModel: '',
  openrouterHtmlInjectionModel: '',
};

const TASK_LABELS: Record<string, string> = {
  knowledge_graph: 'Knowledge Graph',
  tooltip_filter: 'Tooltip Filtering',
  html_injection: 'HTML Injection',
};

type FieldStatus =
  | { kind: 'empty'; label: string; className: string }
  | { kind: 'inherit'; label: string; className: string }
  | { kind: 'checked'; label: string; className: string };

function getCheckedStatus(result: OpenRouterModelCheck): FieldStatus {
  if (result.compatibility === 'good') {
    return {
      kind: 'checked',
      label: 'Good Fit',
      className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    };
  }

  if (result.compatibility === 'limited') {
    return {
      kind: 'checked',
      label: 'Limited',
      className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    };
  }

  return {
    kind: 'checked',
    label: result.compatibility === 'unsupported' ? 'Not Suitable' : 'Unknown',
    className: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  };
}


function getInheritedStatus(result?: OpenRouterModelCheck): FieldStatus {
  if (!result) {
    return {
      kind: 'inherit',
      label: 'Checking Shared',
      className: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
    };
  }

  const status = getCheckedStatus(result);
  return {
    ...status,
    kind: 'inherit',
    label: `Shared ${status.label}`,
  };
}

function StatusBadge({ status }: { status: FieldStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] ${status.className}`}
    >
      {status.label}
    </span>
  );
}

function ModelField({
  title,
  value,
  placeholder,
  inheritedFrom,
  explicitResult,
  inheritedResult,
  onChange,
}: {
  title: string;
  value: string;
  placeholder: string;
  inheritedFrom?: string;
  explicitResult?: OpenRouterModelCheck;
  inheritedResult?: OpenRouterModelCheck;
  onChange: (next: string) => void;
}) {
  const trimmed = value.trim();
  const explicit = Boolean(trimmed);
  const status: FieldStatus = explicit
    ? explicitResult
      ? getCheckedStatus(explicitResult)
      : {
          kind: 'checked',
          label: 'Checking',
          className: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
        }
    : inheritedFrom
      ? getInheritedStatus(inheritedResult)
      : {
          kind: 'empty',
          label: 'Unset',
          className: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
        };

  return (
    <div className="grid grid-cols-[190px_minmax(0,1fr)_120px] items-center gap-3 border-b border-slate-200 py-3 last:border-b-0">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      <div>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>
      <div className="justify-self-end">
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

export default function AISettingsDialog({
  isOpen,
  capabilities,
  preferences,
  effectiveProvider,
  loading,
  error,
  validationResults,
  validationLoading,
  validationError,
  onClose,
  onSave,
  onValidateOpenRouterModels,
}: AISettingsDialogProps) {
  const [draft, setDraft] = useState<AiPreferences>(EMPTY_PREFERENCES);
  const [activeTab, setActiveTab] = useState<AiProvider>('anthropic');
  const [showStatusHelp, setShowStatusHelp] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDraft(preferences);
    setActiveTab(preferences.provider || effectiveProvider || 'anthropic');
  }, [effectiveProvider, isOpen, preferences]);

  const isAnthropicAvailable = capabilities?.providers.anthropic.available ?? false;
  const isOpenRouterAvailable = capabilities?.providers.openrouter.available ?? false;

  useEffect(() => {
    if (!isOpen || activeTab !== 'openrouter' || !isOpenRouterAvailable) {
      return;
    }

    const hasAnyModel = [
      draft.openrouterSharedModel,
      draft.openrouterKnowledgeGraphModel,
      draft.openrouterTooltipFilterModel,
      draft.openrouterHtmlInjectionModel,
    ].some((value) => value.trim());

    if (!hasAnyModel) {
      return;
    }

    const handle = window.setTimeout(() => {
      void onValidateOpenRouterModels(draft);
    }, 450);

    return () => window.clearTimeout(handle);
  }, [activeTab, draft, isOpen, isOpenRouterAvailable, onValidateOpenRouterModels]);

  const openRouterResults = useMemo(() => {
    const getResult = (model: string) => {
      const trimmed = model.trim();
      return trimmed ? validationResults[trimmed] : undefined;
    };

    return {
      shared: getResult(draft.openrouterSharedModel),
      knowledgeGraphExplicit: getResult(draft.openrouterKnowledgeGraphModel),
      tooltipFilterExplicit: getResult(draft.openrouterTooltipFilterModel),
      htmlInjectionExplicit: getResult(draft.openrouterHtmlInjectionModel),
      sharedInherited: getResult(draft.openrouterSharedModel),
    };
  }, [
    draft.openrouterHtmlInjectionModel,
    draft.openrouterKnowledgeGraphModel,
    draft.openrouterSharedModel,
    draft.openrouterTooltipFilterModel,
    validationResults,
  ]);

  const openRouterCanSave = useMemo(() => {
    const sharedModel = draft.openrouterSharedModel.trim();
    const knowledgeGraphModel = draft.openrouterKnowledgeGraphModel.trim() || sharedModel;
    const tooltipFilterModel = draft.openrouterTooltipFilterModel.trim() || sharedModel;
    const htmlInjectionModel = draft.openrouterHtmlInjectionModel.trim() || sharedModel;

    const effectiveModels = [
      {
        model: knowledgeGraphModel,
        result: draft.openrouterKnowledgeGraphModel.trim()
          ? openRouterResults.knowledgeGraphExplicit
          : openRouterResults.sharedInherited,
      },
      {
        model: tooltipFilterModel,
        result: draft.openrouterTooltipFilterModel.trim()
          ? openRouterResults.tooltipFilterExplicit
          : openRouterResults.sharedInherited,
      },
      {
        model: htmlInjectionModel,
        result: draft.openrouterHtmlInjectionModel.trim()
          ? openRouterResults.htmlInjectionExplicit
          : openRouterResults.sharedInherited,
      },
    ];

    if (!effectiveModels.some(({ model }) => model)) {
      return false;
    }

    if (effectiveModels.some(({ model }) => !model)) {
      return false;
    }

    if (validationLoading) {
      return false;
    }

    return effectiveModels.every(
      ({ result }) => result && result.compatibility === 'good'
    );
  }, [
    draft.openrouterHtmlInjectionModel,
    draft.openrouterKnowledgeGraphModel,
    draft.openrouterSharedModel,
    draft.openrouterTooltipFilterModel,
    openRouterResults.htmlInjectionExplicit,
    openRouterResults.knowledgeGraphExplicit,
    openRouterResults.shared,
    openRouterResults.sharedInherited,
    openRouterResults.tooltipFilterExplicit,
    validationLoading,
  ]);

  if (!isOpen) {
    return null;
  }

  const save = () => {
    onSave({
      ...draft,
      provider: activeTab,
    });
    onClose();
  };

  const anthropicModels = capabilities?.providers.anthropic.fixed_models || {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-slate-500">
                <Settings2 size={16} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">AI Settings</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Configure Provider and Models</h3>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="border-b border-slate-200 px-5 py-3">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => isAnthropicAvailable && setActiveTab('anthropic')}
            className={[
                'rounded-lg border px-4 py-2.5 text-left transition',
              activeTab === 'anthropic'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : isAnthropicAvailable
                    ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400',
            ].join(' ')}
          >
            <div className="text-sm font-semibold">Anthropic</div>
          </button>
          <button
            onClick={() => isOpenRouterAvailable && setActiveTab('openrouter')}
            className={[
                'rounded-lg border px-4 py-2.5 text-left transition',
              activeTab === 'openrouter'
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : isOpenRouterAvailable
                    ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400',
            ].join(' ')}
          >
            <div className="text-sm font-semibold">OpenRouter</div>
          </button>
        </div>
      </div>

        <div className="max-h-[58vh] overflow-y-auto px-5 py-4">
          {loading && <div className="text-sm text-slate-500">Loading AI settings...</div>}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && activeTab === 'anthropic' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600">
                  Anthropic uses the fixed backend model map below.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-1">
                <div className="grid grid-cols-[190px_minmax(0,1fr)_120px] items-center gap-3 border-b border-slate-200 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Task</div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Model</div>
                  <div className="text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Status</div>
                </div>
                <div className="space-y-0">
                  {Object.entries(anthropicModels).map(([task, model]) => (
                    <div
                      key={task}
                      className="grid grid-cols-[190px_minmax(0,1fr)_120px] items-center gap-3 border-b border-slate-200 py-3 last:border-b-0"
                    >
                      <div className="text-sm font-medium text-slate-700">
                        {TASK_LABELS[task] || task}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{model.label}</div>
                        <div className="truncate text-xs text-slate-500">{model.id}</div>
                      </div>
                      <div className="justify-self-end">
                        <StatusBadge
                          status={{
                            kind: 'checked',
                            label: 'Fixed',
                            className: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!loading && activeTab === 'openrouter' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600">
                  Use Shared Model as a default, or leave it empty and set each task explicitly.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white px-4 py-1">
                <div className="relative grid grid-cols-[190px_minmax(0,1fr)_120px] items-center gap-3 border-b border-slate-200 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Task</div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Model</div>
                  <div className="flex items-center justify-end gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <span>Status</span>
                    <button
                      type="button"
                      onClick={() => setShowStatusHelp((current) => !current)}
                      className="rounded-full p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      aria-label="Explain status values"
                    >
                      <Info size={12} />
                    </button>
                  </div>
                  {showStatusHelp && (
                    <div className="absolute right-0 top-10 z-10 w-64 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs leading-5 text-slate-600 shadow-lg">
                      <div><span className="font-semibold text-slate-800">Good Fit</span>: model advertises the structured output features the app expects.</div>
                      <div><span className="font-semibold text-slate-800">Limited</span>: partial support, may be less reliable.</div>
                      <div><span className="font-semibold text-slate-800">Unknown</span>: not enough metadata to judge.</div>
                      <div><span className="font-semibold text-slate-800">Shared ...</span>: this row inherits the shared model and its validation status.</div>
                      <div><span className="font-semibold text-slate-800">Unset</span>: no model is configured for this row.</div>
                    </div>
                  )}
                </div>
                <ModelField
                  title="Shared Model"
                  value={draft.openrouterSharedModel}
                  placeholder="anthropic/claude-3.7-sonnet"
                  explicitResult={openRouterResults.shared}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, openrouterSharedModel: value }))
                  }
                />

                <ModelField
                  title="Knowledge Graph"
                  value={draft.openrouterKnowledgeGraphModel}
                  placeholder="Leave empty to use Shared Model"
                  inheritedFrom={draft.openrouterSharedModel.trim() || undefined}
                  explicitResult={openRouterResults.knowledgeGraphExplicit}
                  inheritedResult={openRouterResults.sharedInherited}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      openrouterKnowledgeGraphModel: value,
                    }))
                  }
                />

                <ModelField
                  title="Tooltip Filtering"
                  value={draft.openrouterTooltipFilterModel}
                  placeholder="Leave empty to use Shared Model"
                  inheritedFrom={draft.openrouterSharedModel.trim() || undefined}
                  explicitResult={openRouterResults.tooltipFilterExplicit}
                  inheritedResult={openRouterResults.sharedInherited}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      openrouterTooltipFilterModel: value,
                    }))
                  }
                />

                <ModelField
                  title="HTML Injection"
                  value={draft.openrouterHtmlInjectionModel}
                  placeholder="Leave empty to use Shared Model"
                  inheritedFrom={draft.openrouterSharedModel.trim() || undefined}
                  explicitResult={openRouterResults.htmlInjectionExplicit}
                  inheritedResult={openRouterResults.sharedInherited}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      openrouterHtmlInjectionModel: value,
                    }))
                  }
                />
              </div>

              <div className="min-h-6">
                {validationLoading && (
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Loader2 size={14} className="animate-spin" />
                    Checking OpenRouter models...
                  </div>
                )}
                {validationError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{validationError}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={
              (activeTab === 'anthropic' && !isAnthropicAvailable) ||
              (activeTab === 'openrouter' &&
                (!isOpenRouterAvailable || !openRouterCanSave))
            }
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {activeTab === 'anthropic' ? 'Use Anthropic' : 'Use OpenRouter'}
          </button>
        </div>
      </div>
    </div>
  );
}
