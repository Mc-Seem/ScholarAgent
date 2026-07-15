'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { List, Network } from 'lucide-react';
import TableOfContents from './TableOfContents';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import type { TOCNode } from '../../utils/parseTOC';

interface NavigationPanelProps {
  paperId: string;
  toc: TOCNode[];
  onNavigate?: (id: string) => void;
  currentSectionId?: string | null;
  onFocusGraphNode?: (nodeId: string) => void;
}

export default function NavigationPanel({
  paperId,
  toc,
  onNavigate,
  currentSectionId,
  onFocusGraphNode,
}: NavigationPanelProps) {
  const [mode, setMode] = useState<'toc' | 'graph'>('toc');
  const tocRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);

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

  // Re-typeset MathJax when switching tabs to render previously hidden content
  useEffect(() => {
    const retypeset = async () => {
      if (typeof window !== 'undefined' && window.MathJax?.typesetPromise) {
        try {
          const activeRef = mode === 'toc' ? tocRef : graphRef;
          if (activeRef.current) {
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
            onRegisterFocusHandler={(handler) => { focusNodeRef.current = handler; }}
          />
        </div>
      </div>
    </div>
  );
}
