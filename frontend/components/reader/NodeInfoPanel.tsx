'use client';

import { useState } from 'react';
import { X, Variable, BookOpen, Focus, ChevronRight, ChevronDown, Network, Wrench, BadgeCheck, Plus } from 'lucide-react';
import { LatexText } from './LatexText';
import { Button, IconButton, CollapsibleSection } from '../ui';
import { colors, textStyles } from '../../lib/design-system';
import type { KnowledgeGraphEvidence, KnowledgeGraphFacet, KnowledgeGraphSignals } from '../../lib/knowledge-graph-api';

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
  aliases?: string[];
  facets?: KnowledgeGraphFacet[];
  signals?: KnowledgeGraphSignals;
  evidence?: KnowledgeGraphEvidence[];
  rank?: number;
  onExpand?: () => void;
  omittedRelationCount?: number;
}

// Node styling config matching GraphNode - using design system colors
const nodeConfig = {
  topic: {
    bgColor: colors.entity.definition.bg,
    borderColor: colors.entity.definition.border,
    textColor: colors.entity.definition.text,
    icon: Network,
    iconColor: colors.entity.definition.icon,
    label: 'Topic',
  },
  claim: {
    bgColor: colors.entity.theorem.bg,
    borderColor: colors.entity.theorem.border,
    textColor: colors.entity.theorem.text,
    icon: BadgeCheck,
    iconColor: colors.entity.theorem.icon,
    label: 'Claim',
  },
  procedure: {
    bgColor: colors.entity.symbol.bg,
    borderColor: colors.entity.symbol.border,
    textColor: colors.entity.symbol.text,
    icon: Wrench,
    iconColor: colors.entity.symbol.icon,
    label: 'Procedure',
  },
  artifact: {
    bgColor: colors.entity.formula.bg,
    borderColor: colors.entity.formula.border,
    textColor: colors.entity.formula.text,
    icon: BookOpen,
    iconColor: colors.entity.formula.icon,
    label: 'Artifact',
  },
  quantity: {
    bgColor: colors.entity.symbol.bg,
    borderColor: colors.entity.symbol.border,
    textColor: colors.entity.symbol.text,
    icon: Variable,
    iconColor: colors.entity.symbol.icon,
    label: 'Quantity',
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
  aliases = [],
  facets = [],
  signals,
  evidence = [],
  rank,
  onExpand,
  omittedRelationCount = 0,
}: NodeInfoPanelProps) {
  const config = nodeConfig[nodeType as keyof typeof nodeConfig] || nodeConfig.topic;
  const Icon = config.icon;

  const [incomingExpanded, setIncomingExpanded] = useState(false);
  const [outgoingExpanded, setOutgoingExpanded] = useState(false);

  // Determine what content to show based on node type
  const mainContent = definition || statement || summary || context;
  const headerText = latex || label;

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

        {aliases.length > 0 && (
          <div>
            <div className={textStyles.sectionHeader + ' mb-1'}>Aliases</div>
            <div className="text-xs text-slate-600">{aliases.join(', ')}</div>
          </div>
        )}

        {(typeof rank === 'number' || signals) && (
          <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-500 border-t border-slate-100 pt-3">
            {typeof rank === 'number' && <span>View rank: {Math.round(rank * 100)}</span>}
            {signals && <>
              <span>Contribution: {Math.round(signals.contribution * 100)}</span>
              <span>Prominence: {Math.round(signals.prominence * 100)}</span>
              <span>Confidence: {Math.round(signals.confidence * 100)}</span>
            </>}
          </div>
        )}


        {evidence.length > 0 && (
          <CollapsibleSection title={`Evidence (${evidence.length})`} defaultExpanded={false}>
            <div className="space-y-2">
              {evidence.map(item => (
                <button key={item.observation_id} onClick={onNavigate} className="block text-left text-xs text-slate-600 hover:text-indigo-600">
                  “{item.source.quote}”
                  {item.source.section_title && <span className="block text-[10px] text-slate-400">{item.source.section_title}</span>}
                </button>
              ))}
            </div>
          </CollapsibleSection>
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
          {onExpand && omittedRelationCount > 0 && (
            <button onClick={onExpand} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
              <Plus size={14} /> Show {omittedRelationCount} more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
