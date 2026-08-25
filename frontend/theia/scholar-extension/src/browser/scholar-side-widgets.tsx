import * as React from 'react'
import { CommandService, Disposable, type MenuPath } from '@theia/core'
import {
  CompositeTreeNode,
  ContextMenuRenderer,
  type ExpandableTreeNode,
  type NodeProps,
  SelectableTreeNode,
  TreeModel,
  TreeNode,
  TreeProps,
  TreeWidget,
} from '@theia/core/lib/browser'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'

import type { Paper } from '../../../../hooks/usePapers'
import type { ReaderWorkspaceSnapshot } from '../../../../lib/reader-workspace-store'
import { paperLabel } from './scholar-react'
import { ScholarCommands } from './scholar-commands'
import { ScholarWorkspaceService } from './scholar-workspace-service'

export const SCHOLAR_LIBRARY_WIDGET_ID = 'scholar-agent:library'
export const SCHOLAR_NAVIGATION_WIDGET_ID = 'scholar-agent:navigation'
export const SCHOLAR_ANNOTATIONS_WIDGET_ID = 'scholar-agent:annotations'
export const SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID = 'scholar-agent:tooltip-drafts'
export const SCHOLAR_LIBRARY_CONTEXT_MENU: MenuPath = ['scholar-agent-library-context-menu']

const LIBRARY_EMPTY_MESSAGE = 'No papers yet. Use Upload LaTeX or Import from arXiv to get started.'

export interface ScholarLibraryTreeNode extends SelectableTreeNode {
  paperId: string
  compiling?: boolean
  hasError?: boolean
}

export function isScholarLibraryTreeNode(value: unknown): value is ScholarLibraryTreeNode {
  return SelectableTreeNode.is(value) && typeof (value as { paperId?: unknown }).paperId === 'string'
}

@injectable()
export class ScholarLibraryWidget extends TreeWidget {
  constructor(
    @inject(TreeProps) treeProps: TreeProps,
    @inject(TreeModel) model: TreeModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(ScholarWorkspaceService) private readonly store: ScholarWorkspaceService,
    @inject(CommandService) private readonly commandService: CommandService,
  ) {
    super(treeProps, model, contextMenuRenderer)
    this.id = SCHOLAR_LIBRARY_WIDGET_ID
    this.title.label = 'Papers'
    this.title.caption = 'Paper Library'
    this.title.iconClass = 'codicon codicon-library'
    this.title.closable = true
  }

  @postConstruct()
  protected override init(): void {
    super.init()
    this.addClass('scholar-native-tree')
    this.addClass('scholar-library-tree')
    this.toDispose.push(Disposable.create(this.store.subscribe(() => this.refreshTree())))
    this.toDispose.push(this.model.onOpenNode(node => this.openLibraryNode(node)))
    this.refreshTree()
  }

  protected refreshTree(): void {
    const previousSelection = new Set<string>()
    const previousRoot = this.model.root
    if (CompositeTreeNode.is(previousRoot)) {
      previousRoot.children.forEach(child => {
        if (SelectableTreeNode.is(child) && child.selected) {
          previousSelection.add(child.id)
        }
      })
    }

    const rootId = `${this.id}:root`
    const root: CompositeTreeNode = CompositeTreeNode.is(previousRoot) && previousRoot.id === rootId
      ? previousRoot
      : {
          id: rootId,
          name: this.title.label,
          visible: false,
          parent: undefined,
          children: [],
        }
    const snapshot = this.store.getSnapshot()
    root.children = snapshot.papers.map(paper => this.toLibraryNode(paper, root, snapshot, previousSelection))
    this.model.root = root
  }

  private toLibraryNode(
    paper: Paper,
    parent: CompositeTreeNode,
    snapshot: ReaderWorkspaceSnapshot,
    previousSelection: Set<string>,
  ): ScholarLibraryTreeNode {
    const id = `paper:${paper.id}`
    const detail = snapshot.papersById[paper.id]
    const status = snapshot.statusByPaperId[paper.id]
    const error = snapshot.paperErrors[paper.id]
    const description = status ?? error ?? (paper.arxiv_id ? `arXiv:${paper.arxiv_id}` : undefined)
    return {
      id,
      paperId: paper.id,
      name: paperLabel(paper.filename, detail?.paper_metadata?.title ?? paper.title),
      description,
      compiling: Boolean(status),
      hasError: Boolean(error),
      parent,
      selected: previousSelection.has(id),
    }
  }

  private openLibraryNode(node?: TreeNode): void {
    if (isScholarLibraryTreeNode(node)) {
      void this.commandService.executeCommand(ScholarCommands.OPEN_PAPER.id, node)
    }
  }

  protected override renderIcon(node: TreeNode): React.ReactNode {
    if (!isScholarLibraryTreeNode(node)) {
      return undefined
    }
    const iconName = node.compiling ? 'sync' : node.hasError ? 'warning' : 'book'
    return <div className={`scholar-tree-icon codicon codicon-${iconName}`} />
  }

  protected override getCaptionChildren(node: TreeNode, props: NodeProps): React.ReactNode {
    if (!isScholarLibraryTreeNode(node)) {
      return super.getCaptionChildren(node, props)
    }
    return (
      <>
        <span className="scholar-tree-library-label" title={node.name}>{node.name}</span>
        {node.description && (
          <span className="scholar-tree-library-description">{node.description}</span>
        )}
      </>
    )
  }

  protected override isExpandable(node: TreeNode): node is ExpandableTreeNode {
    return false
  }

  protected override toContextMenuArgs(node: SelectableTreeNode): unknown[] {
    return [node]
  }

  protected override renderTree(model: TreeModel): React.ReactNode {
    if (CompositeTreeNode.is(model.root) && model.root.children.length === 0) {
      return <div className="theia-widget-noInfo scholar-tree-empty">{LIBRARY_EMPTY_MESSAGE}</div>
    }
    return super.renderTree(model)
  }
}
