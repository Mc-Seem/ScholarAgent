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

describe('ScholarCommands (library actions)', () => {
  it('exposes Refresh Library, Upload LaTeX, Import arXiv, Open and Open to the Side as distinct commands', () => {
    const ids = [
      ScholarCommands.REFRESH_LIBRARY.id,
      ScholarCommands.UPLOAD_LATEX.id,
      ScholarCommands.IMPORT_ARXIV.id,
      ScholarCommands.OPEN_PAPER.id,
      ScholarCommands.OPEN_PAPER_TO_SIDE.id,
    ]

    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach(id => expect(id.startsWith('scholar-agent.')).toBe(true))
  })

  it('provides a Codicon icon class for every library command', () => {
    for (const command of [
      ScholarCommands.REFRESH_LIBRARY,
      ScholarCommands.UPLOAD_LATEX,
      ScholarCommands.IMPORT_ARXIV,
      ScholarCommands.OPEN_PAPER,
      ScholarCommands.OPEN_PAPER_TO_SIDE,
    ]) {
      expect(command.iconClass).toMatch(/^codicon codicon-[a-z-]+$/)
    }
  })

  it('labels the Open and Open to the Side commands for the library context menu', () => {
    expect(ScholarCommands.OPEN_PAPER.label).toBe('Open')
    expect(ScholarCommands.OPEN_PAPER_TO_SIDE.label).toBe('Open to the Side')
  })
})
