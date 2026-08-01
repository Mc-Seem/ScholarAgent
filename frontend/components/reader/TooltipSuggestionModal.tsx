'use client';

import { useState, useMemo } from 'react';
import { X, Check, ChevronDown, ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { LatexText } from './LatexText';

export interface TooltipSuggestion {
  entity_id: string;
  entity_label: string;
  entity_type: string;
  tooltip_content: string;
  occurrences: Array<{
    stable_id: string;
    subject_id: string;
    dom_node_id: string | null;
    equation_id: string | null;
    start: number;
    end: number;
    text: string;
    scope_id: string;
    local_override_id: string | null;
  }>;
}

interface TooltipSuggestionModalProps {
  isOpen: boolean;
  suggestions: TooltipSuggestion[];
  totalEntities: number;
  onClose: () => void;
  onApply: (selectedSuggestions: TooltipSuggestion[]) => Promise<void>;
}

export default function TooltipSuggestionModal({
  isOpen,
  suggestions,
  totalEntities,
  onClose,
  onApply,
}: TooltipSuggestionModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(suggestions.map(s => s.entity_id))
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editedContent, setEditedContent] = useState<Map<string, string>>(new Map());
  const [applying, setApplying] = useState(false);

  // Group suggestions by type - MUST be before early return to maintain hook order
  const groupedSuggestions = useMemo(() => {
    const groups: Record<string, TooltipSuggestion[]> = {
      symbol: [],
      definition: [],
      theorem: [],
    };

    suggestions.forEach(s => {
      if (groups[s.entity_type]) {
        groups[s.entity_type].push(s);
      }
    });

    return groups;
  }, [suggestions]);

  if (!isOpen) return null;

  const handleToggleSelect = (entityId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(entityId)) {
      newSelected.delete(entityId);
    } else {
      newSelected.add(entityId);
    }
    setSelectedIds(newSelected);
  };

  const handleToggleExpand = (entityId: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(entityId)) {
      newExpanded.delete(entityId);
    } else {
      newExpanded.add(entityId);
    }
    setExpandedIds(newExpanded);
  };

  const handleContentEdit = (entityId: string, newContent: string) => {
    const newEdited = new Map(editedContent);
    newEdited.set(entityId, newContent);
    setEditedContent(newEdited);
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      // Get selected suggestions with potentially edited content
      const selected = suggestions
        .filter(s => selectedIds.has(s.entity_id))
        .map(s => ({
          ...s,
          tooltip_content: editedContent.get(s.entity_id) || s.tooltip_content,
        }));

      await onApply(selected);
    } finally {
      setApplying(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="text-indigo-600" size={24} />
              Tooltip Suggestions
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {suggestions.length} of {totalEntities} entities selected for annotation
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {Object.entries(groupedSuggestions).map(([type, items]) => {
            if (items.length === 0) return null;

            return (
              <div key={type} className="mb-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
                  {type}s ({items.length})
                </h3>

                <div className="space-y-2">
                  {items.map(suggestion => {
                    const isSelected = selectedIds.has(suggestion.entity_id);
                    const isExpanded = expandedIds.has(suggestion.entity_id);
                    const currentContent = editedContent.get(suggestion.entity_id) || suggestion.tooltip_content;

                    return (
                      <div
                        key={suggestion.entity_id}
                        className={`
                          border rounded-lg transition-all
                          ${isSelected ? 'border-indigo-300 bg-indigo-50/30' : 'border-slate-200 bg-white'}
                        `}
                      >
                        {/* Header */}
                        <div className="flex items-start gap-3 p-3">
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(suggestion.entity_id)}
                            className="mt-1 h-4 w-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                          />

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="font-medium text-slate-900 break-words">
                                  <LatexText text={suggestion.entity_label} />
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5">
                                  {suggestion.occurrences.length} occurrence{suggestion.occurrences.length !== 1 ? 's' : ''}
                                </div>
                              </div>

                              {/* Expand/Collapse */}
                              <button
                                onClick={() => handleToggleExpand(suggestion.entity_id)}
                                className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                              >
                                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                              </button>
                            </div>

                            {/* Preview */}
                            {!isExpanded && (
                              <div className="text-sm text-slate-600 mt-2 line-clamp-2">
                                {currentContent}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Expanded Content */}
                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-3 border-t border-slate-200 pt-3 mt-0">
                            {/* Editable Content */}
                            <div>
                              <label className="text-xs font-medium text-slate-600 block mb-1">
                                Tooltip Content
                              </label>
                              <textarea
                                value={currentContent}
                                onChange={(e) => handleContentEdit(suggestion.entity_id, e.target.value)}
                                rows={3}
                                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            {/* Occurrence Examples */}
                            <div>
                              <div className="text-xs font-medium text-slate-600 mb-1">
                                Example Occurrences
                              </div>
                              <div className="space-y-1">
                                {suggestion.occurrences.slice(0, 3).map(occ => (
                                  <div key={occ.stable_id} className="text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded">
                                    {occ.text} · {occ.scope_id}
                                  </div>
                                ))}
                                {suggestion.occurrences.length > 3 && (
                                  <div className="text-xs text-slate-400 italic">
                                    +{suggestion.occurrences.length - 3} more
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="text-sm text-slate-600">
            <span className="font-medium">{selectedCount}</span> tooltip{selectedCount !== 1 ? 's' : ''} selected
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={applying}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={applying || selectedCount === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {applying ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Apply {selectedCount} Tooltip{selectedCount !== 1 ? 's' : ''}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
