import { sharedTermPalette } from '../../../../lib/design-system'
import type { EntityAlignment, ReadingSet } from '../../../../lib/reading-set-api'
import type { ScholarReadingSetService } from './scholar-reading-set-service'

/** One aligned subject inside a shared-term group. */
export interface SharedTermGroupMember {
  paperId: string
  subjectId: string
}

export type SharedTermToggleOutcome =
  | { kind: 'cleared' }
  | { kind: 'no-set' }
  | { kind: 'no-terms'; readingSetName: string }
  | { kind: 'highlighted'; readingSetName: string; groupCount: number; paperCount: number }

/** Only these alignments belong on a reading surface. */
function isReadableAlignment(alignment: EntityAlignment): boolean {
  return alignment.status === 'auto' || alignment.status === 'confirmed'
}

function memberKey(paperId: string, subjectId: string): string {
  return `${paperId}::${subjectId}`
}

/**
 * Groups aligned subjects into shared-term groups with a union-find over the
 * visible alignment pairs, so "policy improvement" in A, "policy iteration
 * step" in B and their common name in C all land in one group even without a
 * direct A-C record. Groups keep the first-seen order of their members, which
 * makes the color assignment below deterministic for a given alignment list.
 */
export function buildSharedTermGroups(
  alignments: readonly EntityAlignment[],
): SharedTermGroupMember[][] {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    let root = key
    while (parent.get(root) !== root) {
      root = parent.get(root)!
    }
    let current = key
    while (current !== root) {
      const next = parent.get(current)!
      parent.set(current, root)
      current = next
    }
    return root
  }
  const members = new Map<string, SharedTermGroupMember>()
  const order: string[] = []
  const register = (member: SharedTermGroupMember): string => {
    const key = memberKey(member.paperId, member.subjectId)
    if (!parent.has(key)) {
      parent.set(key, key)
      members.set(key, member)
      order.push(key)
    }
    return key
  }

  for (const alignment of alignments) {
    if (!isReadableAlignment(alignment)) {
      continue
    }
    const keyA = register({ paperId: alignment.paper_a_id, subjectId: alignment.subject_a_id })
    const keyB = register({ paperId: alignment.paper_b_id, subjectId: alignment.subject_b_id })
    parent.set(find(keyB), find(keyA))
  }

  const groupsByRoot = new Map<string, SharedTermGroupMember[]>()
  const groups: SharedTermGroupMember[][] = []
  for (const key of order) {
    const root = find(key)
    let group = groupsByRoot.get(root)
    if (!group) {
      group = []
      groupsByRoot.set(root, group)
      groups.push(group)
    }
    group.push(members.get(key)!)
  }
  return groups
}

/**
 * Assigns one design-system color per group and returns it per member key.
 * The palette cycles when a set links more groups than there are colors.
 */
export function sharedTermColorsByKey(
  groups: readonly SharedTermGroupMember[][],
  palette: readonly string[] = sharedTermPalette,
): Map<string, string> {
  const colors = new Map<string, string>()
  groups.forEach((group, index) => {
    const color = palette[index % palette.length]
    for (const member of group) {
      colors.set(memberKey(member.paperId, member.subjectId), color)
    }
  })
  return colors
}

/**
 * Paints every `.kg-entity` occurrence of a colored subject in the open paper
 * widgets and returns the cleanup that removes exactly what was painted.
 */
export function applySharedTermHighlights(
  colorsByMemberKey: ReadonlyMap<string, string>,
): () => void {
  const painted: HTMLElement[] = []
  for (const root of Array.from(document.querySelectorAll<HTMLElement>('[data-scholar-paper-id]'))) {
    const paperId = root.dataset.scholarPaperId
    if (!paperId) {
      continue
    }
    for (const span of Array.from(root.querySelectorAll<HTMLElement>('.kg-entity'))) {
      const subjectId = span.dataset.subjectId
      if (!subjectId) {
        continue
      }
      const color = colorsByMemberKey.get(memberKey(paperId, subjectId))
      if (!color) {
        continue
      }
      span.classList.add('scholar-shared-term')
      span.style.setProperty('--scholar-shared-term-color', color)
      painted.push(span)
    }
  }
  return () => {
    for (const span of painted) {
      span.classList.remove('scholar-shared-term')
      span.style.removeProperty('--scholar-shared-term-color')
    }
  }
}

/**
 * The toggle behind "Highlight Shared Terms": one invocation paints the
 * aligned terms of the open papers of one reading set, the next removes the
 * paint again regardless of what changed in between. Data comes from the
 * reading-set service cache so a repeated toggle costs no extra requests.
 */
export class SharedTermHighlighter {
  private cleanup: (() => void) | undefined

  isActive(): boolean {
    return Boolean(this.cleanup)
  }

  clear(): void {
    this.cleanup?.()
    this.cleanup = undefined
  }

  /**
   * The reading set whose terms would be highlighted: the first set with at
   * least two open member papers, preferring one that contains the active
   * paper (the first id of `openPaperIds`).
   */
  static candidateSet(
    readingSets: readonly ReadingSet[],
    openPaperIds: readonly string[],
  ): ReadingSet | undefined {
    const open = new Set(openPaperIds)
    const candidates = readingSets.filter(
      set => set.papers.filter(paper => open.has(paper.id)).length >= 2,
    )
    if (candidates.length === 0) {
      return undefined
    }
    const activePaperId = openPaperIds[0]
    return candidates.find(set => set.papers.some(paper => paper.id === activePaperId))
      ?? candidates[0]
  }

  async toggle(
    readingSets: ScholarReadingSetService,
    openPaperIds: readonly string[],
  ): Promise<SharedTermToggleOutcome> {
    if (this.cleanup) {
      this.clear()
      return { kind: 'cleared' }
    }
    await readingSets.initialize()
    const set = SharedTermHighlighter.candidateSet(
      readingSets.getSnapshot().readingSets,
      openPaperIds,
    )
    if (!set) {
      return { kind: 'no-set' }
    }
    const alignments = readingSets.alignmentsOf(set.id) ?? await readingSets.loadAlignments(set.id)
    const open = new Set(openPaperIds)
    // A group only earns a color when it is visible in at least two of the
    // open panes; a term whose counterpart lives in a closed paper would
    // otherwise wear a color with nothing to match it against.
    const groups = buildSharedTermGroups(alignments)
      .map(group => group.filter(member => open.has(member.paperId)))
      .filter(group => new Set(group.map(member => member.paperId)).size >= 2)
    if (groups.length === 0) {
      return { kind: 'no-terms', readingSetName: set.name }
    }
    this.cleanup = applySharedTermHighlights(sharedTermColorsByKey(groups))
    return {
      kind: 'highlighted',
      readingSetName: set.name,
      groupCount: groups.length,
      paperCount: new Set(groups.flat().map(member => member.paperId)).size,
    }
  }
}
