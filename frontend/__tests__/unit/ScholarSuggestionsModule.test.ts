import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readModuleSource(): string {
  return fs.readFileSync(path.resolve(
    process.cwd(),
    'theia/scholar-extension/src/browser/scholar-frontend-module.ts',
  ), 'utf-8')
}

function readContributionSource(): string {
  return fs.readFileSync(path.resolve(
    process.cwd(),
    'theia/scholar-extension/src/browser/scholar-contribution.ts',
  ), 'utf-8')
}

function readCommandsSource(): string {
  return fs.readFileSync(path.resolve(
    process.cwd(),
    'theia/scholar-extension/src/browser/scholar-commands.ts',
  ), 'utf-8')
}

describe('native Suggestions module wiring', () => {
  it('binds one suggestion service and a searchable native tree factory', () => {
    const source = readModuleSource()

    expect(source).toContain('bind(ScholarSuggestionService).toSelf().inSingletonScope()')
    expect(source).toContain('id: SCHOLAR_SUGGESTIONS_WIDGET_ID')
    expect(source).toContain('contextMenuPath: SCHOLAR_SUGGESTIONS_CONTEXT_MENU')
    expect(source).toMatch(/SCHOLAR_SUGGESTIONS_WIDGET_ID[\s\S]*search: true[\s\S]*widget: ScholarSuggestionsTreeWidget/)
  })

  it('keeps applied annotations separate from a dedicated Tooltip Drafts container', () => {
    const source = readModuleSource()
    const annotationsStart = source.indexOf('id: SCHOLAR_ANNOTATIONS_WIDGET_ID')
    const draftsStart = source.indexOf('id: SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID')
    const paperStart = source.indexOf('id: SCHOLAR_PAPER_FACTORY_ID')

    expect(annotationsStart).toBeGreaterThan(-1)
    expect(draftsStart).toBeGreaterThan(annotationsStart)
    expect(paperStart).toBeGreaterThan(draftsStart)

    const annotationsFactory = source.slice(annotationsStart, draftsStart)
    const draftsFactory = source.slice(draftsStart, paperStart)
    expect(annotationsFactory).toContain("label: 'Annotations'")
    expect(annotationsFactory).toContain('getOrCreateWidget(SCHOLAR_COMMENTS_WIDGET_ID)')
    expect(annotationsFactory).toContain('getOrCreateWidget(SCHOLAR_GLOSSARY_WIDGET_ID)')
    expect(annotationsFactory).toContain('getOrCreateWidget(SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID)')
    expect(annotationsFactory).not.toContain('SCHOLAR_SUGGESTIONS_WIDGET_ID')
    expect(annotationsFactory).not.toContain('SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID')

    expect(draftsFactory).toContain("label: 'Tooltip Drafts'")
    expect(draftsFactory).toContain('getOrCreateWidget(SCHOLAR_SUGGESTIONS_WIDGET_ID)')
    expect(draftsFactory).toContain('getOrCreateWidget(SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID)')
  })

  it('opens the drafts tree by default and keeps its details part restorable', () => {
    const source = readModuleSource()

    expect(source).toContain('bind(ScholarSuggestionEditorWidget).toSelf().inSingletonScope()')
    expect(source).toContain('id: SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID')
    expect(source).toMatch(
      /getOrCreateWidget\(SCHOLAR_SUGGESTIONS_WIDGET_ID\)[\s\S]*getOrCreateWidget\(SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID\)/,
    )
    expect(source).toContain('addWidget(suggestions, { order: 10, weight: 0.65 })')
    expect(source).toMatch(
      /addWidget\(suggestionEditor, \{[\s\S]*order: 20,[\s\S]*initiallyCollapsed: true/,
    )
  })

  it('places Tooltip Drafts beside Annotations and reveals details in the new container', () => {
    const source = readContributionSource()

    expect(source).toMatch(
      /getOrCreateWidget\(SCHOLAR_ANNOTATIONS_WIDGET_ID\)[\s\S]*getOrCreateWidget\(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID\)/,
    )
    expect(source).toMatch(
      /addWidget\(tooltipDrafts, \{[\s\S]*area: 'right',[\s\S]*mode: 'tab-after',[\s\S]*ref: annotations/,
    )
    expect(source).toMatch(
      /showSuggestionEditor\(activate: boolean\)[\s\S]*getOrCreateWidget\(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID\)/,
    )
  })

  it('can reopen Tooltip Drafts from the standard Views menu', () => {
    const commands = readCommandsSource()
    const contribution = readContributionSource()

    expect(commands).toContain('SHOW_TOOLTIP_DRAFTS')
    expect(commands).toContain("id: 'scholar-agent.show-tooltip-drafts'")
    expect(contribution).toMatch(
      /registerCommand\(ScholarCommands\.SHOW_TOOLTIP_DRAFTS[\s\S]*showView\(SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID, 'right'\)/,
    )
    expect(contribution).toMatch(
      /registerMenuAction\(CommonMenus\.VIEW_VIEWS, \{[\s\S]*ScholarCommands\.SHOW_TOOLTIP_DRAFTS\.id/,
    )
  })
})