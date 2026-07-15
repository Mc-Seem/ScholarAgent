'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, MessageSquare, BookOpen } from 'lucide-react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import type { Tooltip, EntityTooltipMap } from '../../hooks/useTooltips';
import type { TOCNode } from '../../utils/parseTOC';
import TooltipList from './TooltipList';
import GlossaryList from './GlossaryList';
import TooltipDetailView from './TooltipDetailView';

interface TooltipPanelProps {
  tooltips: Tooltip[];
  toc: TOCNode[];
  onEdit?: (tooltip: Tooltip) => void;
  onDelete?: (tooltipId: string) => void;
  onPin?: (tooltipId: string) => void;
  onNavigate?: (domNodeId: string) => void;
  onAddTooltips?: () => void;
  activeEntityId?: string | null;
  entityTooltipMap?: EntityTooltipMap;
  onCloseDetail?: () => void;
  onFocusGraphNode?: (nodeId: string) => void;
}

export default function TooltipPanel({
  tooltips,
  toc,
  onEdit,
  onDelete,
  onPin,
  onNavigate,
  onAddTooltips,
  activeEntityId,
  entityTooltipMap,
  onCloseDetail,
  onFocusGraphNode,
}: TooltipPanelProps) {
  const [mode, setMode] = useState<'comments' | 'glossary'>('comments');
  const commentsRef = useRef<HTMLDivElement>(null);
  const glossaryRef = useRef<HTMLDivElement>(null);

  // Memoize filtered tooltips to avoid recalculating on every render
  const commentTooltips = useMemo(
    () => tooltips.filter(t => t.dom_node_id && !t.entity_id),
    [tooltips]
  );
  const glossaryTooltips = useMemo(
    () => tooltips.filter(t => t.entity_id),
    [tooltips]
  );

  // Find active tooltip using O(1) map lookup instead of O(n) array search
  const activeTooltip = useMemo(
    () => activeEntityId && entityTooltipMap ? entityTooltipMap[activeEntityId] || null : null,
    [activeEntityId, entityTooltipMap]
  );

  // Note: We don't programmatically collapse/expand the panel anymore
  // Instead, we conditionally render the separator and bottom panel only when there's an active tooltip

  // Re-typeset MathJax when switching tabs to render previously hidden content
  useEffect(() => {
    const retypeset = async () => {
      if (typeof window !== 'undefined' && window.MathJax?.typesetPromise) {
        try {
          const activeRef = mode === 'comments' ? commentsRef : glossaryRef;
          if (activeRef.current) {
            await window.MathJax.typesetPromise([activeRef.current]);
          }
        } catch (err) {
          console.error('[TooltipPanel] MathJax typesetting error:', err);
        }
      }
    };

    // Small delay to ensure the tab is visible before typesetting
    const timeout = setTimeout(retypeset, 50);
    return () => clearTimeout(timeout);
  }, [mode]);

  return (
    <div className="h-full flex flex-col">
      {/* Tab buttons */}
      <div className="flex border-b border-slate-200 flex-shrink-0 mb-3">
        <button
          onClick={() => setMode('comments')}
          className={`
            flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors
            ${
              mode === 'comments'
                ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500'
                : 'text-slate-600 hover:bg-slate-50'
            }
          `}
        >
          <MessageSquare size={16} />
          Comments
          <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded-full">
            {commentTooltips.length}
          </span>
        </button>
        <button
          onClick={() => setMode('glossary')}
          className={`
            flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors
            ${
              mode === 'glossary'
                ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500'
                : 'text-slate-600 hover:bg-slate-50'
            }
          `}
        >
          <BookOpen size={16} />
          Glossary
          <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded-full">
            {glossaryTooltips.length}
          </span>
        </button>
      </div>

      {/* Vertical split: List on top, Detail view on bottom */}
      <div className="flex-1 overflow-hidden">
        <Group
          orientation="vertical"
          style={{ height: '100%' }}
          id="tooltip-panel-group"
        >
          {/* Top Panel - List */}
          <Panel
            id="tooltip-list-panel"
            defaultSize={60}
            minSize={30}
          >
            <div className="h-full overflow-hidden relative">
              <div ref={commentsRef} className={`h-full overflow-y-auto px-4 ${mode === 'comments' ? '' : 'hidden'}`}>
                <TooltipList
                  tooltips={commentTooltips}
                  toc={toc}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onPin={onPin}
                  onNavigate={onNavigate}
                />
              </div>
              <div ref={glossaryRef} className={`h-full overflow-y-auto px-4 ${mode === 'glossary' ? '' : 'hidden'}`}>
                <GlossaryList
                  tooltips={glossaryTooltips}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </div>
            </div>
          </Panel>

          {/* Separator and Detail Panel - only render when tooltip is active */}
          {activeTooltip && (
            <>
              <Separator className="h-1 bg-slate-200 hover:bg-indigo-400 transition-colors cursor-row-resize" />

              {/* Bottom Panel - Detail View */}
              <Panel
                id="tooltip-detail-panel"
                defaultSize={40}
                minSize={20}
                className="bg-slate-50"
              >
                <TooltipDetailView
                  key={activeTooltip.id}
                  tooltip={activeTooltip}
                  onClose={onCloseDetail || (() => {})}
                  onDelete={onDelete}
                  onFocusGraphNode={onFocusGraphNode}
                />
              </Panel>
            </>
          )}
        </Group>
      </div>

      {/* Add Tooltips Button */}
      {onAddTooltips && (
        <div className="px-4 py-3 border-t border-slate-200">
          <button
            onClick={onAddTooltips}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add Tooltips
          </button>
        </div>
      )}
    </div>
  );
}
