import { describe, expect, it } from 'vitest'

import { ScholarCommands } from '@/theia/scholar-extension/src/browser/scholar-commands'

describe('ScholarCommands (active paper actions)', () => {
  it('exposes Compile, Build Graph, Delete and Open Graph as distinct Theia commands', () => {
    const ids = [
      ScholarCommands.COMPILE_PAPER.id,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH.id,
      ScholarCommands.DELETE_PAPER.id,
      ScholarCommands.OPEN_GRAPH.id,
    ]

    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach(id => expect(id.startsWith('scholar-agent.')).toBe(true))
  })

  it('provides a Codicon icon class for every active-paper command', () => {
    for (const command of [
      ScholarCommands.COMPILE_PAPER,
      ScholarCommands.BUILD_KNOWLEDGE_GRAPH,
      ScholarCommands.DELETE_PAPER,
      ScholarCommands.OPEN_GRAPH,
    ]) {
      expect(command.iconClass).toMatch(/^codicon codicon-[a-z-]+$/)
    }
  })

  it('labels each command for command palette and toolbar tooltips', () => {
    expect(ScholarCommands.COMPILE_PAPER.label).toBe('Recompile Paper')
    expect(ScholarCommands.BUILD_KNOWLEDGE_GRAPH.label).toBe('Build Knowledge Graph')
    expect(ScholarCommands.DELETE_PAPER.label).toBe('Delete Paper')
    expect(ScholarCommands.OPEN_GRAPH.label).toBe('Open Knowledge Graph')
  })
})
