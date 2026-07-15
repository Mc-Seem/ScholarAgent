'use client';

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Pin, Edit2, Trash2, FileText } from 'lucide-react';
import type { Tooltip } from '../../hooks/useTooltips';
import type { TOCNode } from '../../utils/parseTOC';
import {
  SectionGroupingStrategy,
  FlatGroupingStrategy,
  DateGroupingStrategy,
  sortTooltipsByPriority,
  type TooltipGroup,
  type GroupingStrategy,
} from '../../utils/tooltipGrouping';
import { LatexText } from './LatexText';
import { EmptyState, IconButton, TreeView } from '../ui';
import { componentStyles } from '../../lib/design-system';

interface TooltipListProps {
  tooltips: Tooltip[];
  toc: TOCNode[];
  onEdit?: (tooltip: Tooltip) => void;
  onDelete?: (tooltipId: string) => void;
  onPin?: (tooltipId: string) => void;
  onNavigate?: (domNodeId: string) => void;
}

interface TooltipCardProps {
  tooltip: Tooltip;
  onEdit?: (tooltip: Tooltip) => void;
  onDelete?: (tooltipId: string) => void;
  onPin?: (tooltipId: string) => void;
  onNavigate?: (domNodeId: string) => void;
}

function TooltipCard({ tooltip, onEdit, onDelete, onPin, onNavigate }: TooltipCardProps) {
  // Pinned tooltips start expanded
  const [expanded, setExpanded] = useState(tooltip.is_pinned);
  const isPinned = tooltip.is_pinned;

  const handleNavigate = () => {
    if (tooltip.dom_node_id) {
      onNavigate?.(tooltip.dom_node_id);
    }
  };

  return (
    <div
      className={
        isPinned
          ? componentStyles.card.selected + ' p-3 space-y-2'
          : componentStyles.card.default + ' p-3 space-y-2'
      }
    >
      {/* Header with target text and controls */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {tooltip.target_text && (
            <button
              onClick={handleNavigate}
              className="text-sm font-medium text-slate-700 hover:text-indigo-600 transition-colors block w-full text-left break-words"
              title="Jump to location"
            >
              <LatexText text={tooltip.target_text} className="inline" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <IconButton
            icon={Pin}
            onClick={() => onPin?.(tooltip.id)}
            variant={isPinned ? 'primary' : 'default'}
            label={isPinned ? 'Unpin' : 'Pin'}
          />
          <IconButton
            icon={expanded ? ChevronDown : ChevronRight}
            onClick={() => setExpanded(!expanded)}
            label={expanded ? 'Collapse' : 'Expand'}
          />
        </div>
      </div>

      {/* Content preview (when collapsed) */}
      {!expanded && (
        <div className="text-xs text-slate-600 line-clamp-2 break-words">
          <LatexText text={tooltip.content} />
        </div>
      )}

      {/* Full content (when expanded) */}
      {expanded && (
        <>
          <div className="text-sm text-slate-700 border-t pt-2 break-words">
            <LatexText text={tooltip.content} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
            <button
              onClick={() => onEdit?.(tooltip)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded transition-colors"
            >
              <Edit2 size={12} />
              Edit
            </button>
            <button
              onClick={() => onDelete?.(tooltip.id)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            >
              <Trash2 size={12} />
              Delete
            </button>
            <div className="ml-auto text-xs text-slate-400">
              {new Date(tooltip.created_at).toLocaleDateString()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Union type for tree nodes: can be either a group or an individual tooltip
type TreeNode =
  | { type: 'group'; data: TooltipGroup }
  | { type: 'tooltip'; data: Tooltip };

// Transform TooltipGroup hierarchy to include tooltips as leaf children
function convertGroupsToTreeNodes(groups: TooltipGroup[]): TreeNode[] {
  return groups.map(group => ({
    type: 'group' as const,
    data: group,
  }));
}

// Get children for a tree node (subsections + tooltips)
function getTreeNodeChildren(node: TreeNode): TreeNode[] {
  if (node.type === 'tooltip') {
    return []; // Tooltips are leaf nodes
  }

  const group = node.data;
  const children: TreeNode[] = [];

  // Add subsection groups as children
  if (group.children && group.children.length > 0) {
    children.push(...group.children.map(child => ({
      type: 'group' as const,
      data: child,
    })));
  }

  // Add tooltips as leaf children
  const sortedTooltips = sortTooltipsByPriority(group.tooltips);
  children.push(...sortedTooltips.map(tooltip => ({
    type: 'tooltip' as const,
    data: tooltip,
  })));

  return children;
}

// Calculate total tooltip count including all descendants
function calculateTotalCount(group: TooltipGroup): number {
  let count = group.tooltips.length;
  const countChildren = (children?: TooltipGroup[]) => {
    if (!children) return;
    children.forEach(child => {
      count += child.tooltips.length;
      countChildren(child.children);
    });
  };
  countChildren(group.children);
  return count;
}

interface TreeNodeContentProps {
  node: TreeNode;
  onEdit?: (tooltip: Tooltip) => void;
  onDelete?: (tooltipId: string) => void;
  onPin?: (tooltipId: string) => void;
  onNavigate?: (domNodeId: string) => void;
}

function TreeNodeContent({ node, onEdit, onDelete, onPin, onNavigate }: TreeNodeContentProps) {
  if (node.type === 'tooltip') {
    // Render tooltip card with extra spacing
    return (
      <div className="mt-2">
        <TooltipCard
          tooltip={node.data}
          onEdit={onEdit}
          onDelete={onDelete}
          onPin={onPin}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  // Render group header (no extra spacing)
  const group = node.data;
  const totalCount = calculateTotalCount(group);

  return (
    <button
      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded transition-colors cursor-pointer"
      onClick={() => onNavigate?.(group.id)}
    >
      <span
        className="flex-1 text-left truncate"
        title={group.title.replace(/<[^>]*>/g, '')}
        dangerouslySetInnerHTML={{ __html: group.title }}
      />
      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
        {totalCount}
      </span>
    </button>
  );
}

export default function TooltipList({
  tooltips,
  toc,
  onEdit,
  onDelete,
  onPin,
  onNavigate,
}: TooltipListProps) {
  const [strategyName, setStrategyName] = useState<'section' | 'date'>('section');

  // Select grouping strategy
  const strategy: GroupingStrategy = useMemo(() => {
    switch (strategyName) {
      case 'section':
        return new SectionGroupingStrategy();
      case 'date':
        return new DateGroupingStrategy();
      default:
        return new SectionGroupingStrategy();
    }
  }, [strategyName]);

  // Group tooltips
  const groups = useMemo(() => {
    return strategy.group(tooltips, toc);
  }, [strategy, tooltips, toc]);

  // Convert to tree nodes
  const treeNodes = useMemo(() => convertGroupsToTreeNodes(groups), [groups]);

  // Empty state
  if (tooltips.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No comments yet"
        description='Click on a paragraph and choose "Add Annotation"'
        variant="sidebar"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Strategy selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 font-medium">Group by:</span>
        <div className="flex gap-1">
          {(['section', 'date'] as const).map(name => (
            <button
              key={name}
              onClick={() => setStrategyName(name)}
              className={`
                px-2 py-1 text-xs rounded transition-colors
                ${
                  strategyName === name
                    ? 'bg-indigo-100 text-indigo-700 font-medium'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }
              `}
            >
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tooltip groups */}
      <TreeView
        nodes={treeNodes}
        renderNode={(node) => (
          <TreeNodeContent
            node={node}
            onEdit={onEdit}
            onDelete={onDelete}
            onPin={onPin}
            onNavigate={onNavigate}
          />
        )}
        getNodeId={(node) =>
          node.type === 'group' ? node.data.id : `tooltip-${node.data.id}`
        }
        getNodeChildren={getTreeNodeChildren}
        defaultExpanded={true}
      />
    </div>
  );
}
