'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BookOpen, List, Network } from 'lucide-react';
import TableOfContents from './TableOfContents';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import type { TOCNode } from '../../utils/parseTOC';
import {
  HttpSemanticApi,
  type EquationDetails,
  type GlossaryResponse,
  type SemanticApi,
  type SemanticSelection,
  type SemanticSubjectDetails,
} from '../../lib/semantic-api';
import { SemanticDetails } from './SemanticDetails';

interface NavigationPanelProps {
  paperId: string;
  toc: TOCNode[];
  onNavigate?: (id: string) => void;
  currentSectionId?: string | null;
  onFocusGraphNode?: (nodeId: string) => void;
  semanticSelection?: SemanticSelection | null;
  onSemanticSelect?: (selection: SemanticSelection | null) => void;
  semanticApi?: SemanticApi;
  autoOpenDetails?: boolean;
}

export default function NavigationPanel({
  paperId,
  toc,
  onNavigate,
  currentSectionId,
  onFocusGraphNode,
  semanticSelection = null,
  onSemanticSelect,
  semanticApi,
  autoOpenDetails = true,
}: NavigationPanelProps) {
  type PanelMode = 'toc' | 'graph' | 'glossary' | 'details';
  const [mode, setMode] = useState<PanelMode>('toc');
  const previousModeRef = useRef<Exclude<PanelMode, 'details'>>('toc');
  const tocRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const api = useMemo(() => semanticApi ?? new HttpSemanticApi(), [semanticApi]);
  const [subjectDetails, setSubjectDetails] = useState<SemanticSubjectDetails | null>(null);
  const [equationDetails, setEquationDetails] = useState<EquationDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [glossaryQuery, setGlossaryQuery] = useState('');
  const [glossary, setGlossary] = useState<GlossaryResponse | null>(null);

  const focusNodeRef = useRef<((nodeId: string) => void) | null>(null);

  // Handle node focus request - switch to graph tab and focus
  const handleFocusNode = useCallback((nodeId: string) => {
    setMode('graph');
    // Defer the focus call to ensure tab is switched and graph is ready
    setTimeout(() => {
      if (focusNodeRef.current) {
        focusNodeRef.current(nodeId);
      }
    }, 150);
  }, []);

  // Expose the focus function to parent through callback
  useEffect(() => {
    if (onFocusGraphNode) {
      // Pass handleFocusNode as the implementation
      onFocusGraphNode(handleFocusNode as any);
    }
  }, [onFocusGraphNode, handleFocusNode]);

  useEffect(() => {
    if (!semanticSelection || !autoOpenDetails) return;
    if (mode !== 'details') {
      previousModeRef.current = mode === 'glossary' ? 'glossary' : mode;
    }
    setMode('details');
  }, [semanticSelection, autoOpenDetails]);

  useEffect(() => {
    let active = true;
    setSubjectDetails(null);
    setEquationDetails(null);
    setDetailsError(null);
    if (!semanticSelection || semanticSelection.kind === 'edge' || semanticSelection.kind === 'evidence') {
      setDetailsLoading(false);
      return () => { active = false; };
    }
    setDetailsLoading(true);
    const request = semanticSelection.kind === 'equation'
      ? api.equationDetails(paperId, semanticSelection.equationId).then(value => {
          if (active) setEquationDetails(value);
        })
      : api.subjectDetails(
          paperId,
          semanticSelection.kind === 'occurrence' ? semanticSelection.subjectId : semanticSelection.id,
        ).then(value => {
          if (active) setSubjectDetails(value);
        });
    void request.catch(error => {
      if (active) setDetailsError(error instanceof Error ? error.message : 'Unable to load details');
    }).finally(() => {
      if (active) setDetailsLoading(false);
    });
    return () => { active = false; };
  }, [api, paperId, semanticSelection]);

  useEffect(() => {
    if (mode !== 'glossary') return;
    let active = true;
    const timeout = setTimeout(() => {
      void api.glossary(paperId, glossaryQuery, 30).then(result => {
        if (active) setGlossary(result);
      }).catch(() => {
        if (active) setGlossary(null);
      });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [api, glossaryQuery, mode, paperId]);

  // Re-typeset MathJax when switching tabs to render previously hidden content
  useEffect(() => {
    const retypeset = async () => {
      if (typeof window !== 'undefined' && window.MathJax?.typesetPromise) {
        try {
          const activeRef = mode === 'toc' ? tocRef : mode === 'graph' ? graphRef : null;
          if (activeRef?.current) {
            await window.MathJax.typesetPromise([activeRef.current]);
          }
        } catch (err) {
          console.error('[NavigationPanel] MathJax typesetting error:', err);
        }
      }
    };

    // Small delay to ensure the tab is visible before typesetting
    const timeout = setTimeout(retypeset, 50);
    return () => clearTimeout(timeout);
  }, [mode]);

  return (
    <div className="h-full flex flex-col">
      {/* Toggle buttons */}
      <div className="flex border-b border-slate-200 flex-shrink-0">
        <button
          onClick={() => setMode('toc')}
          className={`
            flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors
            ${
              mode === 'toc'
                ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500'
                : 'text-slate-600 hover:bg-slate-50'
            }
          `}
        >
          <List size={16} />
          Sections
        </button>
        <button
          onClick={() => setMode('glossary')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
            mode === 'glossary' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <BookOpen size={16} />
          Glossary
        </button>
        <button
          onClick={() => setMode('graph')}
          className={`
            flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors
            ${
              mode === 'graph'
                ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500'
                : 'text-slate-600 hover:bg-slate-50'
            }
          `}
        >
          <Network size={16} />
          Graph
        </button>
      </div>

      {/* Content - both components stay mounted to preserve state */}
      <div className="flex-1 overflow-hidden relative">
        <div ref={tocRef} className={`h-full overflow-y-auto ${mode === 'toc' ? '' : 'hidden'}`}>
          <TableOfContents
            nodes={toc}
            onNavigate={onNavigate}
            currentSectionId={currentSectionId}
          />
        </div>
        <div ref={graphRef} className={`h-full ${mode === 'graph' ? '' : 'hidden'}`}>
          <KnowledgeGraphView
            paperId={paperId}
            onNavigate={onNavigate}
            currentSectionId={currentSectionId}
            onRegisterFocusHandler={(handler) => { focusNodeRef.current = handler; }}
            onSelectionChange={selection => onSemanticSelect?.(selection)}
          />
        </div>
        <div className={`h-full ${mode === 'glossary' ? '' : 'hidden'}`}>
          <div className="h-full overflow-y-auto p-3">
            <input
              value={glossaryQuery}
              onChange={event => setGlossaryQuery(event.target.value)}
              placeholder="Search terms and notation"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mt-3 space-y-1">
              {glossary?.results.map(result => (
                <button
                  key={result.subject_id}
                  type="button"
                  onClick={() => onSemanticSelect?.({
                    kind: 'occurrence',
                    occurrenceId: `glossary:${result.subject_id}`,
                    subjectId: result.subject_id,
                    label: result.label,
                    subjectKind: result.kind,
                    scopeId: 'glossary',
                  })}
                  className="block w-full rounded-md p-2 text-left hover:bg-slate-50"
                >
                  <span className="block text-sm font-medium text-slate-800">{result.label}</span>
                  <span className="block truncate text-xs text-slate-500">{result.explanation}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {semanticSelection && mode === 'details' && (
          <SemanticDetails
            selection={semanticSelection}
            subjectDetails={subjectDetails}
            equationDetails={equationDetails}
            loading={detailsLoading}
            error={detailsError}
            onNavigate={onNavigate}
            onBack={() => {
              setMode(previousModeRef.current);
              onSemanticSelect?.(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
