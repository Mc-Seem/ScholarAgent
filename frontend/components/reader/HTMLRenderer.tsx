"use client";

import React from 'react';
import parse, { Element, domToReact, DOMNode, HTMLReactParserOptions } from 'html-react-parser';
import { MathJaxNode } from './MathJaxNode';
import {
  InteractiveNode,
  type AnnotationActivation,
  type AnnotationContextMenuRequest,
} from './InteractiveNode';
import { ContextMenu } from './ContextMenu';
import type { Tooltip } from '../../hooks/useTooltips';
import type { SemanticSelection } from '../../lib/semantic-api';

interface HTMLRendererProps {
  html: string;
  paperId: string;
  tooltips: Record<string, Tooltip[]>;
  entityTooltipMap?: Record<string, Tooltip>;
  onTooltipCreate: (domNodeId: string, content: string, targetText?: string) => void;
  onTooltipUpdate: (tooltipId: string, content: string, targetText?: string) => void;
  onTooltipDelete: (tooltipId: string) => void;
  onTooltipRemoveOccurrence?: (tooltipId: string, domNodeId: string) => void;
  onEntityClick?: (entityId: string) => void;
  onSemanticSelect?: (selection: SemanticSelection) => void;
  annotationActivation?: AnnotationActivation;
  onAnnotationContextMenu?: (request: AnnotationContextMenuRequest) => void;
}

/**
 * HTMLRenderer - Renders LaTeXML-compiled HTML with interactive components.
 *
 * Intercepts specific tags to replace them with React components:
 * - <math> tags → MathJaxNode (MathML rendering with SRE)
 * - Elements with data-id → InteractiveNode (tooltip anchoring)
 */
