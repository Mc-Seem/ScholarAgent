"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { createPaperSearchController } from "./paper-search-controller";

interface SearchBarProps {
  isOpen: boolean;
  onClose: () => void;
  searchRootRef?: RefObject<HTMLElement | null>;
  placement?: "floating" | "inline";
}

/**
 * SearchBar - Custom find-in-page that only searches within .html-renderer (paper content)
 *
 * This implementation works by:
 * 1. Searching through the original DOM to find match positions
 * 2. Wrapping matches with <mark> elements
 * 3. Storing the original text content to restore when searching again
 */
export default function SearchBar({
  isOpen,
  onClose,
  searchRootRef,
  placement = "floating",
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const getSearchContainer = useCallback((): HTMLElement | null => {
    const root = searchRootRef?.current;
    if (root) {
      return root.matches(".html-renderer")
        ? root
        : root.querySelector<HTMLElement>(".html-renderer");
    }
    return document.querySelector<HTMLElement>(".html-renderer");
  }, [searchRootRef]);

  const controller = useMemo(() => createPaperSearchController({
    getSearchRoot: getSearchContainer,
  }), [getSearchContainer]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const { query: searchQuery, currentMatchIndex, totalMatches } = snapshot;

  useEffect(() => {
    if (isOpen) {
      controller.open();
    } else {
      controller.close();
    }
  }, [controller, isOpen]);

  // Focus input when opened or explicitly requested again.
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isOpen, snapshot.focusRequestId]);

  // Navigate to next/previous match
  const navigate = useCallback((forward: boolean) => {
    if (forward) {
      controller.next();
    } else {
      controller.previous();
    }
  }, [controller]);

  // Handle close
  const handleClose = useCallback(() => {
    controller.close();
    onClose();
  }, [controller, onClose]);

  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const fromInput = e.target === inputRef.current;
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (fromInput && (e.key === "Enter" || e.key === "F3")) {
      e.preventDefault();
      navigate(!e.shiftKey);
    } else if (fromInput && e.key === "g" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      navigate(!e.shiftKey);
    }
  }, [handleClose, navigate]);

  useEffect(() => () => controller.dispose(), [controller]);

  if (!isOpen) return null;

  return (
    <>
      {/* Inline styles for search highlights */}
      <style>{`
        mark.search-highlight {
          background-color: #fef08a;
          color: inherit;
          padding: 0;
          border-radius: 2px;
        }
        mark.search-highlight-current {
          background-color: #fb923c;
        }
      `}</style>

      <div className={placement === "inline"
        ? "scholar-search-bar flex min-w-0 items-center gap-1"
        : "fixed top-4 right-4 z-50 bg-white shadow-lg rounded-lg border border-slate-200 p-2 flex items-center gap-2"
      } onKeyDown={handleKeyDown}>
        <Search size={14} className="text-slate-400 ml-1" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => controller.setQuery(e.target.value)}
          placeholder="Find in paper..."
          aria-label="Find in paper"
          className={placement === "inline"
            ? "scholar-search-input min-w-0 px-2 py-1 text-sm border-none focus:outline-none"
            : "w-48 px-2 py-1 text-sm text-slate-900 border-none focus:outline-none placeholder:text-slate-400"
          }
        />

        {/* Match count */}
        {searchQuery.trim() && (
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {totalMatches > 0
              ? `${currentMatchIndex + 1}/${totalMatches}`
              : "No matches"
            }
          </span>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center gap-0.5 border-l border-slate-200 pl-2">
          <button
            onClick={() => navigate(false)}
            disabled={totalMatches === 0}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => navigate(true)}
            disabled={totalMatches === 0}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30"
            title="Next (Enter)"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        <button
          onClick={handleClose}
          className="text-slate-400 hover:text-slate-600 p-1"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>
    </>
  );
}
