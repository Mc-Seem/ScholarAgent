'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface ProgressData {
  stage: string;
  progress: {
    symbols?: { current: number; total: number };
    definitions?: { current: number; total: number };
    theorems?: { current: number; total: number };
    formulas?: { current: number; total: number };
    dependencies?: { current: number; total: number };
  };
  error?: string;
  node_count?: number;
  edge_count?: number;
}

interface KnowledgeGraphProgressProps {
  paperId: string;
  onComplete: () => void;
  onError: (error: string) => void;
}

export function KnowledgeGraphProgress({
  paperId,
  onComplete,
  onError,
}: KnowledgeGraphProgressProps) {
  const [progress, setProgress] = useState<ProgressData>({
    stage: 'starting',
    progress: {},
  });

  useEffect(() => {
    // Connect directly to backend for SSE (bypasses Next.js proxy which buffers streams)
    const backendUrl = process.env.NEXT_PUBLIC_API_URL ||
      `${window.location.protocol}//${window.location.hostname}:8000`;
    const eventSource = new EventSource(
      `${backendUrl}/api/papers/${paperId}/knowledge-graph/build/progress`
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Skip connection confirmation message
        if (data.type === 'connected') return;

        setProgress(data);

        // Handle completion or error
        if (data.stage === 'complete') {
          eventSource.close();
          window.dispatchEvent(new CustomEvent('kg-build-complete', {
            detail: { nodeCount: data.node_count, edgeCount: data.edge_count }
          }));
          onComplete();
        } else if (data.stage === 'error') {
          console.error('[KG Progress] Build error:', data.error);
          eventSource.close();
          window.dispatchEvent(new CustomEvent('kg-build-error', {
            detail: { error: data.error }
          }));
          onError(data.error || 'Unknown error');
        }
      } catch (err) {
        console.error('[KG Progress] Failed to parse SSE data:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      onError('Connection to progress stream failed');
    };

    return () => {
      eventSource.close();
    };
  }, [paperId, onComplete, onError]);

  const getProgressPercent = (stage?: { current: number; total: number }) => {
    if (!stage || stage.total === 0) return 0;
    return Math.round((stage.current / stage.total) * 100);
  };

  // Check if we're in the dependencies phase (all extraction stages complete)
  const extractionComplete =
    progress.progress.symbols?.current === progress.progress.symbols?.total &&
    progress.progress.definitions?.current === progress.progress.definitions?.total &&
    progress.progress.theorems?.current === progress.progress.theorems?.total &&
    progress.progress.formulas?.current === progress.progress.formulas?.total &&
    progress.progress.symbols?.total !== undefined;

  const extractionStages = [
    { key: 'symbols', label: 'Stray Symbols', color: 'bg-blue-500' },
    { key: 'definitions', label: 'Definitions', color: 'bg-emerald-500' },
    { key: 'theorems', label: 'Theorems', color: 'bg-violet-500' },
    { key: 'formulas', label: 'Formulas', color: 'bg-amber-500' },
  ] as const;

  const dependencyStages = [
    { key: 'dependencies', label: 'Dependencies', color: 'bg-amber-500' },
  ] as const;

  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4 p-6">
      <Loader2 size={32} className="animate-spin text-indigo-500" />

      <div className="text-center">
        <h3 className="text-sm font-semibold mb-1">Building Knowledge Graph</h3>
        <p className="text-xs text-slate-500">
          {progress.stage === 'starting' && 'Initializing...'}
          {progress.stage === 'extracting' && !extractionComplete && 'Extracting entities from sections...'}
          {progress.stage === 'extracting' && extractionComplete && 'Extracting relationships...'}
        </p>
      </div>

      {progress.stage === 'extracting' && (
        <div className="w-full max-w-md space-y-3">
          {/* Entity extraction stages (parallel) */}
          <div className="text-xs text-slate-400 font-medium">Entity Extraction</div>
          {extractionStages.map(({ key, label, color }) => {
            const stageProgress = progress.progress[key];
            const percent = getProgressPercent(stageProgress);
            const isActive = stageProgress && stageProgress.current > 0;
            const isComplete = stageProgress && stageProgress.current === stageProgress.total;

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-medium ${isActive || isComplete ? 'text-slate-700' : 'text-slate-400'}`}>
                    {label}
                  </span>
                  {stageProgress && (
                    <span className="text-slate-500 tabular-nums">
                      {stageProgress.current}/{stageProgress.total}
                      {isComplete && ' ✓'}
                    </span>
                  )}
                </div>
                <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${color} transition-all duration-300 ease-out`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}

          {/* Dependency extraction stage (sequential, after entities) */}
          {extractionComplete && (
            <>
              <div className="text-xs text-slate-400 font-medium mt-4">Relationship Extraction</div>
              {dependencyStages.map(({ key, label, color }) => {
                const stageProgress = progress.progress[key];
                const percent = getProgressPercent(stageProgress);
                const isActive = stageProgress && stageProgress.current > 0;
                const isComplete = stageProgress && stageProgress.current === stageProgress.total && stageProgress.total > 0;

                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-medium ${isActive || isComplete ? 'text-slate-700' : 'text-slate-400'}`}>
                        {label}
                      </span>
                      {stageProgress && (
                        <span className="text-slate-500 tabular-nums">
                          {stageProgress.current}/{stageProgress.total}
                          {isComplete && ' ✓'}
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color} transition-all duration-300 ease-out`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-2">
        This may take a minute or two depending on paper length
      </p>
    </div>
  );
}
