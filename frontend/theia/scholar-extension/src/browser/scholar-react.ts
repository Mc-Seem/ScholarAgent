import { useMemo, useSyncExternalStore } from 'react'

import type { Tooltip, TooltipMap, EntityTooltipMap } from '../../../../hooks/useTooltips'
import type { ReaderWorkspaceSnapshot } from '../../../../lib/reader-workspace-store'
import type { ScholarWorkspaceService } from './scholar-workspace-service'

export function useScholarSnapshot(store: ScholarWorkspaceService): ReaderWorkspaceSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useTooltipMaps(tooltips: Tooltip[]): {
  tooltipMap: TooltipMap
  entityTooltipMap: EntityTooltipMap
} {
  return useMemo(() => {
    const tooltipMap: TooltipMap = {}
    const entityTooltipMap: EntityTooltipMap = {}

    for (const tooltip of tooltips) {
      if (tooltip.dom_node_id) {
        ;(tooltipMap[tooltip.dom_node_id] ??= []).push(tooltip)
      }
      if (tooltip.entity_id) {
        entityTooltipMap[tooltip.entity_id] = tooltip
      }
    }

    return { tooltipMap, entityTooltipMap }
  }, [tooltips])
}

export function paperLabel(filename: string, title?: unknown): string {
  return typeof title === 'string' && title.trim()
    ? title.trim()
    : filename.replace(/\.(tar\.gz|tgz|zip|tex)$/i, '')
}

export function truncateLabel(label: string, maxLength = 45): string {
  if (label.length <= maxLength) {
    return label
  }
  return `${label.substring(0, maxLength - 1)}…`
}

export interface PaperNavigationOptions {
  quote?: string
}

export function navigateToPaperElement(
  paperId: string,
  dataId: string,
  options: PaperNavigationOptions = {},
): void {
  const paperRoot = Array.from(document.querySelectorAll<HTMLElement>('[data-scholar-paper-id]'))
    .find(element => element.dataset.scholarPaperId === paperId)
  const target = paperRoot
    ? Array.from(paperRoot.querySelectorAll<HTMLElement>('[data-id]'))
      .find(element => element.dataset.id === dataId)
    : undefined

  if (!target) {
    return
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  target.classList.add('toc-flash')
  window.setTimeout(() => target.classList.remove('toc-flash'), 1500)
  if (options.quote) {
    highlightPaperQuote(target, options.quote)
  }
}

function highlightPaperQuote(target: HTMLElement, quote: string): void {
  const exactQuote = quote.trim()
  if (!exactQuote) return

  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let combined = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    textNodes.push(text)
    combined += text.data
  }
  const quoteStart = combined.indexOf(exactQuote)
  if (quoteStart < 0) return
  const quoteEnd = quoteStart + exactQuote.length
  const marks: HTMLElement[] = []
  let offset = 0
  for (const text of textNodes) {
    const nodeStart = offset
    const nodeEnd = nodeStart + text.data.length
    offset = nodeEnd
    const start = Math.max(quoteStart, nodeStart)
    const end = Math.min(quoteEnd, nodeEnd)
    if (start >= end) continue
    const range = document.createRange()
    range.setStart(text, start - nodeStart)
    range.setEnd(text, end - nodeStart)
    const mark = document.createElement('mark')
    mark.className = 'scholar-chat-quote-highlight'
    range.surroundContents(mark)
    marks.push(mark)
  }
  window.setTimeout(() => {
    for (const mark of marks) {
      if (!mark.isConnected) continue
      const parent = mark.parentNode
      mark.replaceWith(...Array.from(mark.childNodes))
      parent?.normalize()
    }
  }, 3000)
}