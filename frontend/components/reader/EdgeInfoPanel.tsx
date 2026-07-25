'use client';

import { X } from 'lucide-react';
import { LatexText } from './LatexText';
import type { KnowledgeGraphEvidence } from '../../lib/knowledge-graph-api';

interface EdgeInfoPanelProps {
  sourceLabel: string;
  targetLabel: string;
  relationshipType: string;
  evidence?: string;
  onClose: () => void;
  onClickSource?: () => void;
  onClickTarget?: () => void;
  evidenceItems?: KnowledgeGraphEvidence[];
  onNavigateEvidence?: (evidence: KnowledgeGraphEvidence) => void;
}

// Edge colors matching KnowledgeGraphView
const edgeColors: Record<string, string> = {
  uses: '#6366f1',       // indigo
  depends_on: '#f59e0b', // amber
  defines: '#10b981',    // emerald
  extends: '#8b5cf6',    // violet
  mentions: '#94a3b8',   // slate
};

export function EdgeInfoPanel({
  sourceLabel,
  targetLabel,
  relationshipType,
  evidence,
  onClose,
  onClickSource,
  onClickTarget,
  evidenceItems = [],
  onNavigateEvidence,
}: EdgeInfoPanelProps) {
  const color = edgeColors[relationshipType] || '#94a3b8';

  return (
    <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg border border-slate-200 w-80 max-h-96 overflow-y-auto z-10">
      {/* Header */}
      <div className="flex items-start justify-between p-3 border-b border-slate-200 bg-slate-50">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">
            Relationship
          </h3>
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <button
              onClick={onClickSource}
              className={`font-medium text-slate-600 ${
                onClickSource ? 'hover:text-indigo-600 hover:underline cursor-pointer' : ''
              }`}
              disabled={!onClickSource}
            >
              <LatexText text={sourceLabel} />
            </button>
            <span
              className="px-2 py-0.5 rounded text-white font-medium"
              style={{ backgroundColor: color }}
            >
              {relationshipType}
            </span>
            <button
              onClick={onClickTarget}
              className={`font-medium text-slate-600 ${
                onClickTarget ? 'hover:text-indigo-600 hover:underline cursor-pointer' : ''
              }`}
              disabled={!onClickTarget}
            >
              <LatexText text={targetLabel} />
            </button>
          </div>
        </div>
        <button
          onClick={onClose}
          className="ml-2 p-1 hover:bg-slate-200 rounded transition-colors"
          aria-label="Close"
        >
          <X size={16} className="text-slate-500" />
        </button>
      </div>

      {/* Evidence */}
      <div className="p-3">
        {evidence ? (
          <>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Evidence
            </div>
            <div className="text-sm text-slate-700 leading-relaxed">
              <LatexText text={evidence} />
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-400 italic">
            No evidence text available for this relationship.
          </div>
        )}
        {evidenceItems.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
            {evidenceItems.map(item => (
              <button
                key={item.observation_id}
                onClick={() => onNavigateEvidence?.(item)}
                className="block w-full text-left text-xs text-slate-600 hover:text-indigo-600"
              >
                {item.source.section_title || item.source.section_id || 'Source'}: {item.source.quote}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
