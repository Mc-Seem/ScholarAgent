'use client';

import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Variable, BookOpen, Lightbulb, FunctionSquare, Network, Wrench, BadgeCheck } from 'lucide-react';
import { LatexText } from './LatexText';

interface GraphNodeData {
  label: string;
  nodeType: string;
  context?: string;
  definition?: string;
  statement?: string;
  summary?: string;
  latex?: string;
  domNodeId: string;
  onNavigate: () => void;
  isFocused?: boolean;
  rank?: number;
  aliases?: string[];
}

// Colors and icons for different node types
const nodeConfig = {
  concept: {
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-300',
    hoverBorderColor: 'hover:border-emerald-400',
    textColor: 'text-emerald-700',
    icon: Network,
    iconColor: 'text-emerald-500',
  },
  claim: {
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-300',
    hoverBorderColor: 'hover:border-violet-400',
    textColor: 'text-violet-700',
    icon: BadgeCheck,
    iconColor: 'text-violet-500',
  },
  method: {
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-300',
    hoverBorderColor: 'hover:border-indigo-400',
    textColor: 'text-indigo-700',
    icon: Wrench,
    iconColor: 'text-indigo-500',
  },
  formula: {
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-300',
    hoverBorderColor: 'hover:border-amber-400',
    textColor: 'text-amber-700',
    icon: FunctionSquare,
    iconColor: 'text-amber-500',
  },
  symbol: {
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-300',
    hoverBorderColor: 'hover:border-blue-400',
    textColor: 'text-blue-700',
    icon: Variable,
    iconColor: 'text-blue-500',
  },
  definition: {
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-300',
    hoverBorderColor: 'hover:border-emerald-400',
    textColor: 'text-emerald-700',
    icon: BookOpen,
    iconColor: 'text-emerald-500',
  },
  theorem: {
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-300',
    hoverBorderColor: 'hover:border-violet-400',
    textColor: 'text-violet-700',
    icon: Lightbulb,
    iconColor: 'text-violet-500',
  },
};

function ensureMathDelimiters(text: string): string {
  if (!text) return text;
  if (text.includes('$') || text.includes('\\(') || text.includes('\\[')) {
    return text;
  }
  return `$${text}$`;
}

function GraphNodeComponent({ data }: NodeProps<GraphNodeData>) {
  const config = nodeConfig[data.nodeType as keyof typeof nodeConfig] || nodeConfig.symbol;
  const Icon = config.icon;

  // Get the description based on node type
  const description = data.summary || data.context || data.definition || data.statement;
  const formulaTitleIsMath = data.nodeType === 'formula' && (!data.latex || data.label === data.latex);
  const primaryText = data.nodeType === 'formula'
    ? (formulaTitleIsMath ? ensureMathDelimiters(data.label) : data.label)
    : (data.latex || data.label);
  const secondaryLatex = data.nodeType === 'formula' && data.latex && data.latex !== data.label
    ? ensureMathDelimiters(data.latex)
    : null;
  const hoverTitle = description ? `${data.label}: ${description}` : data.label;

  return (
    <div
      className={`
        px-3 py-2 rounded-lg border-2 shadow-sm
        ${config.bgColor} ${config.borderColor} ${config.hoverBorderColor}
        cursor-pointer transition-all duration-150
        hover:shadow-md min-w-[120px] max-w-[180px]
        ${data.isFocused ? 'ring-2 ring-amber-400 ring-offset-2' : ''}
      `}
      title={hoverTitle}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-slate-400 !w-2 !h-2"
      />

      {/* Header with icon and type */}
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className={config.iconColor} />
        <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
          {data.nodeType}
        </span>
        {typeof data.rank === 'number' && (
          <span className="ml-auto text-[9px] text-slate-400" title="Projection rank">
            {Math.round(data.rank * 100)}
          </span>
        )}
      </div>

      {/* Label */}
      <div className={`text-sm font-semibold ${config.textColor} ${data.nodeType === 'formula' ? 'kg-node-math overflow-hidden' : 'truncate'}`}>
        <LatexText text={primaryText} className="inline" />
      </div>

      {/* Secondary formula preview */}
      {secondaryLatex && (
        <div className="kg-node-math overflow-hidden text-[10px] text-slate-600 mt-1">
          <LatexText text={secondaryLatex} />
        </div>
      )}

      {/* Description preview */}
      {description && (
        <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">
          <LatexText text={description} />
        </div>
      )}

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-slate-400 !w-2 !h-2"
      />
    </div>
  );
}

// Memo to prevent unnecessary re-renders
export const GraphNode = memo(GraphNodeComponent);
