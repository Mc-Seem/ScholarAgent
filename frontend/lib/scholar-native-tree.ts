import type { Tooltip } from '../hooks/useTooltips'
import type { TOCNode } from '../utils/parseTOC'

export type ScholarTreeEntryKind = 'section' | 'group' | 'comment' | 'glossary'

export interface ScholarTreeEntry {
  id: string
  kind: ScholarTreeEntryKind
  label: string
  description?: string
  searchText?: string
  sourceId?: string
  tooltipId?: string
  entityId?: string
  count?: number
  pinned?: boolean
  children: ScholarTreeEntry[]
}

type ResolveSection = (domNodeId: string) => string | undefined

const entityTypeLabels: Record<string, string> = {
  formula: 'Formulas',
  symbol: 'Symbols',
  def: 'Definitions',
  definition: 'Definitions',
  theorem: 'Theorems',
  other: 'Other',
}

export function buildOutlineTree(toc: TOCNode[]): ScholarTreeEntry[] {
  return toc.map(section => ({
    id: `section:${section.id}`,
    kind: 'section',
    label: plainText(section.title) || 'Untitled section',
    sourceId: section.id,
    children: buildOutlineTree(section.children),
  }))
}

export function mapHtmlNodesToSections(html: string | null, toc: TOCNode[]): Map<string, string> {
  const result = new Map<string, string>()
  if (!html || typeof DOMParser === 'undefined') {
    return result
  }

  const sectionIds = new Set<string>()
  const collectSections = (nodes: TOCNode[]): void => {
    nodes.forEach(node => {
      sectionIds.add(node.id)
      collectSections(node.children)
    })
  }
  collectSections(toc)

  const document = new DOMParser().parseFromString(html, 'text/html')
  let precedingSection: string | undefined
  document.querySelectorAll<HTMLElement>('[data-id]').forEach(element => {
    const id = element.dataset.id
    if (!id) {
      return
    }
    if (sectionIds.has(id)) {
      precedingSection = id
    }

    let ancestor: Element | null = element
    let containingSection: string | undefined
    while (ancestor) {
      const ancestorId = ancestor.getAttribute('data-id') ?? undefined
      if (ancestorId && sectionIds.has(ancestorId)) {
        containingSection = ancestorId
        break
      }
      ancestor = ancestor.parentElement
    }

    const sectionId = containingSection ?? precedingSection
    if (sectionId) {
      result.set(id, sectionId)
    }
  })
  return result
}

export function buildCommentTree(
  tooltips: Tooltip[],
  toc: TOCNode[],
  resolveSection: ResolveSection,
): ScholarTreeEntry[] {
  const comments = tooltips.filter(tooltip => Boolean(tooltip.dom_node_id) && !tooltip.entity_id)
  if (comments.length === 0) {
    return []
  }

  const bySection = new Map<string, Tooltip[]>()
  const other: Tooltip[] = []

  for (const tooltip of comments) {
    const sectionId = resolveSection(tooltip.dom_node_id!)
    if (!sectionId) {
      other.push(tooltip)
      continue
    }
    const sectionComments = bySection.get(sectionId) ?? []
    sectionComments.push(tooltip)
    bySection.set(sectionId, sectionComments)
  }

  const result = buildCommentGroups(toc, bySection)
  if (other.length > 0) {
    result.push({
      id: 'comment-group:other',
      kind: 'group',
      label: 'Other',
      count: other.length,
      children: sortTooltips(other).map(tooltip => toTooltipEntry(tooltip, 'comment')),
    })
  }
  return result
}

export function buildGlossaryTree(tooltips: Tooltip[]): ScholarTreeEntry[] {
  const glossary = tooltips.filter(tooltip => Boolean(tooltip.entity_id))
  if (glossary.length === 0) {
    return []
  }

  const manual: Tooltip[] = []
  const generated = new Map<string, Tooltip[]>()
  for (const tooltip of glossary) {
    const entityId = tooltip.entity_id!
    if (entityId.startsWith('manual_')) {
      manual.push(tooltip)
      continue
    }
    const entityType = entityId.match(/^([^_]+)_/)?.[1] ?? 'other'
    const group = generated.get(entityType) ?? []
    group.push(tooltip)
    generated.set(entityType, group)
  }

  const result: ScholarTreeEntry[] = []
  if (manual.length > 0) {
    result.push(toGlossaryGroup('manual', 'User-Created', manual))
  }
  for (const entityType of Array.from(generated.keys()).sort()) {
    const label = entityTypeLabels[entityType]
      ?? `${entityType.charAt(0).toUpperCase()}${entityType.slice(1)}`
    result.push(toGlossaryGroup(entityType, label, generated.get(entityType)!))
  }
  return result
}

function buildCommentGroups(
  toc: TOCNode[],
  bySection: Map<string, Tooltip[]>,
): ScholarTreeEntry[] {
  const groups: ScholarTreeEntry[] = []
  for (const section of toc) {
    const nestedGroups = buildCommentGroups(section.children, bySection)
    const directComments = sortTooltips(bySection.get(section.id) ?? [])
      .map(tooltip => toTooltipEntry(tooltip, 'comment'))
    const count = directComments.length
      + nestedGroups.reduce((total, child) => total + (child.count ?? 0), 0)
    if (count === 0) {
      continue
    }
    groups.push({
      id: `comment-group:${section.id}`,
      kind: 'group',
      label: plainText(section.title) || 'Untitled section',
      sourceId: section.id,
      count,
      children: [...nestedGroups, ...directComments],
    })
  }
  return groups
}

function toGlossaryGroup(type: string, label: string, tooltips: Tooltip[]): ScholarTreeEntry {
  return {
    id: `glossary-group:${type}`,
    kind: 'group',
    label,
    count: tooltips.length,
    children: sortTooltips(tooltips).map(tooltip => toTooltipEntry(tooltip, 'glossary')),
  }
}

function toTooltipEntry(
  tooltip: Tooltip,
  kind: Extract<ScholarTreeEntryKind, 'comment' | 'glossary'>,
): ScholarTreeEntry {
  const target = plainText(tooltip.target_text ?? '')
  const content = plainText(tooltip.content)
  const label = target || content
  const description = content && content !== label ? content : undefined
  return {
    id: `${kind}:${tooltip.id}`,
    kind,
    label: label || 'Untitled annotation',
    description,
    searchText: kind === 'comment' && description ? `${label} — ${description}` : undefined,
    sourceId: tooltip.dom_node_id ?? undefined,
    tooltipId: tooltip.id,
    entityId: tooltip.entity_id ?? undefined,
    pinned: tooltip.is_pinned,
    children: [],
  }
}

function sortTooltips(tooltips: Tooltip[]): Tooltip[] {
  return [...tooltips].sort((left, right) => {
    if (left.is_pinned !== right.is_pinned) {
      return left.is_pinned ? -1 : 1
    }
    const leftOrder = left.display_order ?? Number.MAX_SAFE_INTEGER
    const rightOrder = right.display_order ?? Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }
    const dateOrder = left.created_at.localeCompare(right.created_at)
    return dateOrder || left.id.localeCompare(right.id)
  })
}

function plainText(value: string): string {
  if (!value) {
    return ''
  }
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(value, 'text/html')
    return normalizeWhitespace(document.body.textContent ?? '')
  }
  return normalizeWhitespace(value.replace(/<[^>]*>/g, ' '))
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}