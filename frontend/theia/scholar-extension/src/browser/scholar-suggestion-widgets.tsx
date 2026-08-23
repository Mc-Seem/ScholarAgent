import * as React from 'react'
import {
  CommandService,
  Disposable,
  MessageService,
  type MenuPath,
} from '@theia/core'
import {
  CompositeTreeNode,
  ContextMenuRenderer,
  ExpandableTreeNode,
  type NodeProps,
  ReactWidget,
  SelectableTreeNode,
  TreeModel,
  TreeNode,
  TreeProps,
  TreeWidget,
} from '@theia/core/lib/browser'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'

import { LatexText } from '../../../../components/reader/LatexText'
import type { TooltipSuggestion } from '../../../../lib/reader-workspace-api'
import {
  ScholarSuggestionService,
  type SuggestionCheckState,
} from './scholar-suggestion-service'
import { ScholarCommands } from './scholar-commands'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const SCHOLAR_SUGGESTIONS_WIDGET_ID = 'scholar-agent:suggestions'
export const SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID = 'scholar-agent:suggestion-editor'
export const SCHOLAR_SUGGESTIONS_CONTEXT_MENU: MenuPath = [
  'scholar-agent-suggestions-context-menu',
]
const SCHOLAR_SUGGESTION_TARGET_KIND = 'scholar-agent:suggestion-target'

export interface ScholarSuggestionTarget {
  readonly kind: typeof SCHOLAR_SUGGESTION_TARGET_KIND
  readonly paperId: string
  readonly suggestionId: string
}

export function createScholarSuggestionTarget(
  paperId: string,
  suggestionId: string,
): ScholarSuggestionTarget {
  return {
    kind: SCHOLAR_SUGGESTION_TARGET_KIND,
    paperId,
    suggestionId,
  }
}

export function isScholarSuggestionTarget(value: unknown): value is ScholarSuggestionTarget {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<ScholarSuggestionTarget>
  return candidate.kind === SCHOLAR_SUGGESTION_TARGET_KIND
    && typeof candidate.paperId === 'string'
    && candidate.paperId.length > 0
    && typeof candidate.suggestionId === 'string'
    && candidate.suggestionId.length > 0
}

export type ScholarSuggestionNodeKind = 'source' | 'type' | 'suggestion'
export type ScholarSuggestionSource = 'manual' | 'ai'

export interface ScholarSuggestionTreeNode
  extends CompositeTreeNode, SelectableTreeNode, ExpandableTreeNode {
  readonly suggestionKind: ScholarSuggestionNodeKind
  readonly paperId: string
  readonly source: ScholarSuggestionSource
  readonly label: string
  readonly suggestionIds: readonly string[]
  readonly checkState: SuggestionCheckState
  readonly entityType?: string
  readonly suggestionId?: string
  readonly tooltipContent?: string
  readonly checkboxInfo: {
    checked: boolean
    tooltip: string
    accessibilityInformation: { label: string }
  }
  children: ScholarSuggestionTreeNode[]
  expanded: boolean
  selected: boolean
}

export function isScholarSuggestionTreeNode(value: unknown): value is ScholarSuggestionTreeNode {
  if (!CompositeTreeNode.is(value) || !SelectableTreeNode.is(value)) {
    return false
  }
  const candidate = value as Partial<ScholarSuggestionTreeNode>
  return (candidate.suggestionKind === 'source'
      || candidate.suggestionKind === 'type'
      || candidate.suggestionKind === 'suggestion')
    && typeof candidate.paperId === 'string'
    && (candidate.source === 'manual' || candidate.source === 'ai')
    && typeof candidate.label === 'string'
    && Array.isArray(candidate.suggestionIds)
}

@injectable()
export class ScholarSuggestionsTreeWidget extends TreeWidget {
  constructor(
    @inject(TreeProps) treeProps: TreeProps,
    @inject(TreeModel) model: TreeModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(ScholarSuggestionService) private readonly suggestions: ScholarSuggestionService,
  ) {
    super(treeProps, model, contextMenuRenderer)
    this.id = SCHOLAR_SUGGESTIONS_WIDGET_ID
    this.title.label = 'Highlights'
    this.title.caption = 'Term Highlights'
    this.title.iconClass = 'codicon codicon-lightbulb-sparkle'
  }

