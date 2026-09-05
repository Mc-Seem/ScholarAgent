import * as React from 'react'
import { CommandService, Disposable, type MenuPath } from '@theia/core'
import {
  CompositeTreeNode,
  ContextMenuRenderer,
  ExpandableTreeNode,
  type NodeProps,
  SelectableTreeNode,
  TreeModel,
  TreeNode,
  TreeProps,
  TreeWidget,
} from '@theia/core/lib/browser'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'

import type { ReadingSet, ReadingSetPaperSummary } from '../../../../lib/reading-set-api'
import { paperLabel } from './scholar-react'
import { ScholarCommands } from './scholar-commands'
import {
  type ReadingSetAlignmentBuild,
  ScholarReadingSetService,
} from './scholar-reading-set-service'

export const SCHOLAR_READING_SETS_WIDGET_ID = 'scholar-agent:reading-sets'
export const SCHOLAR_READING_SET_CONTEXT_MENU: MenuPath = ['scholar-agent-reading-set-context-menu']

const READING_SETS_EMPTY_MESSAGE
  = 'No reading sets yet. Create one here or use "Add to Reading Set…" in the paper library.'

export interface ScholarReadingSetTreeNode extends SelectableTreeNode, ExpandableTreeNode {
  readingSetId: string
}

export interface ScholarReadingSetPaperTreeNode extends SelectableTreeNode {
  readingSetId: string
  paperId: string
}

export function isScholarReadingSetTreeNode(value: unknown): value is ScholarReadingSetTreeNode {
  return SelectableTreeNode.is(value)
    && ExpandableTreeNode.is(value)
    && typeof (value as { readingSetId?: unknown }).readingSetId === 'string'
}

export function isScholarReadingSetPaperTreeNode(
  value: unknown,
): value is ScholarReadingSetPaperTreeNode {
  return SelectableTreeNode.is(value)
    && typeof (value as { readingSetId?: unknown }).readingSetId === 'string'
    && typeof (value as { paperId?: unknown }).paperId === 'string'
}

/** Progress indicator text shown instead of the paper count while linking. */
export function linkTermsDescription(build: ReadingSetAlignmentBuild): string {
  if (build.stage === 'linking' && build.label && build.total) {
    return `Linking terms: ${build.label} (${build.current ?? 0}/${build.total})…`
  }
  return 'Linking terms…'
}

@injectable()
export class ScholarReadingSetWidget extends TreeWidget {
  constructor(
    @inject(TreeProps) treeProps: TreeProps,
    @inject(TreeModel) model: TreeModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(ScholarReadingSetService) private readonly readingSets: ScholarReadingSetService,
    @inject(CommandService) private readonly commandService: CommandService,
  ) {
    super(treeProps, model, contextMenuRenderer)
    this.id = SCHOLAR_READING_SETS_WIDGET_ID
    this.title.label = 'Reading Sets'
    this.title.caption = 'Reading Sets'
    this.title.iconClass = 'codicon codicon-folder-library'
    this.title.closable = true
  }

  @postConstruct()
  protected override init(): void {
    super.init()
    this.addClass('scholar-native-tree')
    this.addClass('scholar-reading-set-tree')
    this.toDispose.push(Disposable.create(this.readingSets.subscribe(() => this.refreshTree())))
    this.toDispose.push(this.model.onOpenNode(node => this.openReadingSetPaperNode(node)))
    void this.readingSets.initialize()
    this.refreshTree()
  }

  protected refreshTree(): void {
    const previousSelection = new Set<string>()
    const previousCollapsed = new Set<string>()
    const previousRoot = this.model.root
    if (CompositeTreeNode.is(previousRoot)) {
      previousRoot.children.forEach(child => {
        if (SelectableTreeNode.is(child) && child.selected) {
          previousSelection.add(child.id)
        }
        if (ExpandableTreeNode.is(child) && !child.expanded) {
          previousCollapsed.add(child.id)
        }
        if (CompositeTreeNode.is(child)) {
          child.children.forEach(grandChild => {
            if (SelectableTreeNode.is(grandChild) && grandChild.selected) {
              previousSelection.add(grandChild.id)
            }
          })
        }
      })
    }

    const root: CompositeTreeNode = {
      id: `${this.id}:root`,
      name: this.title.label,
      visible: false,
      parent: undefined,
      children: [],
    }
    const snapshot = this.readingSets.getSnapshot()
    root.children = snapshot.readingSets.map(
      readingSet => this.toReadingSetNode(readingSet, root, previousSelection, previousCollapsed),
    )
    this.model.root = root
  }

