'use client';

import { useEffect, useRef } from 'react';
import { X, Trash2, Network } from 'lucide-react';
import type { Tooltip } from '../../hooks/useTooltips';

interface TooltipDetailViewProps {
  tooltip: Tooltip | null;
  onClose: () => void;
  onDelete?: (tooltipId: string) => void;
  onFocusGraphNode?: (nodeId: string) => void;
}

export default function TooltipDetailView({
  tooltip,
  onClose,
  onDelete,
  onFocusGraphNode,
}: TooltipDetailViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Typeset MathJax once when content is rendered
  // Note: Component will remount when tooltip.id changes (via key prop in parent)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.MathJax?.typesetPromise && containerRef.current) {
      // Use queueMicrotask for minimal delay - executes after current render
      queueMicrotask(() => {
        window.MathJax!.typesetPromise([containerRef.current!]).catch((err) => {
          console.error('[TooltipDetailView] MathJax typesetting error:', err);
        });
      });
    }
  }, []); // Empty deps - only run once per mount

  if (!tooltip) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400 px-4 text-center">
        Click on a highlighted term in the document to view its definition
      </div>
    );
  }

  // Check if this is a KG entity (not a manual tooltip)
  const isKGEntity = tooltip.entity_id && !tooltip.entity_id.startsWith('manual_');

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {tooltip.target_text || 'Annotation'}
          </h3>
          {tooltip.entity_id && (
            <p className="text-xs text-slate-500 truncate">
              Entity: {tooltip.entity_id}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2">
          {isKGEntity && onFocusGraphNode && (
            <button
              onClick={() => onFocusGraphNode(tooltip.entity_id!)}
              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
              title="View in knowledge graph"
            >
              <Network size={14} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(tooltip.id)}
              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Remove this annotation"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
            title="Close detail view"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div
          className="text-sm text-slate-700 prose prose-sm max-w-none whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: tooltip.content }}
        />
      </div>
    </div>
  );
}