  @postConstruct()
  protected override init(): void {
    super.init()
    this.addClass('scholar-native-tree')
    this.addClass('scholar-suggestions-tree')
    this.toDispose.push(Disposable.create(this.store.subscribe(() => this.refreshTree())))
    this.toDispose.push(Disposable.create(this.suggestions.subscribe(() => this.refreshTree())))
    this.toDispose.push(this.model.onOpenNode(node => this.openSuggestionNode(node)))
    this.refreshTree()
  }

  protected refreshTree(): void {
    const expanded = new Map<string, boolean>()
    collectExpandedState(this.model.root, expanded)
    const root: CompositeTreeNode = {
      id: `${this.id}:root`,
      name: this.title.label,
      visible: false,
      parent: undefined,
      children: [],
    }
    const paperId = this.store.getSnapshot().activePaperId
    if (paperId) {
      const state = this.suggestions.getPaperState(paperId)
      root.children = this.buildSourceNodes(paperId, state.suggestions, root, expanded)
    }
    this.model.root = root
  }

  protected override renderCheckbox(node: TreeNode, _props: NodeProps): React.ReactNode {
    if (!isScholarSuggestionTreeNode(node)) {
      return undefined
    }
    return (
      <input
        ref={element => {
          if (element) {
            element.indeterminate = node.checkState === 'indeterminate'
          }
        }}
        data-node-id={node.id}
        type="checkbox"
        className="theia-input scholar-suggestion-checkbox"
        checked={node.checkState === 'checked'}
        readOnly
        aria-label={`Select ${node.label}`}
        aria-checked={node.checkState === 'indeterminate' ? 'mixed' : node.checkState === 'checked'}
        title={node.checkboxInfo.tooltip}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          this.toggleNodeCheck(node)
        }}
        onDoubleClick={event => event.stopPropagation()}
      />
    )
  }

  protected override getCaptionChildren(node: TreeNode, _props: NodeProps): React.ReactNode {
    if (!isScholarSuggestionTreeNode(node)) {
      return undefined
    }
    if (node.suggestionKind === 'suggestion') {
      return (
        <>
          <span className="scholar-suggestion-label"><LatexText text={node.label} /></span>
        </>
      )
    }
    return (
      <>
        <span>{node.label}</span>
        <span className="scholar-tree-count">{node.suggestionIds.length}</span>
      </>
    )
  }

  protected override toNodeName(node: TreeNode): string {
    return isScholarSuggestionTreeNode(node) ? node.label : super.toNodeName(node)
  }

  protected override renderIcon(node: TreeNode): React.ReactNode {
    if (!isScholarSuggestionTreeNode(node)) {
      return undefined
    }
    const icon = node.suggestionKind === 'suggestion'
      ? 'comment-discussion'
      : node.suggestionKind === 'type'
        ? 'symbol-key'
        : node.source === 'ai'
          ? 'sparkle'
          : 'person'
    return <div className={`scholar-tree-icon codicon codicon-${icon}`} />
  }

  protected override isExpandable(node: TreeNode): node is ExpandableTreeNode {
    return isScholarSuggestionTreeNode(node) && node.children.length > 0
  }

  protected override tapNode(node?: TreeNode): void {
    super.tapNode(node)
    if (isScholarSuggestionTreeNode(node) && node.suggestionId) {
      this.suggestions.focusSuggestion(node.paperId, node.suggestionId)
    }
  }

  protected override handleSpace(event: KeyboardEvent): void {
    const node = this.focusService.focusedNode
    if (isScholarSuggestionTreeNode(node)) {
      event.preventDefault()
      event.stopPropagation()
      this.toggleNodeCheck(node)
      return
    }
    super.handleSpace(event)
  }

  protected openSuggestionNode(node?: TreeNode): void {
    if (isScholarSuggestionTreeNode(node) && node.suggestionId) {
      this.suggestions.focusSuggestion(node.paperId, node.suggestionId)
    }
  }

  protected override toContextMenuArgs(node: SelectableTreeNode): unknown[] {
    return [node]
  }

  protected override renderTree(model: TreeModel): React.ReactNode {
    const paperId = this.store.getSnapshot().activePaperId
    if (!paperId) {
      return this.renderMessage('Open a paper to see term highlights.')
    }
    const state = this.suggestions.getPaperState(paperId)
    if (CompositeTreeNode.is(model.root) && model.root.children.length === 0) {
      if (state.loading) {
        return this.renderMessage('Loading term highlights…')
      }
      if (state.error) {
        return this.renderMessage(`Unable to load term highlights: ${state.error}`, true)
      }
      return this.renderMessage('No term highlights for the active paper.')
    }
    return (
      <>
        {state.loading && this.renderMessage('Refreshing term highlights…')}
        {state.error && this.renderMessage(state.error, true)}
        {super.renderTree(model)}
      </>
    )
  }

  private renderMessage(message: string, error = false): React.ReactNode {
    return (
      <div
        className={`theia-widget-noInfo scholar-tree-empty${error ? ' scholar-tree-error' : ''}`}
        role={error ? 'alert' : undefined}
      >
        {message}
      </div>
    )
  }

  private toggleNodeCheck(node: ScholarSuggestionTreeNode): void {
    this.suggestions.toggleSuggestions(node.paperId, node.suggestionIds)
  }

  private buildSourceNodes(
    paperId: string,
    allSuggestions: readonly TooltipSuggestion[],
    parent: CompositeTreeNode,
    expanded: ReadonlyMap<string, boolean>,
  ): ScholarSuggestionTreeNode[] {
    const sources: Array<{ source: ScholarSuggestionSource, label: string }> = [
      { source: 'manual', label: 'Manual' },
      { source: 'ai', label: 'AI' },
    ]
    return sources.flatMap(({ source, label }) => {
      const sourceSuggestions = allSuggestions.filter(suggestion => (
        source === 'ai' ? suggestion.is_ai_generated : !suggestion.is_ai_generated
      ))
      if (sourceSuggestions.length === 0) {
        return []
      }
      const id = `suggestion-source:${source}`
      const node = this.createNode({
        id,
        paperId,
        source,
        label,
        suggestionIds: sourceSuggestions.map(suggestion => suggestion.id),
        parent,
        expanded: expanded.get(id) ?? true,
      })
      node.children = this.buildTypeNodes(paperId, source, sourceSuggestions, node, expanded)
      return [node]
    })
  }

  private buildTypeNodes(
    paperId: string,
    source: ScholarSuggestionSource,
    sourceSuggestions: readonly TooltipSuggestion[],
    parent: ScholarSuggestionTreeNode,
    expanded: ReadonlyMap<string, boolean>,
  ): ScholarSuggestionTreeNode[] {
    const byType = new Map<string, TooltipSuggestion[]>()
    sourceSuggestions.forEach(suggestion => {
      const type = suggestion.entity_type || 'other'
      const entries = byType.get(type) ?? []
      entries.push(suggestion)
      byType.set(type, entries)
    })
    return [...byType.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entityType, typeSuggestions]) => {
        const id = `suggestion-type:${source}:${encodeURIComponent(entityType)}`
        const node = this.createNode({
          id,
          paperId,
          source,
          label: entityType,
          entityType,
          suggestionIds: typeSuggestions.map(suggestion => suggestion.id),
          parent,
          expanded: expanded.get(id) ?? true,
        })
        node.children = typeSuggestions.map(suggestion => this.createNode({
          id: `suggestion:${suggestion.id}`,
          paperId,
          source,
          label: suggestion.entity_label,
          entityType: suggestion.entity_type,
          suggestionId: suggestion.id,
          suggestionIds: [suggestion.id],
          tooltipContent: suggestion.tooltip_content,
          parent: node,
          expanded: false,
        }))
        return node
      })
  }

  private createNode(options: {
    id: string
    paperId: string
    source: ScholarSuggestionSource
    label: string
    suggestionIds: readonly string[]
    parent: CompositeTreeNode
    expanded: boolean
    entityType?: string
    suggestionId?: string
    tooltipContent?: string
  }): ScholarSuggestionTreeNode {
    const checkState = this.suggestions.getCheckState(options.paperId, options.suggestionIds)
    const suggestionKind: ScholarSuggestionNodeKind = options.suggestionId
      ? 'suggestion'
      : options.entityType
        ? 'type'
        : 'source'
    const searchableName = options.suggestionId
      ? [options.label, options.entityType, options.tooltipContent].filter(Boolean).join(' ')
      : options.label
    return {
      id: options.id,
      name: searchableName,
      description: options.tooltipContent,
      parent: options.parent,
      children: [],
      expanded: options.expanded,
      selected: Boolean(
        options.suggestionId
        && this.suggestions.getPaperState(options.paperId).focusedId === options.suggestionId
      ),
      suggestionKind,
      paperId: options.paperId,
      source: options.source,
      label: options.label,
      entityType: options.entityType,
      suggestionId: options.suggestionId,
      suggestionIds: [...options.suggestionIds],
      tooltipContent: options.tooltipContent,
      checkState,
      checkboxInfo: {
        checked: checkState === 'checked',
        tooltip: `Select ${options.label}`,
        accessibilityInformation: { label: `Select ${options.label}` },
      },
    }
  }
}

