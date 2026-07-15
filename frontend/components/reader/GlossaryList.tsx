'use client';

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Edit2, Trash2, Sparkles, User as UserIcon } from 'lucide-react';
import type { Tooltip } from '../../hooks/useTooltips';
import { LatexText } from './LatexText';
import { EmptyState, CollapsibleSection, IconButton } from '../ui';
import { componentStyles } from '../../lib/design-system';

interface GlossaryListProps {
  tooltips: Tooltip[];
  onEdit?: (tooltip: Tooltip) => void;
  onDelete?: (tooltipId: string) => void;
}

interface GlossaryCardProps {
  tooltip: Tooltip;
  onEdit?: (tooltip: Tooltip) => void;
  onDelete?: (tooltipId: string) => void;
}

function GlossaryCard({ tooltip, onEdit, onDelete }: GlossaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={componentStyles.card.padded + ' space-y-2'}>
      {/* Header with term and controls */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {tooltip.target_text && (
            <div className="text-sm font-medium text-slate-700 break-words">
              <LatexText text={tooltip.target_text} className="inline" />
            </div>
          )}
        </div>

        <IconButton
          icon={expanded ? ChevronDown : ChevronRight}
          onClick={() => setExpanded(!expanded)}
          label={expanded ? 'Collapse' : 'Expand'}
        />
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

interface EntityGroup {
  type: string;
  label: string;
  tooltips: Tooltip[];
  isUserCreated: boolean;
}

interface GroupSectionProps {
  group: EntityGroup;
  onEdit?: (tooltip: Tooltip) => void;
  onDelete?: (tooltipId: string) => void;
}

function GroupSection({ group, onEdit, onDelete }: GroupSectionProps) {
  const icon = group.isUserCreated ? UserIcon : Sparkles;

  return (
    <CollapsibleSection
      title={group.label}
      icon={icon}
      badge={group.tooltips.length}
      defaultExpanded={true}
    >
      <div className="space-y-2 ml-4">
        {group.tooltips.map(tooltip => (
          <GlossaryCard
            key={tooltip.id}
            tooltip={tooltip}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

export default function GlossaryList({
  tooltips,
  onEdit,
  onDelete,
}: GlossaryListProps) {
  // Group tooltips by entity type and whether they're user-created or AI-generated
  const groups = useMemo(() => {
    const result: EntityGroup[] = [];

    // Separate user-created (no entity_id from KG) vs AI-generated (has entity_id)
    const userCreated: Tooltip[] = [];
    const aiGenerated = new Map<string, Tooltip[]>();

    tooltips.forEach(tooltip => {
      // If tooltip has no entity_id or entity_id is manually set, it's user-created
      // For now, we'll assume all tooltips in glossary list came from suggestions
      // and have entity_id, but we need a way to distinguish user vs AI
      // Let's infer from whether entity_id follows KG pattern (e.g., "symbol_", "def_", etc.)

      if (tooltip.entity_id && tooltip.entity_id.startsWith('manual_')) {
        // Manual tooltip (user-created)
        userCreated.push(tooltip);
      } else if (tooltip.entity_id) {
        // AI-generated tooltip - extract type from entity_id pattern
        // entity_id format: "symbol_<name>", "def_<name>", "theorem_<name>", etc.
        const typeMatch = tooltip.entity_id.match(/^([^_]+)_/);
        const entityType = typeMatch ? typeMatch[1] : 'other';

        if (!aiGenerated.has(entityType)) {
          aiGenerated.set(entityType, []);
        }
        aiGenerated.get(entityType)!.push(tooltip);
      } else {
        // Fallback: no entity_id (shouldn't happen in glossary)
        userCreated.push(tooltip);
      }
    });

    // Add user-created group first if there are any
    if (userCreated.length > 0) {
      result.push({
        type: 'user',
        label: 'User-Created',
        tooltips: userCreated,
        isUserCreated: true,
      });
    }

    // Add AI-generated groups
    const typeLabels: Record<string, string> = {
      formula: 'Formulas',
      symbol: 'Symbols',
      def: 'Definitions',
      definition: 'Definitions',
      theorem: 'Theorems',
      other: 'Other',
    };

    // Sort by type name for consistent ordering
    const sortedTypes = Array.from(aiGenerated.keys()).sort();

    sortedTypes.forEach(type => {
      const items = aiGenerated.get(type)!;
      result.push({
        type,
        label: typeLabels[type] || type.charAt(0).toUpperCase() + type.slice(1),
        tooltips: items,
        isUserCreated: false,
      });
    });

    return result;
  }, [tooltips]);

  // Empty state
  if (tooltips.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No glossary entries yet"
        description='Use "Add Tooltips" to create term definitions'
        variant="sidebar"
      />
    );
  }

  return (
    <div className="space-y-3">
      {groups.map(group => (
        <GroupSection
          key={group.type}
          group={group}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
