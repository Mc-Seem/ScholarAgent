import { Emitter, Event, SelectionService } from '@theia/core'
import { inject, injectable } from '@theia/core/shared/inversify'

import {
  ChatApiError,
  HttpChatApi,
  type ChatApi,
  type ChatCitation,
  type ChatContext,
  type ChatConversation,
  type ChatMessage,
  type ChatStreamEvent,
  type PendingChatAction,
} from '../../../../lib/chat-api'
import { ScholarWorkspaceService } from './scholar-workspace-service'
import {
  SCHOLAR_GRAPH_SELECTION_KIND,
  ScholarGraphSelection,
} from './scholar-graph-selection'
import { navigateToPaperElement } from './scholar-react'

export interface ScholarChatSnapshot {
  readonly activePaperId: string | null
  readonly conversations: readonly ChatConversation[]
  readonly activeConversationId: number | null
  readonly messages: readonly ChatMessage[]
  readonly loading: boolean
  readonly streaming: boolean
  readonly status: string | null
  readonly error: string | null
  readonly nextContext: ChatContext | null
  readonly currentSection: ChatContext | null
  readonly retryContent: string | null
  readonly actionBusyId: number | null
}

type Listener = () => void

function initialSnapshot(activePaperId: string | null = null): ScholarChatSnapshot {
  return {
    activePaperId,
    conversations: [],
    activeConversationId: null,
    messages: [],
    loading: false,
    streaming: false,
    status: null,
    error: null,
    nextContext: null,
    currentSection: null,
    retryContent: null,
    actionBusyId: null,
  }
}

function errorMessage(reason: unknown): string {
  if (reason instanceof ChatApiError && reason.code === 'stale_action') {
    return 'This definition changed since the proposal was created. Ask for a new proposal.'
  }
  return reason instanceof Error && reason.message ? reason.message : 'Chat request failed.'
}

function conversationTitle(question: string): string {
  const title = question.replace(/\s+/g, ' ').trim()
  return title.length <= 60 ? title : `${title.slice(0, 59).trimEnd()}…`
}

@injectable()
export class ScholarChatService {
  private snapshot: ScholarChatSnapshot = initialSnapshot()
  private readonly listeners = new Set<Listener>()
  private readonly citationEmitter = new Emitter<ChatCitation>()
  private readonly unsubscribeWorkspace: () => void
  private streamController: AbortController | null = null
  private loadVersion = 0
  private initialized = false

  readonly onDidRequestCitation: Event<ChatCitation> = this.citationEmitter.event

  constructor(
    @inject(HttpChatApi) private readonly api: ChatApi,
    @inject(ScholarWorkspaceService) private readonly workspace: ScholarWorkspaceService,
    @inject(SelectionService) private readonly selectionService: SelectionService,
  ) {
    this.unsubscribeWorkspace = this.workspace.subscribe(() => {
      const paperId = this.workspace.getSnapshot().activePaperId
      if (paperId !== this.snapshot.activePaperId) void this.activatePaper(paperId)
    })
  }