@injectable()
export class ScholarSuggestionEditorWidget extends ReactWidget {
  constructor(
    @inject(ScholarSuggestionService) private readonly suggestions: ScholarSuggestionService,
    @inject(MessageService) private readonly messageService: MessageService,
    @inject(CommandService) private readonly commandService: CommandService,
  ) {
    super()
    this.id = SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID
    this.title.label = 'Highlight Details'
    this.title.caption = 'Term Highlight Details and Editor'
    this.title.iconClass = 'codicon codicon-lightbulb'
    this.node.classList.add('scholar-widget', 'scholar-native-editor', 'scholar-suggestion-editor')
    this.toDispose.push(this.suggestions.onDidChange(() => this.update()))
    this.update()
  }

  protected override render(): React.ReactNode {
    return (
      <ScholarSuggestionEditorContent
        suggestions={this.suggestions}
        messageService={this.messageService}
        commandService={this.commandService}
      />
    )
  }
}

export function ScholarSuggestionEditorContent({
  suggestions,
  messageService,
  commandService,
}: {
  suggestions: ScholarSuggestionService
  messageService: MessageService
  commandService: CommandService
}): React.ReactElement {
  const snapshot = React.useSyncExternalStore(
    suggestions.subscribe,
    suggestions.getSnapshot,
    suggestions.getSnapshot,
  )
  const paperId = snapshot.activePaperId
  if (!paperId) {
    return <div className="scholar-empty">Open a paper to inspect term highlights.</div>
  }

  const state = suggestions.getPaperState(paperId)
  if (state.createMode) {
    return (
      <ScholarManualSuggestionForm
        paperId={paperId}
        suggestions={suggestions}
        messageService={messageService}
      />
    )
  }

  const focused = state.focusedId
    ? state.suggestions.find(suggestion => suggestion.id === state.focusedId)
    : undefined
  if (!focused) {
    return (
      <div className="scholar-empty scholar-suggestion-editor-empty">
        <span>Select a term highlight to inspect or edit it.</span>
        <button
          type="button"
          className="theia-button secondary"
          disabled={state.pending}
          onClick={() => suggestions.startManualCreation(paperId)}
        >
          <span className="codicon codicon-add" aria-hidden="true" />
          Create Manual Term Highlight
        </button>
      </div>
    )
  }

  const content = state.editedContent.has(focused.id)
    ? state.editedContent.get(focused.id) ?? ''
    : focused.tooltip_content
  const executeDelete = (): void => {
    void commandService.executeCommand(
      ScholarCommands.DELETE_SUGGESTION.id,
      createScholarSuggestionTarget(paperId, focused.id),
    ).catch(reason => {
      void messageService.error(`Could not delete term highlight: ${errorMessage(reason)}`)
    })
  }

  return (
    <article className="scholar-suggestion-detail">
      <header className="scholar-annotation-detail-header scholar-suggestion-detail-header">
        <strong><LatexText text={focused.entity_label} /></strong>
        <span className="scholar-suggestion-type">{focused.entity_type}</span>
        <span className="scholar-suggestion-source">
          {focused.is_ai_generated ? 'AI' : 'Manual'}
        </span>
      </header>
      <section className="scholar-suggestion-preview" aria-label="Term highlight preview">
        <LatexText text={content} />
      </section>
      <label className="scholar-native-field">
        <span>Term highlight content</span>
        <textarea
          className="theia-input scholar-native-textarea"
          aria-label="Term highlight content"
          value={content}
          disabled={state.pending}
          onChange={event => suggestions.editSuggestion(paperId, focused.id, event.target.value)}
        />
      </label>
      {state.editedContent.has(focused.id) && (
        <span className="scholar-suggestion-modified">Modified locally; Apply to save.</span>
      )}
      <div className="scholar-native-editor-actions scholar-suggestion-detail-actions">
        <button
          type="button"
          className="theia-button secondary scholar-annotation-delete"
          aria-label="Delete Term Highlight"
          disabled={state.pending}
          onClick={executeDelete}
        >
          <span className="codicon codicon-trash" aria-hidden="true" />
          Delete Term Highlight
        </button>
      </div>
    </article>
  )
}

