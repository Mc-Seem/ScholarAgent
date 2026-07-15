"use client";

import React, { useEffect, useRef } from 'react';

interface LatexTextProps {
  text: string;
  className?: string;
}

/**
 * LatexText - Renders text with inline LaTeX math using MathJax.
 *
 * Supports:
 * - Inline math: $...$
 * - Display math: $$...$$
 *
 * Uses MathJax (same as the main paper rendering) for proper support of
 * \mathbb, \mathcal, and other LaTeX commands.
 *
 * Note: Renders as a <span> by default to support inline usage (e.g., within <p> tags).
 * If className includes 'block', it will render as a <div>.
 */
export function LatexText({ text, className = '' }: LatexTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
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

    // Typeset after mounting
    typeset();

    return () => {
      cancelled = true;
    };
  }, [text]);

  // Convert $ delimiters to \( \) for inline math (MathJax format)
  // Keep $$ as is for display math
  const convertedText = text.replace(/\$\$/g, '$$DISPLAY$$')
    .replace(/\$/g, (match, offset) => {
      // Check if this is part of $$DISPLAY$$
      if (text.substring(Math.max(0, offset - 1), offset + 2) === '$$$') {
        return match;
      }
      // Alternate between \( and \) for inline math
      const beforeText = text.substring(0, offset);
      const dollarCount = (beforeText.match(/\$/g) || []).length;
      return dollarCount % 2 === 0 ? '\\(' : '\\)';
    })
    .replace(/\$\$DISPLAY\$\$/g, '$$');

  return (
    <span ref={containerRef} className={className}>
      {convertedText}
    </span>
  );
}

export default LatexText;
