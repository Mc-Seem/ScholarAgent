import type { Section } from '../hooks/usePapers'
import { parseTOC, type TOCNode } from './parseTOC'

export function buildTOCFromSections(sections: Section[]): TOCNode[] {
  const nodeMap = new Map<string, TOCNode>()
  const root: TOCNode[] = []

  for (const section of sections) {
    nodeMap.set(section.id, {
      id: section.id,
      title: section.title_html,
      level: section.level,
      children: [],
    })
  }

  for (const section of sections) {
    const node = nodeMap.get(section.id)!
    const parent = section.parent_id ? nodeMap.get(section.parent_id) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      root.push(node)
    }
  }

  return root
}

export function getPaperTOC(
  sections: Section[] | null | undefined,
  htmlContent: string | null,
): TOCNode[] {
  if (sections?.length) {
    return buildTOCFromSections(sections)
  }
  return htmlContent ? parseTOC(htmlContent) : []
}