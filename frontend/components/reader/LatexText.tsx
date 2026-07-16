"use client";

import React, { useEffect, useLayoutEffect, useRef } from 'react';

interface LatexTextProps {
  text: string;
  className?: string;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findClosingDelimiter(text: string, start: number, delimiter: '$' | '$$'): number {
  for (let cursor = start; cursor < text.length; cursor += 1) {
    if (delimiter === '$' && text[cursor] === '\n') {
      return -1;
    }
    if (text.startsWith(delimiter, cursor) && !isEscaped(text, cursor)) {
      if (delimiter === '$' && text.startsWith('$$', cursor)) {
        cursor += 1;
        continue;
      }
      return cursor;
    }
  }
  return -1;
}

export function normalizeLatexDelimiters(text: string): string {
  let result = '';
  let cursor = 0;

  while (cursor < text.length) {
    if (text[cursor] !== '$' || isEscaped(text, cursor)) {
      result += text[cursor];
      cursor += 1;
      continue;
    }

    if (text.startsWith('$$', cursor)) {
      const closing = findClosingDelimiter(text, cursor + 2, '$$');
      if (closing >= 0) {
        result += text.slice(cursor, closing + 2);
        cursor = closing + 2;
        continue;
      }
      result += '$$';
      cursor += 2;
      continue;
    }

    const closing = findClosingDelimiter(text, cursor + 1, '$');
    if (closing >= 0) {
      result += `\\(${text.slice(cursor + 1, closing)}\\)`;
      cursor = closing + 1;
      continue;
    }

    result += '$';
    cursor += 1;
  }

  return result;
}

function containsLatex(text: string): boolean {
  return text.includes('\\(')
    || text.includes('\\[')
    || text.includes('$$')
    || text.includes('\\begin{');
}

/**
 * LatexText - Renders text with inline LaTeX math using MathJax.
 *
 * Annotation input convention:
 * - Inline math: $...$ (normalized to \(...\) only while rendering)
 * - Display math: $$...$$
 * Existing MathJax delimiters \(...\) and \[...\] are accepted as well.
 *
 * Uses MathJax (same as the main paper rendering) for proper support of
 * \mathbb, \mathcal, and other LaTeX commands.
 *
 * Renders as a <span> to support inline usage (e.g., within <p> tags).
 */
export function LatexText({ text, className = '' }: LatexTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const convertedText = normalizeLatexDelimiters(text);
  const shouldTypeset = containsLatex(convertedText);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!shouldTypeset || !container) {
      return;
    }

    // React must not own the children that MathJax replaces. In particular,
    // Theia's virtualized trees rerender their rows without changing this
    // component's props; React would otherwise restore the source delimiters.
    container.textContent = convertedText;

    return () => {
      window.MathJax?.typesetClear?.([container]);
    };
  }, [convertedText, shouldTypeset]);

  useEffect(() => {
    if (!shouldTypeset) {
      return;
    }
    let cancelled = false;

    const typeset = async () => {
      if (typeof window !== 'undefined' && window.MathJax?.typesetPromise && containerRef.current) {
        try {
          // Skip content in an explicitly hidden tab without rejecting fixed-position
          // or test-environment elements whose offsetParent is legitimately null.
          if (containerRef.current.closest('[hidden], .hidden')) {
            return;
          }
          // Wait for MathJax startup if needed
          if (window.MathJax.startup?.promise) {
            await window.MathJax.startup.promise;
          }
          // Check if component is still mounted before typesetting
          if (cancelled || !containerRef.current) {
            return;
          }
          // Typeset the container
          await window.MathJax.typesetPromise([containerRef.current]);
        } catch (err) {
          // Ignore errors if component unmounted during typesetting
          if (!cancelled) {
            console.error('[LatexText] MathJax typesetting error:', err);
          }
        }
      }
    };

    const handleMathJaxReady = () => {
      void typeset();
    };

    void typeset();
    window.addEventListener('MathJaxReady', handleMathJaxReady);

    return () => {
      cancelled = true;
      window.removeEventListener('MathJaxReady', handleMathJaxReady);
    };
  }, [convertedText, shouldTypeset]);

  return (
    <span ref={containerRef} className={className}>
      {shouldTypeset ? undefined : convertedText}
    </span>
  );
}

export default LatexText;
