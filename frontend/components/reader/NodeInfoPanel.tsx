'use client';

import { useState } from 'react';
import { X, Variable, BookOpen, Lightbulb, Focus, ChevronRight, ChevronDown, FunctionSquare } from 'lucide-react';
import { LatexText } from './LatexText';
import { Button, IconButton, CollapsibleSection } from '@/components/ui';
import { colors, textStyles } from '@/lib/design-system';

export interface ConnectionInfo {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  relationshipType: string;
}

interface NodeInfoPanelProps {
  label: string;
  nodeType: string;
  context?: string;
  definition?: string;
  statement?: string;
  summary?: string;
  latex?: string;
  onClose: () => void;
  onNavigate: () => void;
  onFocus?: () => void;
  isFocused?: boolean;
  incomingConnections?: ConnectionInfo[];
  outgoingConnections?: ConnectionInfo[];
  onConnectionClick?: (nodeId: string) => void;
}

// Node styling config matching GraphNode - using design system colors
const nodeConfig = {
  formula: {
    bgColor: colors.entity.formula.bg,
    borderColor: colors.entity.formula.border,
    textColor: colors.entity.formula.text,
    icon: FunctionSquare,
    iconColor: colors.entity.formula.icon,
    label: 'Formula',
  },
  symbol: {
    bgColor: colors.entity.symbol.bg,
    borderColor: colors.entity.symbol.border,
    textColor: colors.entity.symbol.text,
    icon: Variable,
    iconColor: colors.entity.symbol.icon,
    label: 'Symbol',
  },
  definition: {
    bgColor: colors.entity.definition.bg,
    borderColor: colors.entity.definition.border,
    textColor: colors.entity.definition.text,
    icon: BookOpen,
    iconColor: colors.entity.definition.icon,
    label: 'Definition',
  },
  theorem: {
    bgColor: colors.entity.theorem.bg,
    borderColor: colors.entity.theorem.border,
    textColor: colors.entity.theorem.text,
    icon: Lightbulb,
    iconColor: colors.entity.theorem.icon,
    label: 'Theorem',
  },
};

function ensureMathDelimiters(text: string): string {
  if (!text) return text;
  if (text.includes('$') || text.includes('\\(') || text.includes('\\[')) {
    return text;
  }
  return `$${text}$`;
}

// Relationship type colors - using design system
const relationshipColors: Record<string, string> = {
  uses: colors.relationship.uses.text,
  depends_on: colors.relationship.depends_on.text,
  defines: colors.relationship.defines.text,
  extends: colors.relationship.extends.text,
  mentions: colors.relationship.mentions.text,
};

// Group connections by relationship type
function groupByRelationship(connections: ConnectionInfo[]): Record<string, ConnectionInfo[]> {
  return connections.reduce((acc, conn) => {
    if (!acc[conn.relationshipType]) {
      acc[conn.relationshipType] = [];
    }
    acc[conn.relationshipType].push(conn);
    return acc;
  }, {} as Record<string, ConnectionInfo[]>);
}