  getSnapshot = (): ScholarChatSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    await this.activatePaper(this.workspace.getSnapshot().activePaperId)
  }

  dispose(): void {
    this.cancelStream()
    this.unsubscribeWorkspace()
    this.citationEmitter.dispose()
    this.listeners.clear()
  }

  async activatePaper(paperId: string | null): Promise<void> {
    this.cancelStream()
    const version = ++this.loadVersion
    this.update({ ...initialSnapshot(paperId), loading: Boolean(paperId) })
    if (!paperId) return
    try {
      const conversations = await this.api.listConversations(paperId)
      if (version !== this.loadVersion) return
      const activeConversationId = conversations[0]?.id ?? null
      this.update({ conversations, activeConversationId, loading: Boolean(activeConversationId) })
      if (activeConversationId) await this.loadMessages(paperId, activeConversationId, version)
      else this.update({ loading: false })
    } catch (reason) {
      if (version !== this.loadVersion) return
      this.update({ loading: false, error: errorMessage(reason) })
    }
  }

  async selectConversation(conversationId: number): Promise<void> {
    const paperId = this.requirePaper()
    if (!this.snapshot.conversations.some(item => item.id === conversationId)) return
    const version = ++this.loadVersion
    this.cancelStream()
    this.update({ activeConversationId: conversationId, messages: [], loading: true, error: null })
    await this.loadMessages(paperId, conversationId, version)
  }

  async createConversation(title = 'New conversation'): Promise<ChatConversation> {
    const paperId = this.requirePaper()
    try {
      const conversation = await this.api.createConversation(paperId, title.trim() || 'New conversation')
      ++this.loadVersion
      this.update({
        conversations: [conversation, ...this.snapshot.conversations],
        activeConversationId: conversation.id,
        messages: [],
        error: null,
      })
      return conversation
    } catch (reason) {
      this.update({ error: errorMessage(reason) })
      throw reason
    }
  }

  async renameConversation(conversationId: number, title: string): Promise<void> {
    const paperId = this.requirePaper()
    try {
      const conversation = await this.api.renameConversation(paperId, conversationId, title.trim())
      this.update({
        conversations: this.snapshot.conversations.map(item =>
          item.id === conversationId ? conversation : item),
        error: null,
      })
    } catch (reason) {
      this.update({ error: errorMessage(reason) })
      throw reason
    }
  }

  async deleteConversation(conversationId: number): Promise<void> {
    const paperId = this.requirePaper()
    const previousActiveConversationId = this.snapshot.activeConversationId
    if (previousActiveConversationId === conversationId) this.cancelStream()
    try {
      await this.api.deleteConversation(paperId, conversationId)
    } catch (reason) {
      this.update({ error: errorMessage(reason) })
      throw reason
    }
    const conversations = this.snapshot.conversations.filter(item => item.id !== conversationId)
    const activeConversationId = previousActiveConversationId === conversationId
      ? conversations[0]?.id ?? null
      : previousActiveConversationId
    this.update({
      conversations,
      activeConversationId,
      messages: activeConversationId === previousActiveConversationId ? this.snapshot.messages : [],
      error: null,
    })
    if (activeConversationId && activeConversationId !== previousActiveConversationId) {
      await this.selectConversation(activeConversationId)
    } else if (!activeConversationId) {
      this.update({ messages: [] })
    }
  }

  setNextContext(context: ChatContext): void {
    this.update({ nextContext: context })
  }

  setNextContextForPaper(paperId: string, context: ChatContext | null): void {
    if (paperId !== this.snapshot.activePaperId) return
    if (context) this.setNextContext(context)
    else this.clearNextContext()
  }

  setCurrentSection(paperId: string, sectionId: string | null): void {
    if (paperId !== this.snapshot.activePaperId) return
    if (this.snapshot.currentSection?.section_id === sectionId
      || (!this.snapshot.currentSection && !sectionId)) return
    this.update({
      currentSection: sectionId
        ? { kind: 'section', section_id: sectionId, data_id: sectionId }
        : null,
    })
  }

  async summarizeCurrentSection(): Promise<void> {
    const context = this.snapshot.currentSection
    if (!context || this.snapshot.streaming) return
    this.setNextContext(context)
    await this.sendMessage('Кратко перескажи текущую секцию.')
  }

  clearNextContext(): void {
    this.update({ nextContext: null })
  }

  async sendMessage(content: string): Promise<void> {
    const question = content.trim()
    if (!question || this.snapshot.streaming) return
    const paperId = this.requirePaper()
    let conversationId = this.snapshot.activeConversationId
    if (!conversationId) conversationId = (await this.createConversation(conversationTitle(question))).id
    const context = this.snapshot.nextContext
    const controller = new AbortController()
    this.streamController = controller
    const optimistic: ChatMessage = {
      id: -Date.now(),
      conversation_id: conversationId,
      role: 'user',
      content: question,
      context,
      citations: [],
      pending_action: null,
      created_at: new Date().toISOString(),
    }
    this.update({
      messages: [...this.snapshot.messages, optimistic],
      streaming: true,
      status: 'Preparing article evidence…',
      error: null,
      retryContent: null,
      nextContext: null,
    })

    try {
      await this.api.streamMessage(
        paperId,
        conversationId,
        { content: question, context },
        event => this.applyStreamEvent(event),
        controller.signal,
      )
      if (!controller.signal.aborted) {
        const messages = await this.api.listMessages(paperId, conversationId)
        if (this.snapshot.activePaperId === paperId && this.snapshot.activeConversationId === conversationId) {
          this.update({ messages, streaming: false, status: null, error: null, retryContent: null })
        }
        await this.refreshConversations(paperId)
      }
    } catch (reason) {
      if (controller.signal.aborted) {
        this.update({ streaming: false, status: null })
      } else {
        try {
          const messages = await this.api.listMessages(paperId, conversationId)
          if (this.snapshot.activePaperId === paperId) this.update({ messages })
        } catch {
          // Keep the optimistic transcript if history refresh also fails.
        }
        this.update({
          streaming: false,
          status: null,
          error: errorMessage(reason),
          retryContent: question,
        })
      }
    } finally {
      if (this.streamController === controller) this.streamController = null
    }
  }

  retry(): Promise<void> {
    return this.snapshot.retryContent ? this.sendMessage(this.snapshot.retryContent) : Promise.resolve()
  }

  cancelStream(): void {
    this.streamController?.abort()
    this.streamController = null
    if (this.snapshot.streaming) this.update({ streaming: false, status: null })
  }

  requestCitation(citation: ChatCitation): void {
    this.citationEmitter.fire(citation)
    const paperId = this.snapshot.activePaperId
    if (!paperId) return
    if (citation.kind === 'entity' && citation.subject_id) {
      this.revealSubject(paperId, citation.subject_id, citation.label)
      return
    }
    const dataId = citation.source_id || citation.section_id
    if (dataId) {
      navigateToPaperElement(paperId, dataId, {
        quote: citation.kind === 'quote' ? citation.quote : undefined,
      })
    }
  }

  async confirmAction(actionId: number): Promise<void> {
    const paperId = this.requirePaper()
    this.update({ actionBusyId: actionId, error: null })
    try {
      const response = await this.api.confirmAction(paperId, actionId)
      this.replaceAction(response.action)
      await this.workspace.refreshTooltips(paperId)
      this.revealSubject(
        paperId,
        response.subject.subject.stable_id,
        response.subject.subject.label,
        response.subject.subject.kind,
      )
    } catch (reason) {
      if (reason instanceof ChatApiError && reason.code === 'stale_action') {
        this.replaceActionStatus(actionId, 'stale')
      }
      this.update({ error: errorMessage(reason) })
    } finally {
      this.update({ actionBusyId: null })
    }
  }

  async rejectAction(actionId: number): Promise<void> {
    const paperId = this.requirePaper()
    this.update({ actionBusyId: actionId, error: null })
    try {
      this.replaceAction(await this.api.rejectAction(paperId, actionId))
    } catch (reason) {
      this.update({ error: errorMessage(reason) })
    } finally {
      this.update({ actionBusyId: null })
    }
  }

  private applyStreamEvent(event: ChatStreamEvent): void {
    if (event.type === 'status') this.update({ status: event.message })
    if (event.type === 'error') this.update({ error: event.message })
    if (event.type === 'final') {
      this.update({ messages: [...this.snapshot.messages, event.message], status: null })
    }
  }

  private revealSubject(
    paperId: string,
    subjectId: string,
    label: string,
    nodeType = 'semantic subject',
  ): void {
    const selection = {
      kind: 'node' as const,
      id: subjectId,
      label,
      nodeType,
      incomingConnections: [],
      outgoingConnections: [],
    }
    this.workspace.setActiveEntity(paperId, subjectId)
    this.workspace.setSemanticSelection(paperId, selection)
    this.selectionService.selection = ScholarGraphSelection.create(
      paperId,
      { kind: SCHOLAR_GRAPH_SELECTION_KIND, paperId, owner: this },
      selection,
    )
  }

  private async refreshConversations(paperId: string): Promise<void> {
    try {
      const conversations = await this.api.listConversations(paperId)
      if (this.snapshot.activePaperId === paperId) this.update({ conversations })
    } catch {
      // A completed answer remains usable when refreshing only the title list fails.
    }
  }

  private async loadMessages(paperId: string, conversationId: number, version: number): Promise<void> {
    try {
      const messages = await this.api.listMessages(paperId, conversationId)
      if (version !== this.loadVersion) return
      this.update({ messages, loading: false, error: null })
    } catch (reason) {
      if (version !== this.loadVersion) return
      this.update({ loading: false, error: errorMessage(reason) })
    }
  }

  private replaceAction(action: PendingChatAction): void {
    this.update({
      messages: this.snapshot.messages.map(message =>
        message.pending_action?.id === action.id
          ? { ...message, pending_action: action }
          : message),
    })
  }

  private replaceActionStatus(actionId: number, status: PendingChatAction['status']): void {
    this.update({
      messages: this.snapshot.messages.map(message =>
        message.pending_action?.id === actionId
          ? { ...message, pending_action: { ...message.pending_action, status } }
          : message),
    })
  }

  private requirePaper(): string {
    if (!this.snapshot.activePaperId) throw new Error('Open a paper to use Chat.')
    return this.snapshot.activePaperId
  }

  private update(patch: Partial<ScholarChatSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}
