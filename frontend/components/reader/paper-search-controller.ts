export interface PaperSearchControllerSnapshot {
  isOpen: boolean;
  query: string;
  currentMatchIndex: number;
  totalMatches: number;
  focusRequestId: number;
}

export interface PaperSearchController {
  getSnapshot(): PaperSearchControllerSnapshot;
  subscribe(listener: () => void): () => void;
  open(): void;
  close(): void;
  setQuery(query: string): void;
  next(): void;
  previous(): void;
  refresh(): void;
  dispose(): void;
}

export interface PaperSearchControllerOptions {
  getSearchRoot(): HTMLElement | null;
  debounceMs?: number;
}

interface TextMatch {
  node: Text;
  offset: number;
  length: number;
}

const initialSnapshot: PaperSearchControllerSnapshot = {
  isOpen: false,
  query: '',
  currentMatchIndex: 0,
  totalMatches: 0,
  focusRequestId: 0,
};

export function createPaperSearchController({
  getSearchRoot,
  debounceMs = 100,
}: PaperSearchControllerOptions): PaperSearchController {
  let snapshot = initialSnapshot;
  let highlightedRoot: HTMLElement | null = null;
  let searchTimeout: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = (next: PaperSearchControllerSnapshot): void => {
    if (
      next.isOpen === snapshot.isOpen
      && next.query === snapshot.query
      && next.currentMatchIndex === snapshot.currentMatchIndex
      && next.totalMatches === snapshot.totalMatches
      && next.focusRequestId === snapshot.focusRequestId
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const updateSnapshot = (update: Partial<PaperSearchControllerSnapshot>): void => {
    publish({ ...snapshot, ...update });
  };

  const cancelScheduledSearch = (): void => {
    if (searchTimeout !== undefined) {
      clearTimeout(searchTimeout);
      searchTimeout = undefined;
    }
  };

  const clearHighlightsIn = (root: HTMLElement | null): void => {
    if (!root) return;

    const parents = new Set<Node>();
    root.querySelectorAll('mark.search-highlight, mark.search-highlight-current').forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      parents.add(parent);
      parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    });
    for (const parent of parents) {
      parent.normalize();
    }
  };

  const clearHighlights = (): void => {
    clearHighlightsIn(highlightedRoot);
    highlightedRoot = null;
  };

  const collectMatches = (root: HTMLElement, query: string): TextMatch[] => {
    const matches: TextMatch[] = [];
    const lowerQuery = query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent?.closest('script, style, noscript, textarea')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node = walker.nextNode() as Text | null;
    while (node) {
      const text = node.textContent ?? '';
      const lowerText = text.toLowerCase();
      let offset = 0;
      while ((offset = lowerText.indexOf(lowerQuery, offset)) !== -1) {
        matches.push({ node, offset, length: query.length });
        offset += query.length;
      }
      node = walker.nextNode() as Text | null;
    }
    return matches;
  };

  const addHighlights = (
    matches: readonly TextMatch[],
    currentMatchIndex: number,
  ): void => {
    const matchesByNode = new Map<Text, Array<TextMatch & { index: number }>>();
    matches.forEach((match, index) => {
      const nodeMatches = matchesByNode.get(match.node) ?? [];
      nodeMatches.push({ ...match, index });
      matchesByNode.set(match.node, nodeMatches);
    });

    for (const [textNode, nodeMatches] of matchesByNode) {
      const text = textNode.textContent ?? '';
      const parent = textNode.parentNode;
      if (!parent) continue;

      nodeMatches.sort((left, right) => right.offset - left.offset);
      const fragment = document.createDocumentFragment();
      let lastOffset = text.length;

      for (const match of nodeMatches) {
        if (match.offset + match.length < lastOffset) {
          fragment.insertBefore(
            document.createTextNode(text.slice(match.offset + match.length, lastOffset)),
            fragment.firstChild,
          );
        }

        const mark = document.createElement('mark');
        mark.className = match.index === currentMatchIndex
          ? 'search-highlight search-highlight-current'
          : 'search-highlight';
        mark.textContent = text.slice(match.offset, match.offset + match.length);
        fragment.insertBefore(mark, fragment.firstChild);
        lastOffset = match.offset;
      }

      if (lastOffset > 0) {
        fragment.insertBefore(
          document.createTextNode(text.slice(0, lastOffset)),
          fragment.firstChild,
        );
      }
      parent.replaceChild(fragment, textNode);
    }
  };

  const scrollToCurrentMatch = (root: HTMLElement): void => {
    const scroll = (): void => {
      const currentMark = root.querySelector('mark.search-highlight-current');
      if (currentMark instanceof HTMLElement && typeof currentMark.scrollIntoView === 'function') {
        currentMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scroll);
    } else {
      setTimeout(scroll, 0);
    }
  };

  const performSearch = (requestedMatchIndex: number): void => {
    if (disposed) return;
    cancelScheduledSearch();
    clearHighlights();

    const root = getSearchRoot();
    const query = snapshot.query;
    if (!snapshot.isOpen || !root || !query.trim()) {
      updateSnapshot({ currentMatchIndex: 0, totalMatches: 0 });
      return;
    }

    const matches = collectMatches(root, query);
    if (matches.length === 0) {
      updateSnapshot({ currentMatchIndex: 0, totalMatches: 0 });
      return;
    }

    const currentMatchIndex = (
      (requestedMatchIndex % matches.length) + matches.length
    ) % matches.length;
    addHighlights(matches, currentMatchIndex);
    highlightedRoot = root;
    updateSnapshot({ currentMatchIndex, totalMatches: matches.length });
    scrollToCurrentMatch(root);
  };

  const scheduleSearch = (): void => {
    cancelScheduledSearch();
    if (debounceMs <= 0) {
      performSearch(0);
      return;
    }
    searchTimeout = setTimeout(() => performSearch(0), debounceMs);
  };

  const controller: PaperSearchController = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: () => {
      if (disposed) return;
      updateSnapshot({
        isOpen: true,
        focusRequestId: snapshot.focusRequestId + 1,
      });
      if (snapshot.query.trim()) {
        performSearch(snapshot.currentMatchIndex);
      }
    },
    close: () => {
      if (disposed) return;
      cancelScheduledSearch();
      clearHighlights();
      updateSnapshot({
        isOpen: false,
        query: '',
        currentMatchIndex: 0,
        totalMatches: 0,
      });
    },
    setQuery: query => {
      if (disposed || query === snapshot.query) return;
      updateSnapshot({ query, currentMatchIndex: 0, totalMatches: 0 });
      if (!snapshot.isOpen || !query.trim()) {
        cancelScheduledSearch();
        clearHighlights();
        return;
      }
      scheduleSearch();
    },
    next: () => {
      if (disposed || snapshot.totalMatches === 0 || !snapshot.query.trim()) return;
      performSearch(snapshot.currentMatchIndex + 1);
    },
    previous: () => {
      if (disposed || snapshot.totalMatches === 0 || !snapshot.query.trim()) return;
      performSearch(snapshot.currentMatchIndex - 1);
    },
    refresh: () => {
      if (disposed) return;
      cancelScheduledSearch();
      if (snapshot.isOpen && snapshot.query.trim()) {
        performSearch(snapshot.currentMatchIndex);
      } else {
        clearHighlights();
        updateSnapshot({ currentMatchIndex: 0, totalMatches: 0 });
      }
    },
    dispose: () => {
      if (disposed) return;
      cancelScheduledSearch();
      clearHighlights();
      disposed = true;
      listeners.clear();
    },
  };

  return controller;
}