export function NodeInfoPanel({
  label,
  nodeType,
  context,
  definition,
  statement,
  summary,
  latex,
  onClose,
  onNavigate,
  onFocus,
  isFocused,
  incomingConnections = [],
  outgoingConnections = [],
  onConnectionClick,
}: NodeInfoPanelProps) {
  const config = nodeConfig[nodeType as keyof typeof nodeConfig] || nodeConfig.symbol;
  const Icon = config.icon;

  const [incomingExpanded, setIncomingExpanded] = useState(false);
  const [outgoingExpanded, setOutgoingExpanded] = useState(false);

  // Determine what content to show based on node type
  const mainContent = definition || statement || summary || context;
  const formulaTitleIsMath = nodeType === 'formula' && (!latex || label === latex);
  const headerText = nodeType === 'formula'
    ? (formulaTitleIsMath ? ensureMathDelimiters(label) : label)
    : (latex || label);
  const showFormulaBody = nodeType === 'formula' && latex && latex !== label;
  const formulaBody = showFormulaBody ? ensureMathDelimiters(latex) : null;

  // Group connections by relationship type
  const incomingGrouped = groupByRelationship(incomingConnections);
  const outgoingGrouped = groupByRelationship(outgoingConnections);

  return (
    <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg border border-slate-200 w-96 max-h-[32rem] overflow-y-auto z-10">
      {/* Header */}
      <div className={`flex items-start justify-between p-3 border-b ${config.borderColor} ${config.bgColor}`}>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Icon size={16} className={config.iconColor} />
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              {config.label}
            </span>
          </div>
          <h3 className={`text-base font-semibold ${config.textColor}`}>
            <LatexText text={headerText} className="inline" />
          </h3>
        </div>
        <IconButton icon={X} onClick={onClose} label="Close" />
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {showFormulaBody && (
          <div>
            <div className={textStyles.sectionHeader + ' mb-2'}>
              Formula
            </div>
            <div className="text-sm text-slate-700 leading-relaxed break-words">
              <LatexText text={formulaBody || ''} />
            </div>
          </div>
        )}

        {/* Main content (definition/statement/context) */}
        {mainContent && (
          <div>
            <div className={textStyles.sectionHeader + ' mb-2'}>
              {definition ? 'Definition' : statement ? 'Statement' : summary ? 'Summary' : 'Context'}
            </div>
            <div className="text-sm text-slate-700 leading-relaxed">
              <LatexText text={mainContent} />
            </div>
          </div>
        )}

        {/* Additional context for symbols */}
        {nodeType === 'symbol' && context && definition && (
          <div>
            <div className={textStyles.sectionHeader + ' mb-2'}>
              Additional Context
            </div>
            <div className="text-sm text-slate-700 leading-relaxed">
              <LatexText text={context} />
            </div>
          </div>
        )}

        {/* Incoming connections */}
        {incomingConnections.length > 0 && (
          <div className="border-t border-slate-100 pt-3">
            <button
              onClick={() => setIncomingExpanded(!incomingExpanded)}
              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 w-full"
            >
              {incomingExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Incoming ({incomingConnections.length})
            </button>
            {incomingExpanded && (
              <div className="mt-2 space-y-2">
                {Object.entries(incomingGrouped).map(([relType, connections]) => (
                  <div key={relType} className="pl-4">
                    <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${relationshipColors[relType] || 'text-slate-500'}`}>
                      {relType.replace('_', ' ')}
                    </div>
                    <div className="space-y-0.5">
                      {connections.map((conn) => (
                        <button
                          key={conn.nodeId}
                          onClick={() => onConnectionClick?.(conn.nodeId)}
                          className="flex items-center gap-1.5 text-xs text-slate-700 hover:text-indigo-600 hover:underline w-full text-left"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            conn.nodeType === 'symbol' ? 'bg-blue-500' :
                            conn.nodeType === 'definition' ? 'bg-emerald-500' :
                            conn.nodeType === 'theorem' ? 'bg-violet-500' : 'bg-amber-500'
                          }`} />
                          <span className="truncate">{conn.nodeLabel}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Outgoing connections */}
        {outgoingConnections.length > 0 && (
          <div className="border-t border-slate-100 pt-3">
            <button
              onClick={() => setOutgoingExpanded(!outgoingExpanded)}
              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 w-full"
            >
              {outgoingExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Outgoing ({outgoingConnections.length})
            </button>
            {outgoingExpanded && (
              <div className="mt-2 space-y-2">
                {Object.entries(outgoingGrouped).map(([relType, connections]) => (
                  <div key={relType} className="pl-4">
                    <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${relationshipColors[relType] || 'text-slate-500'}`}>
                      {relType.replace('_', ' ')}
                    </div>
                    <div className="space-y-0.5">
                      {connections.map((conn) => (
                        <button
                          key={conn.nodeId}
                          onClick={() => onConnectionClick?.(conn.nodeId)}
                          className="flex items-center gap-1.5 text-xs text-slate-700 hover:text-indigo-600 hover:underline w-full text-left"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            conn.nodeType === 'symbol' ? 'bg-blue-500' :
                            conn.nodeType === 'definition' ? 'bg-emerald-500' :
                            conn.nodeType === 'theorem' ? 'bg-violet-500' : 'bg-amber-500'
                          }`} />
                          <span className="truncate">{conn.nodeLabel}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={onNavigate}
            className="flex-1 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
          >
            Jump to location in paper
          </button>
          {onFocus && (
            <button
              onClick={onFocus}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                isFocused
                  ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                  : 'text-amber-700 bg-amber-50 hover:bg-amber-100'
              }`}
            >
              <Focus size={14} />
              <span>{isFocused ? 'Focused' : 'Focus'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
