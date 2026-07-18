import * as React from 'react'
import { CommandService, Disposable, MessageService, type MenuPath } from '@theia/core'
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
import type { Tooltip } from '../../../../hooks/useTooltips'
import {
  buildCommentTree,
  buildGlossaryTree,
  buildOutlineTree,
  mapHtmlNodesToSections,
  type ScholarTreeEntry,
} from '../../../../lib/scholar-native-tree'
import { getPaperTOC } from '../../../../utils/paperTOC'
import { navigateToPaperElement, useScholarSnapshot } from './scholar-react'
import {
  ScholarAnnotationService,
  type ScholarAnnotationDraft,
  type ScholarAnnotationSelection,
  type ScholarAnnotationTarget,
} from './scholar-annotation-service'
import { ScholarAnnotationPreview } from './scholar-annotation-preview'
import { ScholarCommands } from './scholar-commands'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const SCHOLAR_OUTLINE_WIDGET_ID = 'scholar-agent:outline'
export const SCHOLAR_COMMENTS_WIDGET_ID = 'scholar-agent:comments'
export const SCHOLAR_GLOSSARY_WIDGET_ID = 'scholar-agent:glossary'
export const SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID = 'scholar-agent:annotation-editor'
export const SCHOLAR_TREE_CONTEXT_MENU: MenuPath = ['scholar-agent-tree-context-menu']

export interface ScholarTreeNode extends CompositeTreeNode, SelectableTreeNode, ExpandableTreeNode {
  entry: ScholarTreeEntry
}

export function isScholarTreeNode(value: unknown): value is ScholarTreeNode {
  return TreeNode.is(value) && 'entry' in value
}

abstract class ScholarTreeWidget extends TreeWidget {
  protected abstract readonly emptyMessage: string

  protected constructor(
    treeProps: TreeProps,
    model: TreeModel,
    contextMenuRenderer: ContextMenuRenderer,
    protected readonly store: ScholarWorkspaceService,
  ) {
    super(treeProps, model, contextMenuRenderer)
  }

  @postConstruct()
  protected override init(): void {
    super.init()
    this.addClass('scholar-native-tree')
    this.toDispose.push(Disposable.create(this.store.subscribe(() => this.refreshTree())))
    this.refreshTree()
  }

  protected abstract getEntries(): ScholarTreeEntry[]

  protected refreshTree(): void {
    const state = new Map<string, { expanded: boolean; selected: boolean }>()
    collectTreeState(this.model.root, state)
    const root: CompositeTreeNode = {
      id: `${this.id}:root`,
      name: this.title.label,
      visible: false,
      parent: undefined,
      children: [],
    }
    root.children = this.getEntries().map(entry => toTreeNode(entry, root, state, 0))
    this.model.root = root
  }

  protected override renderIcon(node: TreeNode): React.ReactNode {
    if (!isScholarTreeNode(node)) {
      return undefined
    }
    const icon = entryIcon(node.entry)
    return icon
      ? <div className={`scholar-tree-icon codicon codicon-${icon}`} />
      : undefined
  }

  protected override getCaptionChildren(node: TreeNode, props: NodeProps): React.ReactNode {
    if (!isScholarTreeNode(node)) {
      return super.getCaptionChildren(node, props)
    }
    const entry = node.entry
    const content = entry.kind === 'comment' && !this.searchHighlights?.has(node.id)
      ? <ScholarAnnotationPreview targetText={entry.label} annotation={entry.description} />
      : <LatexText text={entry.label} />

    return (
      <>
        {content}
        {entry.pinned && <span className="scholar-tree-pin codicon codicon-pinned" />}
        {entry.count !== undefined && (
          <span className="scholar-tree-count">{entry.count}</span>
        )}
      </>
    )
  }

  protected override createNodeAttributes(
    node: TreeNode,
    props: NodeProps,
  ): React.Attributes & React.HTMLAttributes<HTMLElement> {
    const attributes = super.createNodeAttributes(node, props)
    return isScholarTreeNode(node)
      ? {
          ...attributes,
          title: node.entry.description
            ? `${node.entry.label} — ${node.entry.description}`
            : node.entry.label,
        }
      : attributes
  }

  protected override isExpandable(node: TreeNode): node is ExpandableTreeNode {
    return isScholarTreeNode(node) && node.children.length > 0
  }

  protected override tapNode(node?: TreeNode): void {
    super.tapNode(node)
    if (isScholarTreeNode(node)) {
      this.activateEntry(node.entry)
    }
  }

  protected activateEntry(entry: ScholarTreeEntry): void {
    const paperId = this.store.getSnapshot().activePaperId
    if (paperId && entry.sourceId) {
      navigateToPaperElement(paperId, entry.sourceId)
    }
  }

  protected override toContextMenuArgs(node: SelectableTreeNode): unknown[] {
    return [node]
  }

