"use client";

import React, { useState, useRef, useCallback, useLayoutEffect, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquarePlus, X, Pencil, Trash2 } from 'lucide-react';
import type { Tooltip } from '../../hooks/useTooltips';
import { LatexText } from './LatexText';
import { ContextMenu } from './ContextMenu';

export type AnnotationActivation = 'click' | 'context-menu';

export interface AnnotationContextMenuRequest {
  dataId: string;
  targetText?: string;
  tooltips: Tooltip[];
  clientX: number;
  clientY: number;
  target: HTMLElement;
}

interface InteractiveNodeProps {
  tag: string;
  dataId: string;
  attributes: Record<string, string>;
  tooltips?: Tooltip[];
  onTooltipCreate: (content: string, targetText?: string) => void;
  onTooltipUpdate: (tooltipId: string, content: string, targetText?: string) => void;
  onTooltipDelete: (tooltipId: string) => void;
  onTooltipRemoveOccurrence?: (tooltipId: string, domNodeId: string) => void;
  annotationActivation?: AnnotationActivation;
  onAnnotationContextMenu?: (request: AnnotationContextMenuRequest) => void;
  children: ReactNode;
}

/**
 * InteractiveNode - Wrapper component for content nodes that can have tooltips.
 *
 * Renders the original HTML tag with interactive tooltip functionality:
 * - Click to view/create/manage multiple tooltips
 * - Hover highlighting for annotated nodes
 * - Each tooltip can have a target_text specifying what it annotates
 */
export function InteractiveNode({
  tag,
  dataId,
  attributes,
  tooltips = [],
  onTooltipCreate,
  onTooltipUpdate,
  onTooltipDelete,
  onTooltipRemoveOccurrence,
  annotationActivation = 'click',
  onAnnotationContextMenu,
  children
}: InteractiveNodeProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newTargetText, setNewTargetText] = useState('');
  const [newContent, setNewContent] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tooltipId: string } | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number } | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't trigger if clicking inside the popover
    if ((e.target as HTMLElement).closest('.tooltip-popover')) {
      return;
    }
    if (annotationActivation === 'context-menu') {
      return;
    }
    e.stopPropagation();
    setPopoverAnchor(null);
    setIsPopoverOpen(true);
  }, [annotationActivation]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (annotationActivation === 'context-menu' && onAnnotationContextMenu) {
      e.preventDefault();
      e.stopPropagation();
      setIsPopoverOpen(false);
      setContextMenu(null);
      const selection = window.getSelection();
      const selectedText = selection
        && selection.anchorNode
        && nodeRef.current?.contains(selection.anchorNode)
        ? selection.toString().trim()
        : '';
      onAnnotationContextMenu({
        dataId,
        targetText: selectedText || undefined,
        tooltips,
        clientX: e.clientX,
        clientY: e.clientY,
        target: e.currentTarget as HTMLElement,
      });
      return;
    }

    // Only show context menu if there are semantic tooltips (with entity_id)
    const semanticTooltip = tooltips.find(t => t.entity_id);
    if (semanticTooltip && onTooltipRemoveOccurrence) {
      e.preventDefault();
      e.stopPropagation();
      setIsPopoverOpen(false);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        tooltipId: semanticTooltip.id
      });
      return;
    }

    if (annotationActivation !== 'context-menu') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setContextMenu(null);
    setPopoverAnchor({ x: e.clientX, y: e.clientY });
    setIsAdding(tooltips.length === 0);
    setIsPopoverOpen(true);
  }, [annotationActivation, dataId, tooltips, onAnnotationContextMenu, onTooltipRemoveOccurrence]);

  const handleRemoveOccurrence = useCallback(() => {
    if (contextMenu && onTooltipRemoveOccurrence) {
      onTooltipRemoveOccurrence(contextMenu.tooltipId, dataId);
    }
  }, [contextMenu, dataId, onTooltipRemoveOccurrence]);

  const handleClose = useCallback(() => {
    setIsPopoverOpen(false);
    setIsAdding(false);
    setNewTargetText('');
    setNewContent('');
    setPopoverAnchor(null);
  }, []);

  const handleAdd = useCallback(() => {
    if (newContent.trim()) {
      onTooltipCreate(newContent.trim(), newTargetText.trim() || undefined);
      setIsAdding(false);
      setNewTargetText('');
      setNewContent('');
    }
  }, [newContent, newTargetText, onTooltipCreate]);

  // Build className
  const hasTooltips = tooltips.length > 0;
  const className = [
    attributes.class || '',
    'interactive-node',
    hasTooltips ? 'has-tooltip' : '',
    isPopoverOpen ? 'is-active' : ''
  ].filter(Boolean).join(' ');

  // Filter out attributes we handle specially and convert style string to object
  const { class: _, 'data-id': __, style, ...restAttribs } = attributes;

  // Parse style string to object if present
  const styleObj = style && typeof style === 'string'
    ? style.split(';').reduce((acc, rule) => {
        const [key, value] = rule.split(':').map(s => s.trim());
        if (key && value) {
          // Convert kebab-case to camelCase
          const camelKey = key.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          acc[camelKey] = value;
        }
        return acc;
      }, {} as Record<string, string>)
    : style;

  // Create element props
  const elementProps = {
    ref: nodeRef,
    ...restAttribs,
    'data-id': dataId,
    'data-annotation-activation': annotationActivation,
    className,
    onClick: handleClick,
    onContextMenu: handleContextMenu,
    ...(styleObj && { style: styleObj }),
  };

  return (
    <>
      {React.createElement(tag, elementProps, children)}

      <AnimatePresence>
        {isPopoverOpen && (
          <TooltipPopover
            nodeRef={nodeRef}
            anchor={popoverAnchor}
            tooltips={tooltips}
            isAdding={isAdding}
            newTargetText={newTargetText}
            newContent={newContent}
            setNewTargetText={setNewTargetText}
            setNewContent={setNewContent}
            setIsAdding={setIsAdding}
            onAdd={handleAdd}
            onUpdate={onTooltipUpdate}
            onDelete={onTooltipDelete}
            onClose={handleClose}
          />
        )}
      </AnimatePresence>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRemoveOccurrence={handleRemoveOccurrence}
        />
      )}
    </>
  );
}