export function HTMLRenderer({
  html,
  paperId,
  tooltips,
  entityTooltipMap = {},
  onTooltipCreate,
  onTooltipUpdate,
  onTooltipDelete,
  onTooltipRemoveOccurrence,
  onEntityClick,
  onSemanticSelect,
  annotationActivation = 'click',
  onAnnotationContextMenu
}: HTMLRendererProps) {
  // Counter for generating stable keys for kg-entity spans
  let entitySpanCounter = 0;

  // State for context menu
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    entityId: string;
    domNodeId: string;
  } | null>(null);

  const options: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (!(domNode instanceof Element)) {
        return;
      }

      // Handle <math> elements - render with MathJax (no search highlighting in math)
      if (domNode.name === 'math') {
        return (
          <MathJaxNode
            key={domNode.attribs?.['data-id'] || Math.random().toString(36)}
            mathml={domNode}
            equationId={domNode.attribs?.['data-id']}
            onEquationSelect={onSemanticSelect ? (equationId) => onSemanticSelect({
              kind: 'equation',
              equationId,
            }) : undefined}
          />
        );
      }

      // Handle .kg-entity spans - make them clickable for detail view
      if (domNode.name === 'span' && domNode.attribs?.['class']?.includes('kg-entity')) {
        const entityId = domNode.attribs['data-entity-id'];
        const subjectId = domNode.attribs['data-subject-id'] || entityId;
        const occurrenceId = domNode.attribs['data-occurrence-id'];
        // Use a stable key combining entity ID and a counter
        // This ensures the same key across re-renders while avoiding duplicates
        const uniqueKey = `kg-entity-${entityId}-${entitySpanCounter++}`;
        const activate = (target: HTMLElement) => {
          if (occurrenceId && subjectId && onSemanticSelect) {
            const parent = target.closest('[data-id]');
            const domNodeId = parent?.getAttribute('data-id') || undefined;
            onSemanticSelect({
              kind: 'occurrence',
              occurrenceId,
              subjectId,
              label: target.textContent?.trim() || subjectId,
              subjectKind: domNode.attribs['data-entity-type'] || undefined,
              domNodeId,
              equationId: domNode.attribs['data-equation-id'] || undefined,
              scopeId: domNode.attribs['data-scope-id'] || domNodeId || 'paper',
            });
          } else if (entityId && onEntityClick) {
            onEntityClick(entityId);
          }
        };
        return (
          <span
            key={uniqueKey}
            className={domNode.attribs['class']}
            data-entity-id={entityId}
            data-entity-type={domNode.attribs['data-entity-type']}
            data-occurrence-id={occurrenceId}
            data-subject-id={subjectId}
            // A term split by inline markup arrives as several anchors; the
            // stylesheet uses this to keep the word visually whole.
            data-occurrence-part={domNode.attribs['data-occurrence-part']}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              activate(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              activate(e.currentTarget);
            }}
            onContextMenu={(e) => {
              if (!onTooltipRemoveOccurrence && !onAnnotationContextMenu) return;

              e.preventDefault();
              e.stopPropagation();

              // Find the parent element with data-id attribute
              let parentElement = (e.target as HTMLElement).parentElement;
              let domNodeId: string | null = null;

              while (parentElement && !domNodeId) {
                domNodeId = parentElement.getAttribute('data-id');
                parentElement = parentElement.parentElement;
              }

              if (domNodeId && entityId) {
                if (annotationActivation === 'context-menu' && onAnnotationContextMenu) {
                  const entityTooltip = entityTooltipMap[entityId];
                  onAnnotationContextMenu({
                    dataId: domNodeId,
                    targetText: e.currentTarget.textContent?.trim() || undefined,
                    tooltips: entityTooltip ? [entityTooltip] : [],
                    clientX: e.clientX,
                    clientY: e.clientY,
                    target: e.currentTarget,
                  });
                  return;
                }
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  entityId,
                  domNodeId
                });
              }
            }}
          >
            {domToReact(domNode.children as DOMNode[], options)}
          </span>
        );
      }

      // Handle elements with data-id attribute - make them interactive
      const dataId = domNode.attribs?.['data-id'];
      if (dataId && isInteractiveTag(domNode.name)) {
        const nodeTooltips = tooltips[dataId] || [];

        return (
          <InteractiveNode
            key={dataId}
            tag={domNode.name}
            dataId={dataId}
            attributes={domNode.attribs}
            tooltips={nodeTooltips}
            onTooltipCreate={(content, targetText) => onTooltipCreate(dataId, content, targetText)}
            onTooltipUpdate={onTooltipUpdate}
            onTooltipDelete={onTooltipDelete}
            onTooltipRemoveOccurrence={onTooltipRemoveOccurrence}
            annotationActivation={annotationActivation}
            onAnnotationContextMenu={onAnnotationContextMenu}
          >
            {domToReact(domNode.children as DOMNode[], options)}
          </InteractiveNode>
        );
      }

      // Let other elements render normally (their children will still be processed for highlighting)
      return;
    }
  };

  const handleRemoveOccurrence = React.useCallback(() => {
    console.log('[HTMLRenderer] handleRemoveOccurrence called', contextMenu);
    if (contextMenu && onTooltipRemoveOccurrence) {
      // Find the tooltip ID from the entity ID using entityTooltipMap
      const tooltip = entityTooltipMap[contextMenu.entityId];

      console.log('[HTMLRenderer] Found tooltip:', tooltip);
      console.log('[HTMLRenderer] Entity tooltip map:', entityTooltipMap);

      if (tooltip) {
        console.log('[HTMLRenderer] Calling onTooltipRemoveOccurrence with:', tooltip.id, contextMenu.domNodeId);
        onTooltipRemoveOccurrence(tooltip.id, contextMenu.domNodeId);
      } else {
        console.error('[HTMLRenderer] Could not find tooltip for entity:', contextMenu.entityId);
      }
    }
    setContextMenu(null);
  }, [contextMenu, entityTooltipMap, onTooltipRemoveOccurrence]);

  return (
    <>
      <article className="html-renderer prose prose-slate prose-indigo max-w-none">
      <style>{`
        .html-renderer {
          line-height: 1.8;
          padding-left: 2.5rem;
          padding-right: 2.5rem;
          padding-bottom: 5rem;
        }

        /* Ensure Abstract is not smaller than body text */
        .html-renderer .ltx_abstract {
          font-size: 1rem;
          margin-bottom: 2rem;
          font-style: italic;
        }

        .html-renderer .ltx_abstract h6,
        .html-renderer .ltx_abstract .ltx_title_abstract {
          font-size: 1.1rem;
          font-weight: 700;
          font-style: normal;
          margin-bottom: 0.5rem;
        }

        .html-renderer h1,
        .html-renderer h2,
        .html-renderer h3,
        .html-renderer h4,
        .html-renderer h5,
        .html-renderer h6 {
          font-weight: 700;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }

        /* Remove top margin from first heading (title) */
        .html-renderer > h1:first-child,
        .html-renderer > *:first-child h1:first-of-type {
          margin-top: 0;
        }

        .html-renderer h1 { font-size: 2em; }
        .html-renderer h2 { font-size: 1.5em; }
        .html-renderer h3 { font-size: 1.25em; }

        .html-renderer p {
          margin-bottom: 1em;
        }

        .html-renderer ul,
        .html-renderer ol {
          margin: 1em 0;
          padding-left: 2em;
        }

        .html-renderer li {
          margin-bottom: 0.5em;
          display: flex;
          align-items: baseline;
        }

        /* Fix LaTeXML list item bullets and content */
        .html-renderer .ltx_tag_item {
          display: inline-block;
          margin-right: 0.5em;
          flex-shrink: 0;
          line-height: inherit;
        }

        .html-renderer li .ltx_para {
          display: block;
          flex: 1;
          margin: 0;
        }

        .html-renderer figure {
          margin: 2em 0;
          text-align: center;
        }

        .html-renderer figcaption {
          font-size: 0.875em;
          color: #64748b;
          margin-top: 0.5em;
        }

        .html-renderer table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.5em 0;
          display: table !important;
          position: relative !important;
          clear: both;
        }

        .html-renderer th,
        .html-renderer td {
          border: 1px solid #e2e8f0;
          padding: 0.5em 1em;
          text-align: left;
        }

        .html-renderer th {
          background-color: #f8fafc;
          font-weight: 600;
        }

        /* Fix LaTeXML table containers */
        .html-renderer .ltx_table,
        .html-renderer .ltx_tabular,
        .html-renderer div.ltx_table {
          display: block;
          position: relative;
          clear: both;
          margin: 1.5em 0;
          overflow: visible;
        }

        .html-renderer .ltx_table table {
          position: static !important;
        }

        /* Fix LaTeXML inline-block transformed tables with fixed heights */
        .html-renderer .ltx_table .ltx_inline-block.ltx_transformed_outer {
          height: auto !important;
          vertical-align: baseline !important;
          display: block !important;
          width: 100% !important;
        }

        .html-renderer .ltx_table .ltx_transformed_inner {
          transform: none !important;
          display: block !important;
        }

        .html-renderer blockquote {
          border-left: 4px solid #6366f1;
          padding-left: 1em;
          margin: 1.5em 0;
          color: #475569;
          font-style: italic;
        }

        .html-renderer pre {
          background-color: #1e293b;
          color: #e2e8f0;
          padding: 1em;
          border-radius: 0.5em;
          overflow-x: auto;
        }

        .html-renderer code {
          font-family: ui-monospace, monospace;
          font-size: 0.875em;
        }

        .html-renderer a {
          color: #4f46e5;
          text-decoration: underline;
        }

        .html-renderer a:hover {
          color: #4338ca;
        }

        /* LaTeXML specific styles */
        .html-renderer .ltx_font_bold {
          font-weight: 700;
        }

        .html-renderer .ltx_font_italic {
          font-style: italic;
        }

        .html-renderer .ltx_font_typewriter {
          font-family: ui-monospace, monospace;
        }

        .html-renderer .ltx_theorem {
          background-color: #f8fafc;
          border-left: 4px solid #6366f1;
          padding: 1em;
          margin: 1.5em 0;
        }

        .html-renderer .ltx_proof {
          margin: 1em 0;
          padding-left: 1em;
          border-left: 2px solid #cbd5e1;
        }

        .html-renderer .ltx_equation {
          display: flex;
          justify-content: center;
          margin: 1.5em 0;
        }

        .html-renderer .ltx_ref {
          color: #4f46e5;
          cursor: pointer;
        }

        .html-renderer .ltx_cite {
          color: #059669;
        }

        .html-renderer .ltx_bibliography {
          margin-top: 3em;
          padding-top: 2em;
          border-top: 1px solid #e2e8f0;
        }

        /* Injected tooltip (KG entity) styles */
        .html-renderer .kg-entity {
          border-bottom: 1px solid #a5b4fc;
          background-color: rgba(238, 242, 255, 0.45);
          cursor: pointer;
        }
      `}</style>

      {parse(html, options)}
    </article>

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

/**
 * Check if a tag should be made interactive (clickable for tooltips)
 */
function isInteractiveTag(tagName: string): boolean {
  const interactiveTags = new Set([
    'p', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'figure', 'table', 'li', 'blockquote', 'pre'
  ]);
  return interactiveTags.has(tagName);
}

export default HTMLRenderer;
