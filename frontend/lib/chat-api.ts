import type { Tooltip } from '../hooks/useTooltips'
import { API_BASE, apiUrl } from '../hooks/useApi'
import type { SemanticSubjectDetails } from './semantic-api'

export type ChatContext = {
  kind: 'selection' | 'section' | 'entity'
  data_id?: string
  section_id?: string
  subject_id?: string
  label?: string
  quote?: string
}

export type ChatCitation = {
  kind: 'quote' | 'section' | 'entity'
  label: string
  source_id?: string
  section_id?: string
  subject_id?: string
  quote?: string
}

export type ChatActionStatus = 'pending' | 'confirmed' | 'rejected' | 'stale'

export interface PendingChatAction {
  id: number
  source_message_id: number
  subject_id: string
  base_definition: string | null
  proposed_definition: string
  knowledge_graph_version: string | null
  status: ChatActionStatus
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: number
  conversation_id: number
  role: 'user' | 'assistant'
  content: string
  context: ChatContext | null
  citations: ChatCitation[]
  pending_action: PendingChatAction | null
  created_at: string
}

export interface ChatConversation {
  id: number
  paper_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ChatStatusEvent {
  type: 'status'
  stage: 'retrieval' | 'answer'
  message: string
}

export interface ChatFinalEvent {
  type: 'final'
  message: ChatMessage
  citations: ChatCitation[]
  pending_action: PendingChatAction | null
}

export interface ChatErrorEvent {
  type: 'error'
  message: string
}

export type ChatStreamEvent = ChatStatusEvent | ChatFinalEvent | ChatErrorEvent

export interface ChatActionConfirmation {
  action: PendingChatAction
  tooltip: Tooltip
  subject: SemanticSubjectDetails
}

export interface ChatApi {
  listConversations(paperId: string): Promise<ChatConversation[]>
  createConversation(paperId: string, title: string): Promise<ChatConversation>
  renameConversation(paperId: string, conversationId: number, title: string): Promise<ChatConversation>
  deleteConversation(paperId: string, conversationId: number): Promise<void>
  listMessages(paperId: string, conversationId: number): Promise<ChatMessage[]>
  streamMessage(
    paperId: string,
    conversationId: number,
    request: { content: string; context: ChatContext | null },
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<ChatFinalEvent>
  confirmAction(paperId: string, actionId: number): Promise<ChatActionConfirmation>
  rejectAction(paperId: string, actionId: number): Promise<PendingChatAction>
}

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ChatApiError'
  }
}

type JsonRecord = Record<string, unknown>

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value as JsonRecord
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label)
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`Invalid ${label}`)
  return value as number
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : string(value, label)
}

function parseContext(value: unknown): ChatContext | null {
  if (value === null || value === undefined) return null
  const item = record(value, 'chat context')
  const kind = item.kind
  if (kind !== 'selection' && kind !== 'section' && kind !== 'entity') {
    throw new Error('Invalid chat context')
  }
  const context: ChatContext = {
    kind,
    data_id: optionalString(item.data_id, 'context data_id'),
    section_id: optionalString(item.section_id, 'context section_id'),
    subject_id: optionalString(item.subject_id, 'context subject_id'),
    label: optionalString(item.label, 'context label'),
    quote: optionalString(item.quote, 'context quote'),
  }
  if (kind === 'selection' && (!context.data_id || !context.quote)) throw new Error('Invalid chat context')
  if (kind === 'section' && !context.section_id) throw new Error('Invalid chat context')
  if (kind === 'entity' && !context.subject_id) throw new Error('Invalid chat context')
  return context
}

function parseCitation(value: unknown): ChatCitation {
  const item = record(value, 'chat citation')
  const kind = item.kind
  if (kind !== 'quote' && kind !== 'section' && kind !== 'entity') {
    throw new Error('Invalid chat citation')
  }
  const citation: ChatCitation = {
    kind,
    label: string(item.label, 'citation label'),
    source_id: optionalString(item.source_id, 'citation source_id'),
    section_id: optionalString(item.section_id, 'citation section_id'),
    subject_id: optionalString(item.subject_id, 'citation subject_id'),
    quote: optionalString(item.quote, 'citation quote'),
  }
  if (kind === 'quote' && (!citation.source_id || !citation.quote)) throw new Error('Invalid chat citation')
  if (kind === 'section' && !citation.section_id) throw new Error('Invalid chat citation')
  if (kind === 'entity' && !citation.subject_id) throw new Error('Invalid chat citation')
  return citation
}