interface TooltipPopoverProps {
  nodeRef: React.RefObject<HTMLElement | null>;
  anchor: { x: number; y: number } | null;
  tooltips: Tooltip[];
  isAdding: boolean;
  newTargetText: string;
  newContent: string;
  setNewTargetText: (text: string) => void;
  setNewContent: (content: string) => void;
  setIsAdding: (adding: boolean) => void;
  onAdd: () => void;
  onUpdate: (tooltipId: string, content: string, targetText?: string) => void;
  onDelete: (tooltipId: string) => void;
  onClose: () => void;
}

function TooltipPopover({
  nodeRef,
  anchor,
  tooltips,
  isAdding,
  newTargetText,
  newContent,
  setNewTargetText,
  setNewContent,
  setIsAdding,
  onAdd,
  onUpdate,
  onDelete,
  onClose
}: TooltipPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTargetText, setEditTargetText] = useState('');
  const [editContent, setEditContent] = useState('');
  const [position, setPosition] = useState<React.CSSProperties>({
    position: 'fixed',
    visibility: 'hidden',
  });

  const updatePosition = useCallback(() => {
    const node = nodeRef.current;
    const popover = popoverRef.current;
    if (!node || !popover) {
      return;
    }

    const nodeRect = node.getBoundingClientRect();
    const ownerBounds = node.closest<HTMLElement>('.scholar-reader-widget')?.getBoundingClientRect();
    const boundary = ownerBounds && ownerBounds.width > 0 && ownerBounds.height > 0
      ? ownerBounds
      : {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          width: window.innerWidth,
          height: window.innerHeight,
        };
    const margin = 8;
    const width = Math.min(420, Math.max(1, boundary.width - margin * 2));
    const maxHeight = Math.max(1, boundary.height - margin * 2);
    const measuredHeight = popover.getBoundingClientRect().height || Math.min(480, maxHeight);
    const height = Math.min(measuredHeight, maxHeight);
    const desiredLeft = anchor ? anchor.x : nodeRect.left + nodeRect.width / 2 - width / 2;
    const maximumLeft = Math.max(boundary.left + margin, boundary.right - width - margin);
    const left = Math.min(Math.max(desiredLeft, boundary.left + margin), maximumLeft);
    const anchorTop = anchor?.y ?? nodeRect.bottom;
    let top = anchorTop + margin;

    if (top + height > boundary.bottom - margin) {
      top = (anchor?.y ?? nodeRect.top) - height - margin;
    }
    top = Math.min(
      Math.max(top, boundary.top + margin),
      Math.max(boundary.top + margin, boundary.bottom - height - margin),
    );

    setPosition({
      position: 'fixed',
      zIndex: 9999,
      top,
      left,
      width,
      maxHeight,
      overflowY: 'auto',
      visibility: 'visible',
    });
  }, [anchor, nodeRef]);

  useLayoutEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition]);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !nodeRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, nodeRef]);

  const startEdit = (tooltip: Tooltip) => {
    setEditingId(tooltip.id);
    setEditTargetText(tooltip.target_text || '');
    setEditContent(tooltip.content);
  };

  const saveEdit = () => {
    if (editingId && editContent.trim()) {
      onUpdate(editingId, editContent.trim(), editTargetText.trim() || undefined);
      setEditingId(null);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTargetText('');
    setEditContent('');
  };

  return (
    <motion.div
      ref={popoverRef}
      className="tooltip-popover bg-white border border-slate-200 shadow-xl rounded-xl p-4"
      style={position}
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -5, scale: 0.98 }}
      transition={{ duration: 0.15 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
          Annotations ({tooltips.length})
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-full transition-colors"
          type="button"
          title="Close annotations"
          aria-label="Close annotations"
        >
          <X size={16} />
        </button>
      </div>

      {/* Existing annotations */}
      {tooltips.length > 0 && (
        <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
          {tooltips.map((tooltip) => (
            <div key={tooltip.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
              {editingId === tooltip.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editTargetText}
                    onChange={(e) => setEditTargetText(e.target.value)}
                    placeholder="What are you annotating? (e.g., α_t)"
                    className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    placeholder="Explanation..."
                    className="w-full border border-slate-200 rounded-md p-2 text-sm focus:ring-1 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none"
                    rows={3}
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={cancelEdit}
                      className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={!editContent.trim()}
                      className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded transition-colors disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute top-0 right-0 flex gap-1">
                    <button
                      onClick={() => startEdit(tooltip)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded transition-colors"
                    >
                      <Pencil size={10} />
                      Edit
                    </button>
                    <button
                      onClick={() => onDelete(tooltip.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                    >
                      <Trash2 size={10} />
                      Delete
                    </button>
                  </div>
                  {tooltip.target_text && (
                    <>
                      <LatexText
                        text={tooltip.target_text}
                        className="text-sm font-semibold text-indigo-700 mb-2 pr-24 break-words"
                      />
                      <div className="border-t border-slate-200 mb-2"></div>
                    </>
                  )}
                  <LatexText
                    text={tooltip.content}
                    className="text-sm text-slate-700 leading-relaxed break-words"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new annotation */}
      {isAdding ? (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <input
            autoFocus
            type="text"
            value={newTargetText}
            onChange={(e) => setNewTargetText(e.target.value)}
            placeholder="What are you annotating? (e.g., α_t, loss function)"
            className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Add your notes or explanation..."
            className="w-full border border-slate-200 rounded-md p-3 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none"
            rows={4}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setIsAdding(false);
                setNewTargetText('');
                setNewContent('');
              }}
              className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onAdd}
              disabled={!newContent.trim()}
              className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 border border-indigo-200 rounded-lg transition-colors"
        >
          <MessageSquarePlus size={16} />
          Add Annotation
        </button>
      )}
    </motion.div>
  );
}

export default InteractiveNode;
