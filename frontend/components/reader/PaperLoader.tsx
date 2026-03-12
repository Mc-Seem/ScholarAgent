"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { usePapers, Paper, PaperDetail, Section } from "@/hooks/usePapers";
import { useTooltips } from "@/hooks/useTooltips";
import { HTMLRenderer } from "./HTMLRenderer";
import ResizableLayout from "./ResizableLayout";
import NavigationPanel from "./NavigationPanel";
import TooltipPanel from "./TooltipPanel";
import TooltipSuggestionsDialog, { StoredSuggestion } from "./TooltipSuggestionsDialog";
import AISettingsDialog from "./AISettingsDialog";
import TooltipEditModal from "./TooltipEditModal";
import SearchBar from "./SearchBar";
import { parseTOC, TOCNode } from "@/utils/parseTOC";
import { API_BASE } from "@/hooks/useApi";
import { useAiPreferences } from "@/hooks/useAiPreferences";
import { Loader2, Upload, ExternalLink, Trash2, RefreshCw, FileText, AlertCircle, Network } from "lucide-react";

/**
 * Build TOC hierarchy from flat sections array (from backend).
 * The backend provides a flat list with parent_id references.
 */
function buildTOCFromSections(sections: Section[]): TOCNode[] {
  const nodeMap = new Map<string, TOCNode>();
  const root: TOCNode[] = [];

  // Create nodes
  for (const section of sections) {
    nodeMap.set(section.id, {
      id: section.id,
      title: section.title_html, // Use title_html to preserve MathML
      level: section.level,
      children: [],
    });
  }

  // Build hierarchy
  for (const section of sections) {
    const node = nodeMap.get(section.id)!;
    if (section.parent_id && nodeMap.has(section.parent_id)) {
      nodeMap.get(section.parent_id)!.children.push(node);
    } else {
      root.push(node);
    }
  }

  return root;
}