function parseCitations(value: unknown): ChatCitation[] {
  if (!Array.isArray(value)) throw new Error('Invalid chat citations')
  return value.map(parseCitation)
}

function parseAction(value: unknown): PendingChatAction {
  const item = record(value, 'pending chat action')
  const status = item.status
  if (status !== 'pending' && status !== 'confirmed' && status !== 'rejected' && status !== 'stale') {
    throw new Error('Invalid pending chat action')
  }
  return {
    id: integer(item.id, 'action id'),
    source_message_id: integer(item.source_message_id, 'source message id'),
    subject_id: string(item.subject_id, 'action subject id'),
    base_definition: nullableString(item.base_definition, 'base definition'),
    proposed_definition: string(item.proposed_definition, 'proposed definition'),
    knowledge_graph_version: nullableString(item.knowledge_graph_version, 'knowledge graph version'),
    status,
    created_at: string(item.created_at, 'action created_at'),
    updated_at: string(item.updated_at, 'action updated_at'),
  }
}

function nullableAction(value: unknown): PendingChatAction | null {
  return value === null || value === undefined ? null : parseAction(value)
}

export function validateChatMessage(value: unknown): ChatMessage {
  const item = record(value, 'chat message')
  const role = item.role
  if (role !== 'user' && role !== 'assistant') throw new Error('Invalid chat message')
  return {
    id: integer(item.id, 'message id'),
    conversation_id: integer(item.conversation_id, 'conversation id'),
    role,
    content: string(item.content, 'message content'),
    context: parseContext(item.context),
    citations: parseCitations(item.citations),
    pending_action: nullableAction(item.pending_action),
    created_at: string(item.created_at, 'message created_at'),
  }
}

export function validateChatConversation(value: unknown): ChatConversation {
  const item = record(value, 'chat conversation')
  return {
    id: integer(item.id, 'conversation id'),
    paper_id: string(item.paper_id, 'conversation paper_id'),
    title: string(item.title, 'conversation title'),
    created_at: string(item.created_at, 'conversation created_at'),
    updated_at: string(item.updated_at, 'conversation updated_at'),
  }
}