function ScholarManualSuggestionForm({
  paperId,
  suggestions,
  messageService,
}: {
  paperId: string
  suggestions: ScholarSuggestionService
  messageService: MessageService
}): React.ReactElement {
  const state = suggestions.getPaperState(paperId)
  const draft = state.createDraft
  const valid = Boolean(
    draft.entityLabel.trim()
    && draft.entityType.trim()
    && draft.tooltipContent.trim(),
  )
  const create = (): void => {
    void suggestions.createManualSuggestion(paperId).catch(reason => {
      void messageService.error(`Could not create term highlight: ${errorMessage(reason)}`)
    })
  }

  return (
    <form
      className="scholar-native-editor-form scholar-suggestion-create"
      onSubmit={event => {
        event.preventDefault()
        if (valid && !state.pending) {
          create()
        }
      }}
    >
      <h3>Create Manual Term Highlight</h3>
      <label className="scholar-native-field">
        <span>Entity label</span>
        <input
          className="theia-input"
          aria-label="Entity label"
          value={draft.entityLabel}
          disabled={state.pending}
          onChange={event => suggestions.updateCreateDraft(paperId, {
            entityLabel: event.target.value,
          })}
        />
      </label>
      {draft.entityLabel.trim() && (
        <div className="scholar-suggestion-label-preview">
          <span>Label preview</span>
          <LatexText text={draft.entityLabel.trim()} />
        </div>
      )}
      <label className="scholar-native-field">
        <span>Entity type</span>
        <select
          className="theia-input"
          aria-label="Entity type"
          value={draft.entityType}
          disabled={state.pending}
          onChange={event => suggestions.updateCreateDraft(paperId, {
            entityType: event.target.value,
          })}
        >
          <option value="definition">Definition</option>
          <option value="formula">Formula</option>
          <option value="symbol">Symbol</option>
          <option value="theorem">Theorem</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="scholar-native-field">
        <span>Term highlight content</span>
        <textarea
          className="theia-input scholar-native-textarea"
          aria-label="Term highlight content"
          value={draft.tooltipContent}
          disabled={state.pending}
          onChange={event => suggestions.updateCreateDraft(paperId, {
            tooltipContent: event.target.value,
          })}
        />
      </label>
      <div className="scholar-native-editor-actions">
        <button
          type="button"
          className="theia-button secondary"
          disabled={state.pending}
          onClick={() => suggestions.cancelManualCreation(paperId)}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="theia-button main"
          disabled={!valid || state.pending}
        >
          Create Term Highlight
        </button>
      </div>
    </form>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function collectExpandedState(node: TreeNode | undefined, result: Map<string, boolean>): void {
  if (!node) {
    return
  }
  if (ExpandableTreeNode.is(node)) {
    result.set(node.id, node.expanded)
  }
  if (CompositeTreeNode.is(node)) {
    node.children.forEach(child => collectExpandedState(child, result))
  }
}