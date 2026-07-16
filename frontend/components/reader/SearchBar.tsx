"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isOpen]);

  const getSearchContainer = useCallback((): HTMLElement | null => {
    const root = searchRootRef?.current;
    if (root) {
      return root.matches(".html-renderer")
        ? root
        : root.querySelector<HTMLElement>(".html-renderer");
    }
    return document.querySelector<HTMLElement>(".html-renderer");
  }, [searchRootRef]);

  // Clear all search highlights
  const clearHighlights = useCallback(() => {
    const container = getSearchContainer();
    if (!container) return;

    // Remove all mark elements and restore original text
    container.querySelectorAll("mark.search-highlight, mark.search-highlight-current").forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        const textNode = document.createTextNode(mark.textContent || "");
        parent.replaceChild(textNode, mark);
      }
    });

    // Normalize text nodes to merge adjacent text nodes
    container.normalize();
  }, [getSearchContainer]);

  // Perform search and highlight matches
  const performSearch = useCallback((query: string, matchIndex: number = 0) => {
    const container = getSearchContainer();
    if (!container || !query.trim()) {
      clearHighlights();
      setTotalMatches(0);
      setCurrentMatchIndex(0);
      return;
    }

    // Clear previous highlights
    clearHighlights();

    const lowerQuery = query.toLowerCase();
    const matches: { node: Node; offset: number; length: number }[] = [];

    // Find all text nodes and search for matches
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip empty text nodes
          if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
    }

    // Search in each text node
    textNodes.forEach((textNode) => {
      const text = textNode.textContent || "";
      const lowerText = text.toLowerCase();
      let offset = 0;

      while ((offset = lowerText.indexOf(lowerQuery, offset)) !== -1) {
        matches.push({
          node: textNode,
          offset,
          length: query.length
        });
        offset += query.length;
      }
    });

    setTotalMatches(matches.length);

    if (matches.length === 0) {
      setCurrentMatchIndex(0);
      return;
    }

    // Ensure matchIndex is valid
    const validIndex = Math.max(0, Math.min(matchIndex, matches.length - 1));
    setCurrentMatchIndex(validIndex);

    // Group matches by their parent text node for efficient highlighting
    const nodeMap = new Map<Node, { offset: number; length: number; index: number }[]>();
    matches.forEach((match, idx) => {
      if (!nodeMap.has(match.node)) {
        nodeMap.set(match.node, []);
      }
      nodeMap.get(match.node)!.push({
        offset: match.offset,
        length: match.length,
        index: idx
      });
    });

    // Highlight matches in each text node (process in reverse to maintain offsets)
    nodeMap.forEach((matchesInNode, textNode) => {
      const text = textNode.textContent || "";
      const parent = textNode.parentNode;
      if (!parent) return;

      // Sort by offset descending to process from end to start
      matchesInNode.sort((a, b) => b.offset - a.offset);

      const fragment = document.createDocumentFragment();
      let lastOffset = text.length;

      // Build fragments in reverse order
      for (const match of matchesInNode) {
        // Add text after this match
        if (match.offset + match.length < lastOffset) {
          fragment.insertBefore(
            document.createTextNode(text.slice(match.offset + match.length, lastOffset)),
            fragment.firstChild
          );
        }

        // Add highlighted match
        const mark = document.createElement("mark");
        mark.className = match.index === validIndex
          ? "search-highlight search-highlight-current"
          : "search-highlight";
        mark.textContent = text.slice(match.offset, match.offset + match.length);
        fragment.insertBefore(mark, fragment.firstChild);

        lastOffset = match.offset;
      }

      // Add text before first match
      if (lastOffset > 0) {
        fragment.insertBefore(
          document.createTextNode(text.slice(0, lastOffset)),
          fragment.firstChild
        );
      }

      // Replace the text node with the fragment
      parent.replaceChild(fragment, textNode);
    });

    // Scroll to current match
    requestAnimationFrame(() => {
      const currentMark = container.querySelector("mark.search-highlight-current");
      if (currentMark instanceof HTMLElement && typeof currentMark.scrollIntoView === "function") {
        currentMark.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [clearHighlights, getSearchContainer]);

  // Handle search query changes with debouncing
  useEffect(() => {
    if (!isOpen) return;

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      clearHighlights();
      setTotalMatches(0);
      setCurrentMatchIndex(0);
      return;
    }

    // Debounce search
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(searchQuery, 0);
    }, 100);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, isOpen, performSearch, clearHighlights]);

  // Navigate to next/previous match
  const navigate = useCallback((forward: boolean) => {
    if (totalMatches === 0 || !searchQuery.trim()) return;

    let newIndex: number;
    if (forward) {
      newIndex = (currentMatchIndex + 1) % totalMatches;
    } else {
      newIndex = (currentMatchIndex - 1 + totalMatches) % totalMatches;
    }

    performSearch(searchQuery, newIndex);
  }, [totalMatches, currentMatchIndex, searchQuery, performSearch]);

  // Handle close
  const handleClose = useCallback(() => {
    clearHighlights();
    setSearchQuery("");
    setTotalMatches(0);
    setCurrentMatchIndex(0);
    onClose();
  }, [clearHighlights, onClose]);

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

  // Clean up on unmount or close
  useEffect(() => {
    if (!isOpen) {
      clearHighlights();
    }
  }, [isOpen, clearHighlights]);

  useEffect(() => () => clearHighlights(), [clearHighlights]);

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
          onChange={(e) => setSearchQuery(e.target.value)}
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