export default function PaperLoader() {
  const {
    papers,
    loading: papersLoading,
    error: papersError,
    fetchPapers,
    fetchPaper,
    uploadPaper,
    uploadArxiv,
    compilePaper,
    deletePaper,
    clearError: clearPapersError,
  } = usePapers();

  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [currentPaper, setCurrentPaper] = useState<PaperDetail | null>(null);
  const [arxivInput, setArxivInput] = useState("");
  const [status, setStatus] = useState<string>("");
  const [compilingPaperId, setCompilingPaperId] = useState<string | null>(null);

  // Tooltip suggestion state
  const [showSuggestionDialog, setShowSuggestionDialog] = useState(false);
  const [showAiSettingsDialog, setShowAiSettingsDialog] = useState(false);
  const [userExpertise, setUserExpertise] = useState<string>("");

  // Tooltip edit state
  const [editingTooltip, setEditingTooltip] = useState<any | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Search state
  const [showSearch, setShowSearch] = useState(false);

  // Active tooltip state (for detail view in right sidebar)
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);

  // Store focus graph node handler from NavigationPanel
  const focusGraphNodeRef = useRef<((nodeId: string) => void) | null>(null);

  const {
    tooltips: allTooltips,
    tooltipMap,
    entityTooltipMap,
    loading: tooltipsLoading,
    error: tooltipsError,
    fetchTooltips,
    createTooltip,
    updateTooltip,
    deleteTooltip,
    removeTooltipOccurrence,
  } = useTooltips(selectedPaperId);

  const {
    capabilities: aiCapabilities,
    effectiveProvider,
    providerSummary,
    preferences: aiPreferences,
    loading: aiCapabilitiesLoading,
    error: aiCapabilitiesError,
    validationResults,
    validationLoading,
    validationError,
    updatePreferences,
    buildAiConfig,
    validateOpenRouterModels,
  } = useAiPreferences();

  // Load papers on mount
  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  // Listen for knowledge graph build completion/error events
  useEffect(() => {
    const handleBuildComplete = (e: CustomEvent<{ nodeCount: number; edgeCount: number }>) => {
      setStatus(`Graph built: ${e.detail.nodeCount} nodes, ${e.detail.edgeCount} edges`);
      setTimeout(() => setStatus(""), 3000);
    };

    const handleBuildError = (e: CustomEvent<{ error: string }>) => {
      setStatus(`Build error: ${e.detail.error}`);
      setTimeout(() => setStatus(""), 5000);
    };

    window.addEventListener('kg-build-complete', handleBuildComplete as EventListener);
    window.addEventListener('kg-build-error', handleBuildError as EventListener);

    return () => {
      window.removeEventListener('kg-build-complete', handleBuildComplete as EventListener);
      window.removeEventListener('kg-build-error', handleBuildError as EventListener);
    };
  }, []);

  // Handle Ctrl+F to open search bar (using code to work with any keyboard layout)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Use e.code instead of e.key to support any keyboard layout
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        setShowSearch(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load selected paper
  const loadPaper = useCallback(async (paperId: string) => {
    setStatus("Loading paper...");
    const paper = await fetchPaper(paperId);
    if (paper) {
      setCurrentPaper(paper);
      setSelectedPaperId(paperId);
    }
    setStatus("");
  }, [fetchPaper]);

  // SSE connection for compilation progress (must be after loadPaper declaration)
  useEffect(() => {
    if (!compilingPaperId) return;

    const paperId = compilingPaperId;
    setStatus("Starting compilation...");

    // Connect directly to the backend — Next.js rewrites buffer SSE streams,
    // so we bypass the proxy. Use window.location.hostname so this works for
    // both localhost and remote machines without requiring NEXT_PUBLIC_API_URL.
    const backendUrl = process.env.NEXT_PUBLIC_API_URL ||
      `${window.location.protocol}//${window.location.hostname}:8000`;
    const eventSource = new EventSource(`${backendUrl}/api/papers/${paperId}/compile/progress`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') return;

        if (data.stage === 'complete') {
          eventSource.close();
          setCompilingPaperId(null);
          setStatus("");
          loadPaper(paperId);
          fetchPapers();
        } else if (data.stage === 'error') {
          eventSource.close();
          setCompilingPaperId(null);
          setStatus(`Compilation failed: ${data.error || 'Unknown error'}`);
          setTimeout(() => setStatus(""), 6000);
        } else if (data.message) {
          setStatus(data.message);
        }
      } catch {
        // ignore parse errors on heartbeat comments
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setCompilingPaperId(null);
      setStatus("Lost connection to compilation stream");
      setTimeout(() => setStatus(""), 6000);
    };

    return () => eventSource.close();
  }, [compilingPaperId, loadPaper, fetchPapers]);

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("Uploading...");
    clearPapersError();

    const paper = await uploadPaper(file, true);
    if (paper) {
      setCompilingPaperId(paper.id); // SSE takes over from here
    } else {
      setStatus("");
    }
    event.target.value = "";
  };

  // Handle arXiv fetch
  const handleArxivFetch = async () => {
    if (!arxivInput.trim()) return;

    setStatus("Fetching from arXiv...");
    clearPapersError();

    const paper = await uploadArxiv(arxivInput.trim(), true);
    if (paper) {
      setArxivInput("");
      setCompilingPaperId(paper.id); // SSE takes over from here
    } else {
      setStatus("");
    }
  };

  // Handle recompile
  const handleRecompile = async () => {
    if (!selectedPaperId) return;

    clearPapersError();

    const paper = await compilePaper(selectedPaperId);
    if (paper) {
      setCompilingPaperId(paper.id); // SSE takes over from here
    }
  };

  // Handle build knowledge graph
  const handleBuildGraph = async () => {
    if (!selectedPaperId) return;

    const aiConfig = buildAiConfig();
    if (!aiConfig) {
      setShowAiSettingsDialog(true);
      setStatus('Configure AI settings before running AI actions');
      setTimeout(() => setStatus(""), 5000);
      return;
    }

    setStatus("Building knowledge graph...");
    clearPapersError();

    // Emit event to trigger progress UI
    window.dispatchEvent(new CustomEvent('kg-build-start'));

    try {
      const res = await fetch(`${API_BASE}/api/papers/${selectedPaperId}/knowledge-graph/build`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ai_config: aiConfig,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to build graph');
      }

      const result = await res.json();
      // Build is now async, status will be cleared when progress completes
      setStatus(`Build started: ${result.message || 'Processing...'}`);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      setTimeout(() => setStatus(""), 5000);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!selectedPaperId) return;

    if (!confirm("Delete this paper and all its annotations?")) return;

    setStatus("Deleting...");
    const success = await deletePaper(selectedPaperId);
    if (success) {
      setSelectedPaperId(null);
      setCurrentPaper(null);
    }
    setStatus("");
  };

  // Handle regenerate AI suggestions
  const handleRegenerateAI = async () => {
    if (!selectedPaperId || !userExpertise) return;

    const aiConfig = buildAiConfig();
    if (!aiConfig) {
      setShowAiSettingsDialog(true);
      setStatus('Configure AI settings before running AI actions');
      setTimeout(() => setStatus(""), 5000);
      return;
    }

    setStatus('Generating AI tooltip suggestions...');

    try {
      const response = await fetch(`${API_BASE}/api/papers/${selectedPaperId}/tooltips/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_expertise: userExpertise,
          entity_types: null,
          ai_config: aiConfig,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(`Failed to suggest tooltips: ${errorData.detail || response.statusText}`);
      }

      const data = await response.json();
      setStatus(`Generated ${data.suggested_count} AI tooltip suggestions`);
      setTimeout(() => setStatus(""), 3000);
    } catch (error: any) {
      console.error('Error suggesting tooltips:', error);
      setStatus(`Error: ${error.message}`);
      setTimeout(() => setStatus(""), 5000);
    }
  };

  // Handle delete tooltip with paper reload
  const handleDeleteTooltip = async (tooltipId: string): Promise<boolean> => {
    const success = await deleteTooltip(tooltipId);

    if (success && selectedPaperId) {
      // Reload paper to show updated HTML (with spans removed)
      const paper = await fetchPaper(selectedPaperId);
      if (paper) {
        setCurrentPaper(paper);
      }
    }

    return success;
  };

  // Handle remove tooltip occurrence with paper reload
  const handleRemoveTooltipOccurrence = async (tooltipId: string, domNodeId: string) => {
    console.log('[PaperLoader] handleRemoveTooltipOccurrence called with:', tooltipId, domNodeId);
    const success = await removeTooltipOccurrence(tooltipId, domNodeId);
    console.log('[PaperLoader] removeTooltipOccurrence result:', success);

    if (success && selectedPaperId) {
      // Reload paper to show updated HTML (with span removed)
      console.log('[PaperLoader] Reloading paper...');
      const paper = await fetchPaper(selectedPaperId);
      if (paper) {
        setCurrentPaper(paper);
        console.log('[PaperLoader] Paper reloaded successfully');
      }
    }
  };

  // Handle apply suggestions
  const handleApplySuggestions = async (selectedSuggestions: StoredSuggestion[]) => {
    if (!selectedPaperId) return;

    const aiConfig = buildAiConfig();
    if (!aiConfig) {
      setShowAiSettingsDialog(true);
      setStatus('Configure AI settings before running AI actions');
      setTimeout(() => setStatus(''), 5000);
      return;
    }

    setStatus('Applying tooltips...');

    try {
      // Convert StoredSuggestion to format expected by backend
      // Note: We need to fetch occurrences from the stored HTML, but for now
      // the backend will handle finding occurrences based on entity_label
      const suggestionsForBackend = selectedSuggestions.map(s => ({
        entity_id: s.entity_id || `manual_${s.id}`,
        entity_label: s.entity_label,
        entity_type: s.entity_type,
        tooltip_content: s.tooltip_content,
        occurrences: [], // Backend will find occurrences
      }));

      const response = await fetch(`${API_BASE}/api/papers/${selectedPaperId}/tooltips/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestions: suggestionsForBackend,
          ai_config: aiConfig,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to apply tooltips: ${response.statusText}`);
      }

      const data = await response.json();

      // Close dialog
      setShowSuggestionDialog(false);

      // Reload paper to show updated HTML
      if (selectedPaperId) {
        const paper = await fetchPaper(selectedPaperId);
        if (paper) {
          setCurrentPaper(paper);
        }
      }

      // Refresh tooltips to update annotations sidebar
      await fetchTooltips();

      // Show success message briefly, then clear
      setStatus(`Applied ${data.spans_injected} spans across ${data.tooltips_created} entities`);
      setTimeout(() => setStatus(''), 3000);
    } catch (error: any) {
      console.error('Error applying tooltips:', error);
      setStatus(`Error: ${error.message}`);
      setTimeout(() => setStatus(''), 5000);
    }
  };

  const error = papersError || tooltipsError;
  const loading = papersLoading || tooltipsLoading || !!status;

  // Use pre-extracted sections from backend, with fallback to client-side parsing
  const toc = useMemo(() => {
    // Prefer pre-extracted sections from backend (Phase 0 optimization)
    if (currentPaper?.sections && currentPaper.sections.length > 0) {
      return buildTOCFromSections(currentPaper.sections);
    }
    // Fallback: parse on client-side for papers compiled before Phase 0
    if (!currentPaper?.html_content) return [];
    return parseTOC(currentPaper.html_content);
  }, [currentPaper?.sections, currentPaper?.html_content]);

  // Handle navigation to section
  const handleNavigate = useCallback((dataId: string) => {
    const element = document.querySelector(`[data-id="${dataId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Add flash effect
      element.classList.add('toc-flash');
      setTimeout(() => {
        element.classList.remove('toc-flash');
      }, 1500);
    }
  }, []);

  // Handle tooltip edit from panel
  const handleTooltipEdit = useCallback((tooltip: any) => {
    setEditingTooltip(tooltip);
    setShowEditModal(true);
  }, []);

  // Handle saving edited tooltip
  const handleSaveEdit = useCallback((tooltipId: string, newContent: string, targetText?: string) => {
    updateTooltip(tooltipId, newContent, targetText);
    setShowEditModal(false);
    setEditingTooltip(null);
  }, [updateTooltip]);

  // Handle tooltip pin/unpin
  const handleTooltipPin = useCallback((tooltipId: string) => {
    const tooltip = allTooltips.find(t => t.id === tooltipId);
    if (!tooltip) return;

    // Toggle pin state
    updateTooltip(tooltip.id, tooltip.content, tooltip.target_text || undefined, !tooltip.is_pinned);
  }, [allTooltips, updateTooltip]);

  // Left panel content
  const leftPanel = (
    <NavigationPanel
      paperId={selectedPaperId || ''}
      toc={toc}
      onNavigate={handleNavigate}
      onFocusGraphNode={(handler: any) => { focusGraphNodeRef.current = handler; }}
    />
  );

  // Main panel content
  const mainPanel = (
    <div className="py-8 px-4">
      {/* Header */}
      <div className="max-w-5xl mx-auto mb-8 text-center">
        <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2">
          Scholar Agent <span className="text-indigo-600">Reader</span>
        </h1>
        <p className="text-slate-500">
          Upload LaTeX sources or fetch from arXiv to start reading
        </p>
      </div>

      {/* Controls */}
      <div className="max-w-5xl mx-auto grid gap-4 md:grid-cols-3 mb-8">
        {/* Upload */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
            <Upload size={14} />
            Upload LaTeX
          </h2>
          <input
            type="file"
            accept=".tar.gz,.tgz,.tar,.zip"
            onChange={handleFileUpload}
            disabled={loading}
            className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
          />
          <p className="text-xs text-slate-400 mt-2">
            .tar.gz, .tgz, or .zip archives
          </p>
        </section>

        {/* arXiv */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
            <ExternalLink size={14} />
            arXiv Source
          </h2>
          <div className="flex gap-2 w-full">
            <input
              type="text"
              value={arxivInput}
              onChange={(e) => setArxivInput(e.target.value)}
              placeholder="2401.12345"
              disabled={loading}
              className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none disabled:opacity-50"
              onKeyDown={(e) => e.key === "Enter" && handleArxivFetch()}
            />
            <button
              onClick={handleArxivFetch}
              disabled={loading || !arxivInput.trim()}
              className="flex-shrink-0 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Fetch
            </button>
          </div>
        </section>

        {/* Cached Papers */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <FileText size={14} />
              Library
            </h2>
            <button
              onClick={fetchPapers}
              disabled={loading}
              className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
          <select
            value={selectedPaperId || ""}
            onChange={(e) => e.target.value && loadPaper(e.target.value)}
            disabled={loading}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 bg-slate-50 disabled:opacity-50"
          >
            <option value="">Select a paper...</option>
            {papers.map((paper) => (
              <option key={paper.id} value={paper.id}>
                {paper.filename} {!paper.has_html && "(not compiled)"}
              </option>
            ))}
          </select>
          {papers.length === 0 && !loading && (
            <p className="text-xs text-slate-400 mt-2">No papers yet</p>
          )}
        </section>
      </div>

      {/* Status/Error */}
      {status && (
        <div className="max-w-5xl mx-auto mb-4">
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            {status}
          </div>
        </div>
      )}

      {error && (
        <div className="max-w-5xl mx-auto mb-4">
          <div className="flex items-center justify-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">
            <AlertCircle size={16} />
            {error}
          </div>
        </div>
      )}

      {/* Paper Actions */}
      {currentPaper && (
        <div className="max-w-5xl mx-auto mb-4 flex items-center justify-between">
          <div className="text-sm text-slate-600">
            <span className="font-medium">{currentPaper.filename}</span>
            {currentPaper.arxiv_id && (
              <span className="ml-2 text-slate-400">
                (arXiv:{currentPaper.arxiv_id})
              </span>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={handleRecompile}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} />
              Recompile
            </button>
            <button
              onClick={handleBuildGraph}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <Network size={12} />
              Build Graph
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {currentPaper?.html_content ? (
        <div className="max-w-4xl mx-auto bg-white shadow-xl rounded-2xl border border-slate-100 p-8 md:p-12 min-h-[60vh]">
          <HTMLRenderer
            html={currentPaper.html_content}
            paperId={currentPaper.id}
            tooltips={tooltipMap}
            entityTooltipMap={entityTooltipMap}
            onTooltipCreate={createTooltip}
            onTooltipUpdate={updateTooltip}
            onTooltipDelete={handleDeleteTooltip}
            onTooltipRemoveOccurrence={handleRemoveTooltipOccurrence}
            onEntityClick={setActiveEntityId}
          />
        </div>
      ) : currentPaper && !currentPaper.has_html ? (
        <div className="max-w-4xl mx-auto bg-white shadow-xl rounded-2xl border border-slate-100 p-12 text-center">
          <div className="text-slate-400 mb-4">
            <FileText size={48} className="mx-auto opacity-50" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            Paper Not Compiled
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            This paper hasn't been compiled to HTML yet.
          </p>
          <button
            onClick={handleRecompile}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={16} />
            Compile Now
          </button>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto text-center text-sm text-slate-400 py-20">
          Upload a LaTeX archive or select a paper to start reading
        </div>
      )}
    </div>
  );

  // Right panel content
  const rightPanel = (
    <TooltipPanel
      tooltips={allTooltips}
      toc={toc}
      onEdit={handleTooltipEdit}
      onDelete={handleDeleteTooltip}
      onPin={handleTooltipPin}
      onNavigate={handleNavigate}
      onAddTooltips={() => setShowSuggestionDialog(true)}
      activeEntityId={activeEntityId}
      entityTooltipMap={entityTooltipMap}
      onCloseDetail={() => setActiveEntityId(null)}
      onFocusGraphNode={(nodeId: string) => {
        if (focusGraphNodeRef.current) {
          focusGraphNodeRef.current(nodeId);
        }
      }}
    />
  );

  return (
    <>
      <ResizableLayout
        leftPanel={leftPanel}
        mainPanel={mainPanel}
        rightPanel={rightPanel}
        onExpertiseChange={setUserExpertise}
        onOpenAiSettings={() => setShowAiSettingsDialog(true)}
        aiSettingsSummary={providerSummary}
        aiSettingsDisabled={!aiCapabilities && aiCapabilitiesLoading}
      />

      {/* Tooltip Suggestions Dialog */}
      {selectedPaperId && (
        <TooltipSuggestionsDialog
          isOpen={showSuggestionDialog}
          paperId={selectedPaperId}
          hasKnowledgeGraph={currentPaper?.has_knowledge_graph || false}
          onClose={() => setShowSuggestionDialog(false)}
          onApply={handleApplySuggestions}
          onRegenerateAI={handleRegenerateAI}
        />
      )}

      <AISettingsDialog
        isOpen={showAiSettingsDialog}
        capabilities={aiCapabilities}
        preferences={aiPreferences}
        effectiveProvider={effectiveProvider}
        loading={aiCapabilitiesLoading}
        error={aiCapabilitiesError}
        validationResults={validationResults}
        validationLoading={validationLoading}
        validationError={validationError}
        onClose={() => setShowAiSettingsDialog(false)}
        onSave={updatePreferences}
        onValidateOpenRouterModels={validateOpenRouterModels}
      />

      {/* Tooltip Edit Modal */}
      <TooltipEditModal
        isOpen={showEditModal}
        tooltip={editingTooltip}
        onClose={() => {
          setShowEditModal(false);
          setEditingTooltip(null);
        }}
        onSave={handleSaveEdit}
      />

      {/* Search Bar */}
      <SearchBar isOpen={showSearch} onClose={() => setShowSearch(false)} />
    </>
  );
}
