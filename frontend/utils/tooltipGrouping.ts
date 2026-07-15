/**
 * Tooltip Grouping Strategy Pattern
 *
 * Allows different ways to organize tooltips in the panel:
 * - By section (default)
 * - Flat list (no grouping)
 * - By date (future)
 * - By tag (future)
 */

import type { Tooltip } from '../hooks/useTooltips';
import type { TOCNode } from './parseTOC';

export interface TooltipGroup {
  id: string;
  title: string;
  tooltips: Tooltip[];
  children?: TooltipGroup[]; // For hierarchical grouping
  level?: number; // Depth level for indentation
}

export interface GroupingStrategy {
  name: string;
  group(tooltips: Tooltip[], context?: unknown): TooltipGroup[];
}

/**
 * Group tooltips by the section they belong to (hierarchical)
 */
export class SectionGroupingStrategy implements GroupingStrategy {
  name = 'section';

  group(tooltips: Tooltip[], toc?: TOCNode[]): TooltipGroup[] {
    if (!toc || toc.length === 0) {
      // No TOC available, return as single group
      return [{
        id: 'ungrouped',
        title: 'All Tooltips',
        tooltips: tooltips,
        level: 0,
      }];
    }

    // Build a map of dom_node_id -> section
    const nodeToSection = this.buildNodeToSectionMap(toc);

    // Group tooltips by section ID
    const tooltipsBySection = new Map<string, Tooltip[]>();

    tooltips.forEach(tooltip => {
      const sectionInfo = tooltip.dom_node_id ? nodeToSection.get(tooltip.dom_node_id) : undefined;
      const sectionId = sectionInfo?.id || 'other';

      const existing = tooltipsBySection.get(sectionId);
      if (existing) {
        existing.push(tooltip);
      } else {
        tooltipsBySection.set(sectionId, [tooltip]);
      }
    });

    // Build hierarchical groups from TOC
    const hierarchicalGroups = this.buildHierarchicalGroups(toc, tooltipsBySection, 0);

    // Add "Other" group if there are orphaned tooltips
    if (tooltipsBySection.has('other')) {
      hierarchicalGroups.push({
        id: 'other',
        title: 'Other',
        tooltips: tooltipsBySection.get('other') || [],
        level: 0,
      });
    }

    return hierarchicalGroups;
  }

  /**
   * Build hierarchical groups matching the TOC structure
   */
  private buildHierarchicalGroups(
    nodes: TOCNode[],
    tooltipsBySection: Map<string, Tooltip[]>,
    level: number
  ): TooltipGroup[] {
    return nodes.map(node => {
      const tooltips = tooltipsBySection.get(node.id) || [];
      const children = this.buildHierarchicalGroups(node.children, tooltipsBySection, level + 1);

      return {
        id: node.id,
        title: node.title,
        tooltips,
        children: children.length > 0 ? children : undefined,
        level,
      };
    }).filter(group =>
      // Only include groups that have tooltips in themselves or descendants
      group.tooltips.length > 0 || (group.children && group.children.length > 0)
    );
  }

  /**
   * Build a map from dom_node_id to section info
   * Each node maps to the nearest parent section by traversing the DOM
   */
  private buildNodeToSectionMap(toc: TOCNode[]): Map<string, { id: string; title: string }> {
    const map = new Map<string, { id: string; title: string }>();

    // First, collect all section IDs
    const sectionIds = new Set<string>();
    function collectSectionIds(node: TOCNode) {
      sectionIds.add(node.id);
      node.children.forEach(collectSectionIds);
    }
    toc.forEach(collectSectionIds);

    // Now, for each element in the document, find its nearest parent section
    if (typeof document !== 'undefined') {
      const allElements = document.querySelectorAll('[data-id]');

      allElements.forEach(element => {
        const dataId = element.getAttribute('data-id');
        if (!dataId) return;

        // Walk up the DOM to find the nearest heading (section)
        let currentElement: Element | null = element;
        let nearestSection: { id: string; title: string } | null = null;

        while (currentElement) {
          const currentDataId = currentElement.getAttribute('data-id');

          if (currentDataId && sectionIds.has(currentDataId)) {
            // Found a section heading
            const sectionNode = this.findNodeById(toc, currentDataId);
            if (sectionNode) {
              nearestSection = { id: sectionNode.id, title: sectionNode.title };
              break;
            }
          }

          // Move to previous sibling or parent
          currentElement = currentElement.previousElementSibling || currentElement.parentElement;
        }

        // Map this element's data-id to its section
        if (nearestSection) {
          map.set(dataId, nearestSection);
        }
      });
    }

    return map;
  }

  /**
   * Find a TOC node by its ID
   */
  private findNodeById(nodes: TOCNode[], id: string): TOCNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = this.findNodeById(node.children, id);
      if (found) return found;
    }
    return null;
  }
}

/**
 * No grouping - flat list of all tooltips
 */
export class FlatGroupingStrategy implements GroupingStrategy {
  name = 'flat';

  group(tooltips: Tooltip[]): TooltipGroup[] {
    return [{
      id: 'all',
      title: 'All Tooltips',
      tooltips: tooltips,
    }];
  }
}

/**
 * Group by creation date (day)
 */
export class DateGroupingStrategy implements GroupingStrategy {
  name = 'date';

  group(tooltips: Tooltip[]): TooltipGroup[] {
    const groups = new Map<string, TooltipGroup>();

    tooltips.forEach(tooltip => {
      const date = new Date(tooltip.created_at);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      const dateTitle = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const existingGroup = groups.get(dateKey);
      if (existingGroup) {
        existingGroup.tooltips.push(tooltip);
      } else {
        groups.set(dateKey, {
          id: dateKey,
          title: dateTitle,
          tooltips: [tooltip],
        });
      }
    });

    // Sort groups by date (newest first)
    return Array.from(groups.values()).sort((a, b) => b.id.localeCompare(a.id));
  }
}

/**
 * Sort tooltips within a group by priority:
 * 1. Pinned first
 * 2. Then by display_order (if exists)
 * 3. Then by creation date (newest first)
 */
export function sortTooltipsByPriority(tooltips: Tooltip[]): Tooltip[] {
  return [...tooltips].sort((a, b) => {
    // Pinned first
    if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1;

    // By display_order (if set)
    const aOrder = a.display_order ?? 999999;
    const bOrder = b.display_order ?? 999999;
    if (aOrder !== bOrder) return aOrder - bOrder;

    // By date (newest first)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
