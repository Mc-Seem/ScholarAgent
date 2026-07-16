import * as React from 'react'
import { Disposable, MessageService, type MenuPath } from '@theia/core'
import {
  CompositeTreeNode,
  ContextMenuRenderer,
  ExpandableTreeNode,
  Message,
  type NodeProps,
  ReactWidget,
  SelectableTreeNode,
  TreeModel,
  TreeNode,
  TreeProps,
  TreeWidget,
} from '@theia/core/lib/browser'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'

import { KnowledgeGraphView } from '../../../../components/reader/KnowledgeGraphView'
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
} from './scholar-annotation-service'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const SCHOLAR_OUTLINE_WIDGET_ID = 'scholar-agent:outline'
export const SCHOLAR_GRAPH_WIDGET_ID = 'scholar-agent:graph'
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
    return <div className={`scholar-tree-icon codicon codicon-${entryIcon(node.entry)}`} />
  }

  protected override getCaptionChildren(node: TreeNode, props: NodeProps): React.ReactNode {
    const caption = super.getCaptionChildren(node, props)
    if (!isScholarTreeNode(node)) {
      return caption
    }
    return (
      <>
        {caption}
        {node.entry.pinned && <span className="scholar-tree-pin codicon codicon-pinned" />}
        {node.entry.count !== undefined && (
          <span className="scholar-tree-count">{node.entry.count}</span>
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
      ? { ...attributes, title: node.entry.description || node.entry.label }
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
    return paper ? buildOutlineTree(getPaperTOC(paper.sections, paper.html_content)) : []
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
    )
  }

  protected override activateEntry(entry: ScholarTreeEntry): void {
    super.activateEntry(entry)
    if (entry.entityId) {
      const paperId = this.store.getSnapshot().activePaperId
      if (paperId) {
        this.store.setActiveEntity(paperId, entry.entityId)
      }
    }
  }

  protected override handleDblClickEvent(node: TreeNode, event: React.MouseEvent<HTMLElement>): void {
    if (isScholarTreeNode(node) && node.entry.tooltipId) {
      this.editTooltip(node.entry.tooltipId)
      event.stopPropagation()
      return
    }
    super.handleDblClickEvent(node, event)
  }

  private editTooltip(tooltipId: string): void {
    const snapshot = this.store.getSnapshot()
    const paperId = snapshot.activePaperId
    const tooltip = paperId
      ? snapshot.tooltipsByPaperId[paperId]?.find(item => item.id === tooltipId)
      : undefined
    if (paperId && tooltip) {
      this.annotations.edit(paperId, tooltip.id, tooltip.content, tooltip.target_text ?? undefined)
    }
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
    if (paperId && entry.entityId) {
      this.store.setActiveEntity(paperId, entry.entityId)
    }
  }

  protected override handleDblClickEvent(node: TreeNode, event: React.MouseEvent<HTMLElement>): void {
    if (isScholarTreeNode(node) && node.entry.tooltipId) {
      const snapshot = this.store.getSnapshot()
      const paperId = snapshot.activePaperId
      const tooltip = paperId
        ? snapshot.tooltipsByPaperId[paperId]?.find(item => item.id === node.entry.tooltipId)
        : undefined
      if (paperId && tooltip) {
        this.annotations.edit(paperId, tooltip.id, tooltip.content, tooltip.target_text ?? undefined)
      }
      event.stopPropagation()
      return
    }
    super.handleDblClickEvent(node, event)
  }
}

@injectable()
export class ScholarGraphWidget extends ReactWidget {
  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
  ) {
    super()
    this.id = SCHOLAR_GRAPH_WIDGET_ID
    this.title.label = 'Graph'
    this.title.caption = 'Knowledge Graph'
    this.title.iconClass = 'codicon codicon-type-hierarchy'
    this.node.classList.add('scholar-widget', 'scholar-native-graph')
    this.toDispose.push(Disposable.create(this.store.subscribe(() => this.update())))
    this.update()
  }

  protected override render(): React.ReactNode {
    return <ScholarGraphContent store={this.store} />
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    this.node.focus({ preventScroll: true })
  }
}

function ScholarGraphContent({ store }: { store: ScholarWorkspaceService }): React.ReactElement {
  const snapshot = useScholarSnapshot(store)
  const paperId = snapshot.activePaperId
  if (!paperId) {
    return <div className="scholar-empty">Open a paper to view its knowledge graph.</div>
  }
  return (
    <KnowledgeGraphView
      key={paperId}
      paperId={paperId}
      onNavigate={dataId => navigateToPaperElement(paperId, dataId)}
    />
  )
}

@injectable()
export class ScholarAnnotationEditorWidget extends ReactWidget {
  constructor(
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(ScholarAnnotationService) private readonly annotations: ScholarAnnotationService,
    @inject(MessageService) private readonly messageService: MessageService,
  ) {
    super()
    this.id = SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID
    this.title.label = 'Editor'
    this.title.caption = 'Annotation Editor'
    this.title.iconClass = 'codicon codicon-edit'
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
      />
    )
  }
}

function ScholarEditorContent({
  store,
  annotations,
  messageService,
}: {
  store: ScholarWorkspaceService
  annotations: ScholarAnnotationService
  messageService: MessageService
}): React.ReactElement {
  const draft = React.useSyncExternalStore(
    listener => {
      const subscription = annotations.onDidChange(listener)
      return () => subscription.dispose()
    },
    () => annotations.currentDraft,
    () => undefined,
  )
  if (!draft) {
    return <div className="scholar-empty">Select “Add Annotation” or edit an existing item.</div>
  }
  return (
    <ScholarEditorForm
      key={`${draft.mode}:${draft.paperId}:${draft.tooltipId ?? draft.domNodeId}`}
      draft={draft}
      onCancel={() => annotations.clear()}
      onSave={async (content, targetText) => {
        try {
          if (draft.mode === 'create' && draft.domNodeId) {
            await store.createTooltip(draft.paperId, draft.domNodeId, content, targetText)
          } else if (draft.mode === 'edit' && draft.tooltipId) {
            await store.updateTooltip(draft.paperId, draft.tooltipId, { content, targetText })
          }
          annotations.clear()
        } catch (reason) {
          await messageService.error(`Could not save annotation: ${errorMessage(reason)}`)
        }
      }}
    />
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
    name: entry.label,
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
  if (entry.kind === 'section') return 'symbol-structure'
  if (entry.kind === 'comment') return 'comment'
  if (entry.kind === 'glossary') return 'symbol-keyword'
  return 'folder'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}