import * as React from 'react'

import type { PaperSearchController } from '../../../../components/reader/paper-search-controller'

export const SCHOLAR_PAPER_FIND_TOOLBAR_ID = 'scholar-agent.paper.find-toolbar'

export interface ScholarPaperFindTarget {
  readonly node: HTMLElement
  getSearchController(): PaperSearchController
  setSearchQuery(query: string): void
  nextSearchMatch(): void
  previousSearchMatch(): void
  closeSearch(): void
}

export interface ScholarPaperFindToolbarProps {
  target: ScholarPaperFindTarget
}

export function ScholarPaperFindToolbar({
  target,
}: ScholarPaperFindToolbarProps): React.ReactElement | null {
  const controller = target.getSearchController()
  const snapshot = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useLayoutEffect(() => {
    if (snapshot.isOpen) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [snapshot.focusRequestId, snapshot.isOpen])

  const close = React.useCallback(() => {
    target.closeSearch()
    target.node.focus()
  }, [target])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }

    const navigateByEnter = event.key === 'Enter' || event.key === 'F3'
    const navigateByShortcut = event.key.toLowerCase() === 'g' && (event.ctrlKey || event.metaKey)
    if (navigateByEnter || navigateByShortcut) {
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) {
        target.previousSearchMatch()
      } else {
        target.nextSearchMatch()
      }
    }
  }, [close, target])

  if (!snapshot.isOpen) {
    return null
  }

  const hasMatches = snapshot.totalMatches > 0
  const currentMatch = hasMatches ? snapshot.currentMatchIndex + 1 : 0

  return (
    <div className="scholar-paper-find-toolbar" role="search">
      <input
        ref={inputRef}
        type="search"
        className="scholar-paper-find-input theia-input"
        aria-label="Find in paper"
        autoComplete="off"
        spellCheck={false}
        placeholder="Find"
        value={snapshot.query}
        onChange={event => target.setSearchQuery(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="scholar-paper-find-count" aria-live="polite">
        {currentMatch}/{snapshot.totalMatches}
      </span>
      <button
        type="button"
        className="scholar-paper-find-action codicon codicon-chevron-up"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={!hasMatches}
        onMouseDown={event => event.preventDefault()}
        onClick={() => target.previousSearchMatch()}
      />
      <button
        type="button"
        className="scholar-paper-find-action codicon codicon-chevron-down"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={!hasMatches}
        onMouseDown={event => event.preventDefault()}
        onClick={() => target.nextSearchMatch()}
      />
      <button
        type="button"
        className="scholar-paper-find-action codicon codicon-close"
        aria-label="Close find"
        title="Close (Escape)"
        onMouseDown={event => event.preventDefault()}
        onClick={close}
      />
    </div>
  )
}