  protected override renderTree(model: TreeModel): React.ReactNode {
    if (CompositeTreeNode.is(model.root) && model.root.children.length === 0) {
      return <div className="theia-widget-noInfo scholar-tree-empty">{this.emptyMessage}</div>
    }
    return super.renderTree(model)
  }
}

@injectable()
export class ScholarOutlineWidget extends ScholarTreeWidget {
  protected readonly emptyMessage = 'Open a paper to see its sections.'

  constructor(
    @inject(TreeProps) treeProps: TreeProps,
    @inject(TreeModel) model: TreeModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(ScholarWorkspaceService) store: ScholarWorkspaceService,
  ) {
    super(treeProps, model, contextMenuRenderer, store)
    this.id = SCHOLAR_OUTLINE_WIDGET_ID
    this.title.label = 'Sections'
    this.title.caption = 'Paper Sections'
    this.title.iconClass = 'codicon codicon-list-tree'
  }

  protected getEntries(): ScholarTreeEntry[] {
    const snapshot = this.store.getSnapshot()
    const paper = snapshot.activePaperId
      ? snapshot.papersById[snapshot.activePaperId]
      : undefined
    return paper
      ? buildOutlineTree(getPaperTOC(paper.sections, paper.html_content), paper.paper_metadata?.title)
      : []
  }
}

@injectable()
export class ScholarCommentsWidget extends ScholarTreeWidget {
  protected readonly emptyMessage = 'No comments for the active paper.'

  constructor(
    @inject(TreeProps) treeProps: TreeProps,
    @inject(TreeModel) model: TreeModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(ScholarWorkspaceService) store: ScholarWorkspaceService,
    @inject(ScholarAnnotationService) private readonly annotations: ScholarAnnotationService,
  ) {
    super(treeProps, model, contextMenuRenderer, store)
    this.id = SCHOLAR_COMMENTS_WIDGET_ID
    this.title.label = 'Comments'
    this.title.caption = 'Comments by Section'
    this.title.iconClass = 'codicon codicon-comment-discussion'
  }

  protected getEntries(): ScholarTreeEntry[] {
    const snapshot = this.store.getSnapshot()
    const paperId = snapshot.activePaperId
    const paper = paperId ? snapshot.papersById[paperId] : undefined
    if (!paper || !paperId) {
      return []
    }
    const toc = getPaperTOC(paper.sections, paper.html_content)
    const sectionByNode = mapHtmlNodesToSections(paper.html_content, toc)
    return buildCommentTree(
      snapshot.tooltipsByPaperId[paperId] ?? [],
      toc,
      nodeId => sectionByNode.get(nodeId),
      paper.paper_metadata?.title,
    )
  }

  protected override activateEntry(entry: ScholarTreeEntry): void {
    const paperId = this.store.getSnapshot().activePaperId
    if (paperId && entry.tooltipId) {
      this.annotations.select(paperId, entry.tooltipId)
      return
    }
    super.activateEntry(entry)
  }

  protected override handleDblClickEvent(node: TreeNode, event: React.MouseEvent<HTMLElement>): void {
    if (isScholarTreeNode(node) && node.entry.tooltipId && node.entry.sourceId) {
      const paperId = this.store.getSnapshot().activePaperId
      if (paperId) {
        this.annotations.select(paperId, node.entry.tooltipId)
        navigateToPaperElement(paperId, node.entry.sourceId)
      }
      event.stopPropagation()
      return
    }
    super.handleDblClickEvent(node, event)
  }
}

@injectable()
export class ScholarGlossaryWidget extends ScholarTreeWidget {
  protected readonly emptyMessage = 'No glossary entries for the active paper.'

  constructor(
    @inject(TreeProps) treeProps: TreeProps,
    @inject(TreeModel) model: TreeModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(ScholarWorkspaceService) store: ScholarWorkspaceService,
    @inject(ScholarAnnotationService) private readonly annotations: ScholarAnnotationService,
  ) {
    super(treeProps, model, contextMenuRenderer, store)
    this.id = SCHOLAR_GLOSSARY_WIDGET_ID
    this.title.label = 'Glossary'
    this.title.caption = 'Knowledge Graph Glossary'
    this.title.iconClass = 'codicon codicon-book'
  }

  protected getEntries(): ScholarTreeEntry[] {
    const snapshot = this.store.getSnapshot()
    const paperId = snapshot.activePaperId
    return paperId ? buildGlossaryTree(snapshot.tooltipsByPaperId[paperId] ?? []) : []
  }

  protected override activateEntry(entry: ScholarTreeEntry): void {
    super.activateEntry(entry)
    const paperId = this.store.getSnapshot().activePaperId
    if (paperId && entry.tooltipId) {
      this.annotations.select(paperId, entry.tooltipId)
    }
  }

