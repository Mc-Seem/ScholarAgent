import { Emitter, Event, type MenuPath } from '@theia/core'
import { injectable } from '@theia/core/shared/inversify'

export const SCHOLAR_PAPER_CONTEXT_MENU: MenuPath = ['scholar-agent-paper-context-menu']

export interface ScholarAnnotationTarget {
  paperId: string
  domNodeId: string
  targetText?: string
  tooltipIds: string[]
  semanticTooltipId?: string
}

export function isScholarAnnotationTarget(value: unknown): value is ScholarAnnotationTarget {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<ScholarAnnotationTarget>
  return typeof candidate.paperId === 'string'
    && typeof candidate.domNodeId === 'string'
    && Array.isArray(candidate.tooltipIds)
}

export interface ScholarAnnotationDraft {
  mode: 'create' | 'edit'
  paperId: string
  domNodeId?: string
  tooltipId?: string
  targetText?: string
  content: string
}

export interface ScholarAnnotationSelection {
  paperId: string
  tooltipId: string
}

@injectable()
export class ScholarAnnotationService {
  private readonly changeEmitter = new Emitter<void>()
  private draft: ScholarAnnotationDraft | undefined
  private selection: ScholarAnnotationSelection | undefined

  readonly onDidChange: Event<void> = this.changeEmitter.event

  get currentDraft(): ScholarAnnotationDraft | undefined {
    return this.draft
  }

  get currentSelection(): ScholarAnnotationSelection | undefined {
    return this.selection
  }

  select(paperId: string, tooltipId: string): void {
    this.selection = { paperId, tooltipId }
    this.draft = undefined
    this.changeEmitter.fire()
  }

  create(paperId: string, domNodeId: string, targetText?: string): void {
    this.selection = undefined
    this.draft = {
      mode: 'create',
      paperId,
      domNodeId,
      targetText: targetText?.trim() || undefined,
      content: '',
    }
    this.changeEmitter.fire()
  }

  edit(paperId: string, tooltipId: string, content: string, targetText?: string): void {
    this.selection = { paperId, tooltipId }
    this.draft = {
      mode: 'edit',
      paperId,
      tooltipId,
      targetText: targetText?.trim() || undefined,
      content,
    }
    this.changeEmitter.fire()
  }

  cancelDraft(): void {
    if (this.draft) {
      this.draft = undefined
      this.changeEmitter.fire()
    }
  }

  clear(): void {
    if (this.draft || this.selection) {
      this.draft = undefined
      this.selection = undefined
      this.changeEmitter.fire()
    }
  }
}