function parseStreamEvent(eventName: string, value: unknown): ChatStreamEvent {
  const item = record(value, `chat ${eventName || 'stream'} event`)
  const type = item.type || eventName
  if (type === 'status' && (item.stage === 'retrieval' || item.stage === 'answer')) {
    return { type, stage: item.stage, message: string(item.message, 'status message') }
  }
  if (type === 'final') {
    return {
      type,
      message: validateChatMessage(item.message),
      citations: parseCitations(item.citations),
      pending_action: nullableAction(item.pending_action),
    }
  }
  if (type === 'error') return { type, message: string(item.message, 'error message') }
  throw new Error(`Invalid chat ${eventName || 'stream'} event`)
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

export async function parseChatSse(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<ChatFinalEvent | null> {
  if (signal?.aborted) throw abortError()
  if (!response.body) throw new Error('Chat response has no stream body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalEvent: ChatFinalEvent | null = null
  const cancelReader = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', cancelReader, { once: true })

  const consume = (block: string): void => {
    const lines = block.replace(/\r/g, '').split('\n')
    let eventName = ''
    const data: string[] = []
    for (const line of lines) {
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'event') eventName = value
      if (field === 'data') data.push(value)
    }
    if (data.length === 0) return
    let payload: unknown
    try {
      payload = JSON.parse(data.join('\n'))
    } catch {
      throw new Error(`Invalid chat ${eventName || 'stream'} event JSON`)
    }
    const event = parseStreamEvent(eventName, payload)
    onEvent(event)
    if (event.type === 'final') finalEvent = event
  }

  try {
    while (true) {
      if (signal?.aborted) throw abortError()
      const { value, done } = await reader.read()
      if (signal?.aborted) throw abortError()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.search(/\r?\n\r?\n/)
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n'
        buffer = buffer.slice(boundary + separator.length)
        consume(block)
        boundary = buffer.search(/\r?\n\r?\n/)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer)
    return finalEvent
  } finally {
    signal?.removeEventListener('abort', cancelReader)
    reader.releaseLock()
  }
}

async function apiError(response: Response): Promise<ChatApiError> {
  let message = response.statusText || 'Chat request failed'
  let code: string | undefined
  try {
    const body = record(await response.json(), 'chat error')
    if (typeof body.detail === 'string') message = body.detail
    else if (body.detail) {
      const detail = record(body.detail, 'chat error detail')
      if (typeof detail.message === 'string') message = detail.message
      if (typeof detail.code === 'string') code = detail.code
    }
  } catch {
    // Preserve the status text for non-JSON and malformed error responses.
  }
  return new ChatApiError(message, response.status, code)
}

export class HttpChatApi implements ChatApi {
  constructor(private readonly apiBase = API_BASE) {}

  async listConversations(paperId: string): Promise<ChatConversation[]> {
    const value = await this.json(this.path(paperId, '/conversations'))
    if (!Array.isArray(value)) throw new Error('Invalid chat conversation list')
    return value.map(validateChatConversation)
  }

  async createConversation(paperId: string, title: string): Promise<ChatConversation> {
    return validateChatConversation(await this.json(this.path(paperId, '/conversations'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    }))
  }

  async renameConversation(
    paperId: string,
    conversationId: number,
    title: string,
  ): Promise<ChatConversation> {
    return validateChatConversation(await this.json(this.path(paperId, `/conversations/${conversationId}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    }))
  }

  async deleteConversation(paperId: string, conversationId: number): Promise<void> {
    const response = await fetch(apiUrl(this.path(paperId, `/conversations/${conversationId}`), this.apiBase), {
      method: 'DELETE',
    })
    if (!response.ok) throw await apiError(response)
  }

  async listMessages(paperId: string, conversationId: number): Promise<ChatMessage[]> {
    const value = await this.json(this.path(paperId, `/conversations/${conversationId}/messages`))
    if (!Array.isArray(value)) throw new Error('Invalid chat message list')
    return value.map(validateChatMessage)
  }

  async streamMessage(
    paperId: string,
    conversationId: number,
    request: { content: string; context: ChatContext | null },
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<ChatFinalEvent> {
    const response = await fetch(apiUrl(this.path(paperId, `/conversations/${conversationId}/messages`), this.apiBase), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(request), signal,
    })
    if (!response.ok) throw await apiError(response)
    let streamError: ChatErrorEvent | null = null
    const final = await parseChatSse(response, event => {
      if (event.type === 'error') streamError = event
      onEvent(event)
    }, signal)
    if (streamError) throw new ChatApiError((streamError as ChatErrorEvent).message, 200)
    if (!final) throw new Error('Chat stream ended without a final event')
    return final
  }

  async confirmAction(paperId: string, actionId: number): Promise<ChatActionConfirmation> {
    const item = record(await this.json(this.path(paperId, `/actions/${actionId}/confirm`), {
      method: 'POST',
    }), 'chat action confirmation')
    const tooltip = record(item.tooltip, 'semantic tooltip')
    const subject = record(item.subject, 'semantic subject details')
    return {
      action: parseAction(item.action),
      tooltip: {
        id: string(tooltip.id, 'tooltip id'),
        paper_id: string(tooltip.paper_id, 'tooltip paper_id'),
        dom_node_id: nullableString(tooltip.dom_node_id, 'tooltip dom_node_id'),
        entity_id: nullableString(tooltip.entity_id, 'tooltip entity_id'),
        user_id: string(tooltip.user_id, 'tooltip user_id'),
        target_text: nullableString(tooltip.target_text, 'tooltip target_text'),
        content: string(tooltip.content, 'tooltip content'),
        is_user_override: tooltip.is_user_override === true,
        is_pinned: tooltip.is_pinned === true,
        display_order: tooltip.display_order === null ? null : integer(tooltip.display_order, 'tooltip display_order'),
        created_at: string(tooltip.created_at, 'tooltip created_at'),
        updated_at: string(tooltip.updated_at, 'tooltip updated_at'),
      },
      subject: subject as unknown as SemanticSubjectDetails,
    }
  }

  async rejectAction(paperId: string, actionId: number): Promise<PendingChatAction> {
    return parseAction(await this.json(this.path(paperId, `/actions/${actionId}/reject`), { method: 'POST' }))
  }

  private path(paperId: string, suffix: string): string {
    return `/api/papers/${encodeURIComponent(paperId)}/chat${suffix}`
  }

  private async json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(apiUrl(path, this.apiBase), init)
    if (!response.ok) throw await apiError(response)
    return response.json()
  }
}