  protected override handleDblClickEvent(node: TreeNode, event: React.MouseEvent<HTMLElement>): void {
    if (isScholarTreeNode(node) && node.entry.tooltipId) {
      const paperId = this.store.getSnapshot().activePaperId
      if (paperId) {
        this.annotations.select(paperId, node.entry.tooltipId)
      }
      event.stopPropagation()
      return
    }
    super.handleDblClickEvent(node, event)
  }
}

@injectable()
export class ScholarAnnotationEditorWidget extends ReactWidget {
  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(ScholarAnnotationService) private readonly annotations: ScholarAnnotationService,
    @inject(MessageService) private readonly messageService: MessageService,
    @inject(CommandService) private readonly commandService: CommandService,
  ) {
    super()
    this.id = SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID
    this.title.label = 'Annotation Details'
    this.title.caption = 'Annotation Details and Editor'
    this.title.iconClass = 'codicon codicon-comment'
    this.node.classList.add('scholar-widget', 'scholar-native-editor')
    this.toDispose.push(this.annotations.onDidChange(() => this.update()))
    this.update()
  }

  protected override render(): React.ReactNode {
    return (
      <ScholarEditorContent
        store={this.store}
        annotations={this.annotations}
        messageService={this.messageService}
        commandService={this.commandService}
      />
    )
  }
}

function ScholarEditorContent({
  store,
  annotations,
  messageService,
  commandService,
}: {
  store: ScholarWorkspaceService
  annotations: ScholarAnnotationService
  messageService: MessageService
  commandService: CommandService
}): React.ReactElement {
  const subscribe = React.useCallback((listener: () => void) => {
    const subscription = annotations.onDidChange(listener)
    return () => subscription.dispose()
  }, [annotations])
  const draft = React.useSyncExternalStore(
    subscribe,
    () => annotations.currentDraft,
    () => undefined,
  )
  const selection = React.useSyncExternalStore(
    subscribe,
    () => annotations.currentSelection,
    () => undefined,
  )
  const snapshot = useScholarSnapshot(store)

  if (draft) {
    return (
      <ScholarEditorForm
        key={`${draft.mode}:${draft.paperId}:${draft.tooltipId ?? draft.domNodeId}`}
        draft={draft}
        onCancel={() => annotations.cancelDraft()}
        onSave={async (content, targetText) => {
          try {
            if (draft.mode === 'create' && draft.domNodeId) {
              const saved = await store.createTooltip(
                draft.paperId,
                draft.domNodeId,
                content,
                targetText,
              )
              annotations.select(draft.paperId, saved.id)
            } else if (draft.mode === 'edit' && draft.tooltipId) {
              const saved = await store.updateTooltip(
                draft.paperId,
                draft.tooltipId,
                { content, targetText },
              )
              annotations.select(draft.paperId, saved.id)
            }
          } catch (reason) {
            await messageService.error(`Could not save annotation: ${errorMessage(reason)}`)
          }
        }}
      />
    )
  }

  const tooltip = selection && snapshot.activePaperId === selection.paperId
    ? snapshot.tooltipsByPaperId[selection.paperId]?.find(item => item.id === selection.tooltipId)
    : undefined
  if (!selection || !tooltip) {
    return <div className="scholar-empty">Select a comment to read it, or add a new annotation.</div>
  }

  return (
    <ScholarAnnotationDetail
      selection={selection}
      tooltip={tooltip}
      commandService={commandService}
      messageService={messageService}
    />
  )
}

