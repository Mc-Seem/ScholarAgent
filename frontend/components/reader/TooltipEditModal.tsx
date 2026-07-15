'use client';

import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { LatexText } from './LatexText';
import { componentStyles, textStyles } from '../../lib/design-system';
import type { Tooltip } from '../../hooks/useTooltips';

interface TooltipEditModalProps {
  isOpen: boolean;
  tooltip: Tooltip | null;
  onClose: () => void;
  onSave: (tooltipId: string, newContent: string, targetText?: string) => void;
}

export default function TooltipEditModal({
  isOpen,
  tooltip,
  onClose,
  onSave,
}: TooltipEditModalProps) {
  const [content, setContent] = useState(tooltip?.content || '');

  // Update content when tooltip changes
  useEffect(() => {
    if (tooltip) {
      setContent(tooltip.content);
    }
  }, [tooltip]);

  if (!isOpen || !tooltip) return null;

  const handleSave = () => {
    const trimmedContent = content.trim();
    if (trimmedContent) {
      onSave(tooltip.id, trimmedContent, tooltip.target_text || undefined);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave();
    }
  };

  return (
    <div className={componentStyles.dialog.overlay}>
      <div className={componentStyles.dialog.container + ' max-w-2xl'}>
        {/* Header */}
        <div className={componentStyles.dialog.header}>
          <div>
            <h2 className={textStyles.h1}>Edit Tooltip</h2>
            {tooltip.target_text && (
              <div className="text-sm text-slate-600 mt-1">
                <LatexText text={tooltip.target_text} className="inline" />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className={componentStyles.dialog.body}>
          <label className={textStyles.label + ' block mb-2'}>
            Tooltip Content
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={8}
            autoFocus
            className={componentStyles.input.textarea + ' resize-y'}
            placeholder="Enter tooltip content..."
          />
          <p className={textStyles.caption + ' mt-2'}>
            Press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-slate-700">Cmd/Ctrl+Enter</kbd> to save, <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-slate-700">Esc</kbd> to cancel
          </p>
        </div>

        {/* Footer */}
        <div className={componentStyles.dialog.footer + ' justify-end gap-3'}>
          <button
            onClick={onClose}
            className={componentStyles.button.secondary}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!content.trim()}
            className={componentStyles.button.primary}
          >
            <Save size={16} />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
