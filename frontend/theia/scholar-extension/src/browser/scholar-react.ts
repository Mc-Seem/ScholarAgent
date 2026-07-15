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

export function navigateToPaperElement(paperId: string, dataId: string): void {
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
}