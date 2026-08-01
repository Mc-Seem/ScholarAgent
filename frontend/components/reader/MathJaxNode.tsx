"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Element } from 'html-react-parser';

interface MathJaxNodeProps {
  mathml: Element;
  equationId?: string;
  onEquationSelect?: (equationId: string) => void;
}

/**
 * MathJaxNode - Renders MathML using MathJax 4 with Semantic Enrichment (SRE).
 *
 * Takes a parsed <math> element from html-react-parser and renders it
 * using MathJax for proper typesetting and semantic enrichment.
 */
export function MathJaxNode({ mathml, equationId, onEquationSelect }: MathJaxNodeProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [isRendered, setIsRendered] = useState(false);

  // Convert the Element back to HTML string for MathJax processing
  const mathmlString = elementToString(mathml);

  // Determine if this is display or inline math
  const isDisplay = mathml.attribs?.display === 'block' ||
                    mathml.attribs?.mode === 'display';
  const resolvedEquationId = equationId || mathml.attribs?.['data-id'];
  const isSelectable = Boolean(isDisplay && resolvedEquationId && onEquationSelect);

  const activateEquation = () => {
    if (resolvedEquationId && onEquationSelect) {
      onEquationSelect(resolvedEquationId);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set the MathML content
    container.innerHTML = mathmlString;

    // Check if MathJax is available and typeset
    const MathJax = (window as any).MathJax;
    if (MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([container])
        .then(() => {
          setIsRendered(true);
        })
        .catch((err: Error) => {
          console.error('MathJax typesetting failed:', err);
        });
    } else {
      // MathJax not loaded yet, wait for it
      const checkMathJax = setInterval(() => {
        const MJ = (window as any).MathJax;
        if (MJ && MJ.typesetPromise) {
          clearInterval(checkMathJax);
          MJ.typesetPromise([container])
            .then(() => setIsRendered(true))
            .catch((err: Error) => console.error('MathJax typesetting failed:', err));
        }
      }, 100);

      // Cleanup interval after 5 seconds
      setTimeout(() => clearInterval(checkMathJax), 5000);

      return () => clearInterval(checkMathJax);
    }
  }, [mathmlString]);

  const Tag = isDisplay ? 'div' : 'span';

  return (
    <Tag
      ref={containerRef as any}
      className={`mathjax-node ${isDisplay ? 'math-display' : 'math-inline'}`}
      data-mathml-source={mathmlString}
      data-equation-id={resolvedEquationId}
      role={isSelectable ? 'button' : undefined}
      aria-label={isSelectable ? `Open details for equation ${resolvedEquationId}` : undefined}
      tabIndex={isSelectable ? 0 : undefined}
      onClick={isSelectable ? activateEquation : undefined}
      onKeyDown={isSelectable ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activateEquation();
      } : undefined}
      style={{
        display: isDisplay ? 'block' : 'inline',
        textAlign: isDisplay ? 'center' : undefined,
        margin: isDisplay ? '1em 0' : undefined,
        opacity: isRendered ? 1 : 0.5,
        transition: 'opacity 0.2s ease-in-out'
      }}
    />
  );
}

/**
 * Convert a html-react-parser Element back to an HTML string.
 */
function elementToString(element: Element): string {
  const { name, attribs, children } = element;

  // Build attribute string
  const attrStr = Object.entries(attribs || {})
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(' ');

  // Build children string
  const childrenStr = (children || [])
    .map((child: any) => {
      if (child.type === 'text') {
        return child.data || '';
      }
      if (child.type === 'tag') {
        return elementToString(child as Element);
      }
      return '';
    })
    .join('');

  return `<${name}${attrStr ? ' ' + attrStr : ''}>${childrenStr}</${name}>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default MathJaxNode;