function ScholarAnnotationDetail({
  selection,
  tooltip,
  commandService,
  messageService,
}: {
  selection: ScholarAnnotationSelection
  tooltip: Tooltip
  commandService: CommandService
  messageService: MessageService
}): React.ReactElement {
  const target: ScholarAnnotationTarget = {
    paperId: selection.paperId,
    domNodeId: tooltip.dom_node_id ?? '',
    targetText: tooltip.target_text ?? undefined,
    tooltipIds: [tooltip.id],
    semanticTooltipId: tooltip.entity_id ? tooltip.id : undefined,
  }
  const execute = (commandId: string): void => {
    void commandService.executeCommand(commandId, target).catch(reason => {
      void messageService.error(`Could not run annotation action: ${errorMessage(reason)}`)
    })
  }

  return (
    <article className="scholar-annotation-detail">
      {(tooltip.target_text?.trim() || tooltip.is_pinned) && (
        <header className="scholar-annotation-detail-header scholar-suggestion-detail-header">
          {tooltip.target_text?.trim() && (
            <strong><LatexText text={tooltip.target_text} /></strong>
          )}
          {tooltip.is_pinned && (
            <span className="codicon codicon-pinned" title="Pinned" aria-label="Pinned" />
          )}
        </header>
      )}
      <div className="scholar-suggestion-preview scholar-annotation-content">
        <LatexText text={tooltip.content} />
      </div>
      <div className="scholar-native-editor-actions scholar-annotation-detail-actions">
        <button
          type="button"
          className="theia-button secondary"
          title="Reveal in Paper"
          aria-label="Reveal in Paper"
          disabled={!tooltip.dom_node_id}
          onClick={() => execute(ScholarCommands.OPEN_ANNOTATION.id)}
        >
          <span className="codicon codicon-go-to-file" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="theia-button secondary"
          title="Edit Annotation"
          aria-label="Edit Annotation"
          onClick={() => execute(ScholarCommands.EDIT_ANNOTATION.id)}
        >
          <span className="codicon codicon-edit" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="theia-button secondary"
          title={tooltip.is_pinned ? 'Unpin Annotation' : 'Pin Annotation'}
          aria-label={tooltip.is_pinned ? 'Unpin Annotation' : 'Pin Annotation'}
          onClick={() => execute(ScholarCommands.TOGGLE_ANNOTATION_PIN.id)}
        >
          <span
            className={`codicon codicon-${tooltip.is_pinned ? 'pinned' : 'pin'}`}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="theia-button secondary scholar-annotation-delete"
          title="Delete Annotation"
          aria-label="Delete Annotation"
          onClick={() => execute(ScholarCommands.DELETE_ANNOTATION.id)}
        >
          <span className="codicon codicon-trash" aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

function ScholarEditorForm({
  draft,
  onCancel,
  onSave,
}: {
  draft: ScholarAnnotationDraft
  onCancel: () => void
  onSave: (content: string, targetText?: string) => Promise<void>
}): React.ReactElement {
  const [content, setContent] = React.useState(draft.content)
  const [targetText, setTargetText] = React.useState(draft.targetText ?? '')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setContent(draft.content)
    setTargetText(draft.targetText ?? '')
  }, [draft])

  const submit = async (): Promise<void> => {
    const value = content.trim()
    if (!value || saving) {
      return
    }
    setSaving(true)
    try {
      await onSave(value, targetText.trim() || undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="scholar-native-editor-form"
      onSubmit={event => {
        event.preventDefault()
        void submit()
      }}
    >
      <label>
        Target text
        <input
          className="theia-input"
          value={targetText}
          onChange={event => setTargetText(event.target.value)}
        />
      </label>
      <label className="scholar-editor-content-field">
        Annotation
        <textarea
          className="theia-input"
          rows={5}
          autoFocus
          value={content}
          onChange={event => setContent(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void submit()
            }
          }}
        />
      </label>
      <div className="scholar-native-editor-actions">
        <button type="button" className="theia-button secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="theia-button" disabled={saving || !content.trim()}>
          Save
        </button>
      </div>
    </form>
  )
}

function toTreeNode(
  entry: ScholarTreeEntry,
  parent: CompositeTreeNode,
  state: Map<string, { expanded: boolean; selected: boolean }>,
  depth: number,
): ScholarTreeNode {
  const previous = state.get(entry.id)
  const node: ScholarTreeNode = {
    id: entry.id,
    name: entry.searchText ?? entry.label,
    description: entry.description,
    parent,
    children: [],
    expanded: previous?.expanded ?? depth < 1,
    selected: previous?.selected ?? false,
    entry,
  }
  node.children = entry.children.map(child => toTreeNode(child, node, state, depth + 1))
  return node
}

function collectTreeState(
  node: TreeNode | undefined,
  state: Map<string, { expanded: boolean; selected: boolean }>,
): void {
  if (isScholarTreeNode(node)) {
    state.set(node.id, { expanded: node.expanded, selected: node.selected })
  }
  if (CompositeTreeNode.is(node)) {
    node.children.forEach(child => collectTreeState(child, state))
  }
}

function entryIcon(entry: ScholarTreeEntry): string {
  if (entry.kind === 'section') return ''
  if (entry.kind === 'comment') return 'comment'
  if (entry.kind === 'glossary') {
    const entityType = entry.entityId?.split('_', 1)[0]?.toLowerCase()
    if (entityType === 'def' || entityType === 'definition') return 'symbol-class'
    if (entityType === 'formula' || entityType === 'equation') return 'symbol-operator'
    if (entityType === 'symbol') return 'symbol-variable'
    if (entityType === 'theorem') return 'symbol-constant'
    return 'symbol-keyword'
  }
  const groupLabel = entry.label.toLowerCase()
  if (groupLabel.includes('definition')) return 'symbol-class'
  if (groupLabel.includes('formula') || groupLabel.includes('equation')) return 'symbol-operator'
  if (groupLabel.includes('symbol')) return 'symbol-variable'
  if (groupLabel.includes('theorem')) return 'symbol-constant'
  return 'folder'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}