  private toReadingSetNode(
    readingSet: ReadingSet,
    parent: CompositeTreeNode,
    previousSelection: Set<string>,
    previousCollapsed: Set<string>,
  ): ScholarReadingSetTreeNode {
    const id = `reading-set:${readingSet.id}`
    const paperCount = readingSet.papers.length
    const build = this.readingSets.getSnapshot().alignmentBuilds[readingSet.id]
    const pendingLinks = this.readingSets.pendingAlignmentCountOf(readingSet.id)
    const paperCountLabel = `${paperCount} paper${paperCount === 1 ? '' : 's'}`
    const node: ScholarReadingSetTreeNode = {
      id,
      readingSetId: readingSet.id,
      name: readingSet.name,
      description: build
        ? linkTermsDescription(build)
        : pendingLinks
          ? `${paperCountLabel} · ${pendingLinks} pending link${pendingLinks === 1 ? '' : 's'}`
          : paperCountLabel,
      parent,
      selected: previousSelection.has(id),
      expanded: !previousCollapsed.has(id),
      children: [],
    }
    node.children = readingSet.papers.map(
      paper => this.toReadingSetPaperNode(readingSet, paper, node, previousSelection),
    )
    return node
  }

  private toReadingSetPaperNode(
    readingSet: ReadingSet,
    paper: ReadingSetPaperSummary,
    parent: ScholarReadingSetTreeNode,
    previousSelection: Set<string>,
  ): ScholarReadingSetPaperTreeNode {
    const id = `reading-set:${readingSet.id}:paper:${paper.id}`
    // Surface the Link Terms precondition before the user runs it: papers
    // without a knowledge graph are skipped by the alignment build.
    const missingGraph = paper.has_knowledge_graph ? undefined : 'No knowledge graph'
    const arxiv = paper.arxiv_id ? `arXiv:${paper.arxiv_id}` : undefined
    return {
      id,
      readingSetId: readingSet.id,
      paperId: paper.id,
      name: paperLabel(paper.filename, paper.title ?? undefined),
      description: missingGraph && arxiv ? `${arxiv} · ${missingGraph}` : missingGraph ?? arxiv,
      parent,
      selected: previousSelection.has(id),
    }
  }

  private openReadingSetPaperNode(node?: TreeNode): void {
    if (isScholarReadingSetPaperTreeNode(node)) {
      void this.commandService.executeCommand(ScholarCommands.OPEN_PAPER.id, node)
    }
  }

  protected override renderIcon(node: TreeNode): React.ReactNode {
    if (isScholarReadingSetTreeNode(node)) {
      return <div className="scholar-tree-icon codicon codicon-folder-library" />
    }
    if (isScholarReadingSetPaperTreeNode(node)) {
      const paper = this.readingSets.readingSetOf(node.readingSetId)
        ?.papers.find(member => member.id === node.paperId)
      if (paper && !paper.has_knowledge_graph) {
        return (
          <div
            className="scholar-tree-icon codicon codicon-warning"
            title="No knowledge graph yet — Link Terms will skip this paper"
          />
        )
      }
      return <div className="scholar-tree-icon codicon codicon-book" />
    }
    return undefined
  }

  protected override getCaptionChildren(node: TreeNode, props: NodeProps): React.ReactNode {
    if (!isScholarReadingSetTreeNode(node) && !isScholarReadingSetPaperTreeNode(node)) {
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
    return isScholarReadingSetTreeNode(node)
  }

  protected override toContextMenuArgs(node: SelectableTreeNode): unknown[] {
    return [node]
  }

  protected override renderTree(model: TreeModel): React.ReactNode {
    if (CompositeTreeNode.is(model.root) && model.root.children.length === 0) {
      const { loading, error } = this.readingSets.getSnapshot()
      const message = loading ? 'Loading reading sets…' : error ?? READING_SETS_EMPTY_MESSAGE
      return <div className="theia-widget-noInfo scholar-tree-empty">{message}</div>
    }
    return super.renderTree(model)
  }
}
