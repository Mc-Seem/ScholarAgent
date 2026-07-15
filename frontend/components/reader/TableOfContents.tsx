'use client';

import { useEffect, useRef } from 'react';
import { FileText } from 'lucide-react';
import type { TOCNode } from '../../utils/parseTOC';
import { EmptyState, TreeView } from '../ui';

interface TableOfContentsProps {
  nodes: TOCNode[];
  onNavigate?: (id: string) => void;
  currentSectionId?: string | null;
}

interface TOCNodeContentProps {
  node: TOCNode;
  onNavigate?: (id: string) => void;
  isActive: boolean;
}

function TOCNodeContent({ node, onNavigate, isActive }: TOCNodeContentProps) {
  const titleRef = useRef<HTMLSpanElement>(null);

  // Typeset MathML with MathJax when title changes
  useEffect(() => {
    const typeset = async () => {
      if (typeof window !== 'undefined' && window.MathJax?.typesetPromise && titleRef.current) {
        try {
          if (window.MathJax.startup?.promise) {
            await window.MathJax.startup.promise;
          }
          await window.MathJax.typesetPromise([titleRef.current]);
        } catch (err) {
          console.error('[TOC] MathJax typesetting error:', err);
        }
      }
    };
    typeset();
  }, [node.title]);

  return (
    <button
      className={`
        w-full text-left px-2 py-1.5 rounded text-sm
        transition-colors cursor-pointer truncate
        ${isActive ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}
      `}
      onClick={() => onNavigate?.(node.id)}
    >
      <span
        ref={titleRef}
        className="truncate"
        dangerouslySetInnerHTML={{ __html: node.title }}
      />
    </button>
  );
}

export default function TableOfContents({
  nodes,
  onNavigate,
  currentSectionId,
}: TableOfContentsProps) {
  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No table of contents available"
        description="Compile a paper with sections to see the outline."
        variant="sidebar"
      />
    );
  }

  return (
    <TreeView
      nodes={nodes}
      renderNode={(node, { isActive }) => (
        <TOCNodeContent
          node={node}
          onNavigate={onNavigate}
          isActive={isActive}
        />
      )}
      getNodeId={(node) => node.id}
      getNodeChildren={(node) => node.children}
      activeNodeId={currentSectionId}
      defaultExpanded={true}
    />
  );
}
