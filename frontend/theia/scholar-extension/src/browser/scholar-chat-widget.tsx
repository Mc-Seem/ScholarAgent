import * as React from 'react'
import { Disposable } from '@theia/core'
import { ConfirmDialog, ReactWidget, SingleTextInputDialog } from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'

import type { ChatCitation, ChatContext, ChatMessage, PendingChatAction } from '../../../../lib/chat-api'
import { ScholarChatService, type ScholarChatSnapshot } from './scholar-chat-service'

export const SCHOLAR_CHAT_WIDGET_ID = 'scholar-agent:chat'

export interface ScholarChatActions {
  selectConversation(id: number): void | Promise<void>
  createConversation(title: string): void | Promise<unknown>
  renameConversation(id: number, title: string): void | Promise<void>
  deleteConversation(id: number): void | Promise<void>
  sendMessage(content: string): void | Promise<void>
  retry(): void | Promise<void>
  cancelStream(): void
  clearNextContext(): void
  confirmAction(id: number): void | Promise<void>
  rejectAction(id: number): void | Promise<void>
  requestCitation(citation: ChatCitation): void
  summarizeCurrentSection(): void | Promise<void>
  closeReadingSetChat(): void | Promise<void>
}

interface ScholarChatViewProps {
  snapshot: ScholarChatSnapshot
  actions: ScholarChatActions
}

function runAction(action: () => void | Promise<unknown>): void {
  try {
    void Promise.resolve(action()).catch(() => undefined)
  } catch {
    // Services expose synchronous failures through their snapshot where possible.
  }
}

function safeHref(href: string): string | undefined {
  return /^(https?:\/\/|#)/i.test(href.trim()) ? href.trim() : undefined
}

function ChatMath({ source, display = false }: { source: string; display?: boolean }): React.ReactNode {
  const containerRef = React.useRef<HTMLSpanElement>(null)

  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.textContent = source
    return () => window.MathJax?.typesetClear?.([container])
  }, [source])

  React.useEffect(() => {
    let cancelled = false
    const typeset = async () => {
      const container = containerRef.current
      if (!container || !window.MathJax?.typesetPromise) return
      try {
        if (window.MathJax.startup?.promise) await window.MathJax.startup.promise
        if (!cancelled && containerRef.current) await window.MathJax.typesetPromise([container])
      } catch {
        // Keep the LaTeX source visible if MathJax cannot typeset this expression.
      }
    }
    const handleReady = () => void typeset()
    void typeset()
    window.addEventListener('MathJaxReady', handleReady)
    return () => {
      cancelled = true
      window.removeEventListener('MathJaxReady', handleReady)
    }
  }, [source])

  return <span ref={containerRef} className={display ? 'scholar-chat-math-display' : 'scholar-chat-math'} />
}

function inlineMarkdown(text: string): React.ReactNode[] {
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|\$\$[^$\n]+\$\$|\$[^$\n]+\$|\\\([^\n]+?\\\))/g
  const nodes: React.ReactNode[] = []
  let start = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > start) nodes.push(text.slice(start, index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={index}>{inlineMarkdown(token.slice(2, -2))}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={index}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('$') || token.startsWith('\\(')) {
      nodes.push(<ChatMath key={index} source={token} display={token.startsWith('$$')} />)
    } else {
      const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const href = parts ? safeHref(parts[2]) : undefined
      nodes.push(href
        ? <a key={index} href={href} target="_blank" rel="noreferrer">{parts?.[1]}</a>
        : token)
    }
    start = index + token.length
  }
  if (start < text.length) nodes.push(text.slice(start))
  return nodes
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  const row = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === '\\' && row[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (row[index] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += row[index]
    }
  }
  cells.push(cell.trim())
  return cells
}

function isTableDivider(cells: string[] | null): boolean {
  return Boolean(cells?.length && cells.every(cell => /^:?-{3,}:?$/.test(cell)))
}

export function SafeChatMarkdown({ content }: { content: string }): React.ReactNode {
  const blocks: React.ReactNode[] = []
  const lines = content.replace(/\r/g, '').split('\n')
  let code: string[] | null = null
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      const text = paragraph.join(' ')
      blocks.push(<p key={`p-${blocks.length}`}>{inlineMarkdown(text)}</p>)
      paragraph = []
    }
  }
  const flushList = () => {
    if (list.length) {
      blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((item, index) =>
        <li key={index}>{inlineMarkdown(item)}</li>)}</ul>)
      list = []
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push(<pre key={`pre-${blocks.length}`}><code>{code.join('\n')}</code></pre>)
        code = null
      } else {
        flushParagraph()
        flushList()
        code = []
      }
      continue
    }
    if (code) {
      code.push(line)
      continue
    }
    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      const quotedLines = [quote[1]]
      while (lineIndex + 1 < lines.length) {
        const nextQuote = lines[lineIndex + 1].match(/^\s*>\s?(.*)$/)
        if (!nextQuote) break
        quotedLines.push(nextQuote[1])
        lineIndex += 1
      }
      blocks.push(
        <blockquote key={`quote-${blocks.length}`}>
          {inlineMarkdown(quotedLines.join(' '))}
        </blockquote>,
      )
      continue
    }
    const headerCells = tableCells(line)
    const dividerCells = tableCells(lines[lineIndex + 1] ?? '')
    if (headerCells && isTableDivider(dividerCells) && headerCells.length === dividerCells?.length) {
      flushParagraph()
      flushList()
      const rows: string[][] = []
      lineIndex += 2
      while (lineIndex < lines.length) {
        const cells = tableCells(lines[lineIndex])
        if (!cells || cells.length !== headerCells.length) break
        rows.push(cells)
        lineIndex += 1
      }
      lineIndex -= 1
      blocks.push(
        <div className="scholar-chat-table-scroll" key={`table-${blocks.length}`}>
          <table>
            <thead><tr>{headerCells.map((cell, index) =>
              <th key={index}>{inlineMarkdown(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) =>
              <tr key={rowIndex}>{row.map((cell, cellIndex) =>
                <td key={cellIndex}>{inlineMarkdown(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    const displayMath = line.trim().match(/^\$\$(.+)\$\$$|^\\\[(.+)\\\]$/)
    if (displayMath) {
      flushParagraph()
      flushList()
      blocks.push(<ChatMath
        key={`math-${blocks.length}`}
        source={line.trim()}
        display
      />)
      continue
    }
    const mathDelimiter = line.trim() === '$$' ? '$$' : line.trim() === '\\[' ? '\\]' : null
    if (mathDelimiter) {
      const closingIndex = lines.findIndex((candidate, index) =>
        index > lineIndex && candidate.trim() === mathDelimiter)
      if (closingIndex > lineIndex) {
        flushParagraph()
        flushList()
        const closingDelimiter = mathDelimiter === '$$' ? '$$' : '\\]'
        const source = `${line.trim()}\n${lines.slice(lineIndex + 1, closingIndex).join('\n')}\n${closingDelimiter}`
        blocks.push(<ChatMath key={`math-${blocks.length}`} source={source} display />)
        lineIndex = closingIndex
        continue
      }
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const text = inlineMarkdown(heading[2])
      blocks.push(heading[1].length === 1
        ? <h3 key={`h-${blocks.length}`}>{text}</h3>
        : <h4 key={`h-${blocks.length}`}>{text}</h4>)
      continue
    }
    const item = line.match(/^\s*[-*]\s+(.+)$/)
    if (item) {
      flushParagraph()
      list.push(item[1])
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  }
  if (code) blocks.push(<pre key={`pre-${blocks.length}`}><code>{code.join('\n')}</code></pre>)
  flushParagraph()
  flushList()
  return <div className="scholar-chat-markdown">{blocks}</div>
}

function contextLabel(context: ChatContext): string {
  if (context.kind === 'selection') return `Selection: ${context.quote}`
  if (context.kind === 'section') return `Section: ${context.label || context.section_id}`
  return `Entity: ${context.label || context.subject_id}`
}

function AttachedEvidence({ context }: { context: ChatContext }): React.ReactNode {
  const label = contextLabel(context)
  return (
    <div className="scholar-chat-attached-evidence">
      <span className="scholar-chat-attached-evidence-label">Attached evidence</span>
      <span className="scholar-chat-attached-evidence-value" title={label}>
        <span className="codicon codicon-link" aria-hidden="true" />
        <span>{label}</span>
      </span>
    </div>
  )
}

function ChatSubmitIcon({ stop = false }: { stop?: boolean }): React.ReactNode {
  return (
    <svg
      className="scholar-chat-submit-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {stop
        ? <path d="M5 5h6v6H5z" />
        : <path d="M8 2.5 3.75 6.75l1.06 1.06L7.25 5.37V13.5h1.5V5.37l2.44 2.44 1.06-1.06z" />}
    </svg>
  )
}

function CitationChip({ citation, paperTitle, onClick }: {
  citation: ChatCitation
  paperTitle?: string
  onClick: (citation: ChatCitation) => void
}): React.ReactNode {
  const quoteTitle = citation.kind === 'quote' && citation.quote
    ? `“${citation.quote}”`
    : `${citation.kind}: ${citation.label}`
  const title = paperTitle ? `${paperTitle} — ${quoteTitle}` : quoteTitle
  return (
    <button
      type="button"
      className={`scholar-chat-citation scholar-chat-citation-${citation.kind}`}
      title={title}
      onClick={() => onClick(citation)}
    >
      <span className="codicon codicon-link" aria-hidden="true" />
      {paperTitle && <span className="scholar-chat-citation-paper">{paperTitle}</span>}
      {citation.label}
    </button>
  )
}

function AddEntityAction({ action, busy, actions }: {
  action: PendingChatAction
  busy: boolean
  actions: ScholarChatActions
}): React.ReactNode {
  const payloadLabel = action.payload?.label
  const label = typeof payloadLabel === 'string' ? payloadLabel : action.subject_id ?? ''
  const payloadKind = action.payload?.kind
  const kind = typeof payloadKind === 'string' ? payloadKind : null
  return (
    <section className={`scholar-chat-definition scholar-chat-definition-${action.status}`}>
      <strong>Entity proposal</strong>
      <div className="scholar-chat-definition-row">
        <span>Entity</span>
        <p>{kind ? `Add “${label}” as a ${kind} entity` : `Add “${label}”`}</p>
      </div>
      <div className="scholar-chat-definition-row scholar-chat-definition-proposed">
        <span>Definition</span>
        <p>{action.proposed_definition}</p>
      </div>
      {action.status === 'pending' ? (
        <div className="scholar-chat-definition-actions">
          <button
            type="button"
            className="theia-button"
            disabled={busy}
            aria-label="Confirm entity addition"
            onClick={() => runAction(() => actions.confirmAction(action.id))}
          >Confirm</button>
          <button
            type="button"
            className="theia-button secondary"
            disabled={busy}
            aria-label="Reject entity addition"
            onClick={() => runAction(() => actions.rejectAction(action.id))}
          >Reject</button>
        </div>
      ) : <span className="scholar-chat-action-status">{action.status}</span>}
    </section>
  )
}

function AnnotateEntityAction({ action, busy, actions }: {
  action: PendingChatAction
  busy: boolean
  actions: ScholarChatActions
}): React.ReactNode {
  const payloadLabel = action.payload?.label
  const label = typeof payloadLabel === 'string' ? payloadLabel : action.subject_id ?? ''
  const payloadCount = action.payload?.occurrence_count
  const count = typeof payloadCount === 'number' ? payloadCount : null
  return (
    <section className={`scholar-chat-definition scholar-chat-definition-${action.status}`}>
      <strong>Highlight proposal</strong>
      <div className="scholar-chat-definition-row">
        <span>Entity</span>
        <p>{count !== null ? `Highlight “${label}” (${count} occurrences)` : `Highlight “${label}”`}</p>
      </div>
      <div className="scholar-chat-definition-row scholar-chat-definition-proposed">
        <span>Definition</span>
        <p>{action.proposed_definition}</p>
      </div>
      {action.status === 'pending' ? (
        <div className="scholar-chat-definition-actions">
          <button
            type="button"
            className="theia-button"
            disabled={busy}
            aria-label="Confirm highlight"
            onClick={() => runAction(() => actions.confirmAction(action.id))}
          >Confirm</button>
          <button
            type="button"
            className="theia-button secondary"
            disabled={busy}
            aria-label="Reject highlight"
            onClick={() => runAction(() => actions.rejectAction(action.id))}
          >Reject</button>
        </div>
      ) : <span className="scholar-chat-action-status">{action.status}</span>}
    </section>
  )
}

function DefinitionAction({ action, busy, actions }: {
  action: PendingChatAction
  busy: boolean
  actions: ScholarChatActions
}): React.ReactNode {
  if (action.action_type === 'add_entity') {
    return <AddEntityAction action={action} busy={busy} actions={actions} />
  }
  if (action.action_type === 'annotate_entity') {
    return <AnnotateEntityAction action={action} busy={busy} actions={actions} />
  }
  return (
    <section className={`scholar-chat-definition scholar-chat-definition-${action.status}`}>
      <strong>Definition proposal</strong>
      <div className="scholar-chat-definition-row">
        <span>Current</span>
        <p>{action.base_definition || 'No current definition'}</p>
      </div>
      <div className="scholar-chat-definition-row scholar-chat-definition-proposed">
        <span>Proposed</span>
        <p>{action.proposed_definition}</p>
      </div>
      {action.status === 'pending' ? (
        <div className="scholar-chat-definition-actions">
          <button
            type="button"
            className="theia-button"
            disabled={busy}
            aria-label="Confirm definition"
            onClick={() => runAction(() => actions.confirmAction(action.id))}
          >Confirm</button>
          <button
            type="button"
            className="theia-button secondary"
            disabled={busy}
            aria-label="Reject definition"
            onClick={() => runAction(() => actions.rejectAction(action.id))}
          >Reject</button>
        </div>
      ) : <span className="scholar-chat-action-status">{action.status}</span>}
    </section>
  )
}

function TranscriptMessage({ message, snapshot, actions }: {
  message: ChatMessage
  snapshot: ScholarChatSnapshot
  actions: ScholarChatActions
}): React.ReactNode {
  return (
    <article className={`scholar-chat-message scholar-chat-message-${message.role}`}>
      <div className="scholar-chat-message-role">{message.role === 'user' ? 'You' : 'Chat'}</div>
      {message.role === 'user' && message.context && <AttachedEvidence context={message.context} />}
      <SafeChatMarkdown content={message.content} />
      {message.citations.length > 0 && (
        <div className="scholar-chat-citations">
          {message.citations.map((citation, index) => (
            <CitationChip
              key={`${citation.kind}-${citation.source_id || citation.section_id || citation.subject_id}-${index}`}
              citation={citation}
              paperTitle={citation.paper_id
                ? snapshot.readingSet?.paperTitles[citation.paper_id]
                : undefined}
              onClick={actions.requestCitation}
            />
          ))}
        </div>
      )}
      {message.pending_action && (
        <DefinitionAction
          action={message.pending_action}
          busy={snapshot.actionBusyId === message.pending_action.id}
          actions={actions}
        />
      )}
    </article>
  )
}

export function ScholarChatView({ snapshot, actions }: ScholarChatViewProps): React.ReactNode {
  const [draft, setDraft] = React.useState('')
  const activeConversation = snapshot.conversations.find(item => item.id === snapshot.activeConversationId)

  if (!snapshot.activePaperId && !snapshot.readingSet) {
    return <div className="scholar-chat-empty theia-widget-noInfo">Open a paper to start a grounded chat.</div>
  }

  const create = async () => {
    const title = await new SingleTextInputDialog({
      title: 'New conversation',
      initialValue: 'New conversation',
      confirmButtonLabel: 'Create',
      validate: value => value.trim() ? '' : 'Enter a conversation name.',
    }).open()
    if (title?.trim()) await actions.createConversation(title.trim())
  }
  const rename = async () => {
    if (!activeConversation) return
    const title = await new SingleTextInputDialog({
      title: 'Rename conversation',
      initialValue: activeConversation.title,
      confirmButtonLabel: 'Rename',
      validate: value => value.trim() ? '' : 'Enter a conversation name.',
    }).open()
    if (title?.trim()) await actions.renameConversation(activeConversation.id, title.trim())
  }
  const remove = async () => {
    if (!activeConversation) return
    const confirmed = await new ConfirmDialog({
      title: 'Delete conversation',
      msg: `Delete “${activeConversation.title}”?`,
      ok: 'Delete',
    }).open()
    if (confirmed) await actions.deleteConversation(activeConversation.id)
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || snapshot.streaming) return
    setDraft('')
    runAction(() => actions.sendMessage(content))
  }

  return (
    <div className="scholar-chat-view">
      {snapshot.readingSet && (
        <div className="scholar-chat-scope" title={`Reading set: ${snapshot.readingSet.name}`}>
          <span className="codicon codicon-folder-library" aria-hidden="true" />
          <span className="scholar-chat-scope-name">{snapshot.readingSet.name}</span>
          <button
            type="button"
            className="scholar-chat-icon"
            aria-label="Close reading set chat"
            title="Back to the active paper's chat"
            onClick={() => runAction(actions.closeReadingSetChat)}
          >
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      )}
      <header className="scholar-chat-header">
        <select
          className="theia-select"
          aria-label="Conversation"
          value={snapshot.activeConversationId ?? ''}
          disabled={snapshot.streaming}
          onChange={event => runAction(() => actions.selectConversation(Number(event.target.value)))}
        >
          {snapshot.conversations.length === 0 && <option value="">No conversations</option>}
          {snapshot.conversations.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button type="button" className="scholar-chat-icon" aria-label="New conversation" onClick={create}>
          <span className="codicon codicon-add" aria-hidden="true" />
        </button>
        <button type="button" className="scholar-chat-icon" aria-label="Rename conversation" disabled={!activeConversation} onClick={rename}>
          <span className="codicon codicon-edit" aria-hidden="true" />
        </button>
        <button type="button" className="scholar-chat-icon" aria-label="Delete conversation" disabled={!activeConversation} onClick={remove}>
          <span className="codicon codicon-trash" aria-hidden="true" />
        </button>
      </header>

      <div className="scholar-chat-transcript" aria-live="polite">
        {snapshot.loading ? (
          <div className="scholar-chat-empty">Loading conversations…</div>
        ) : snapshot.messages.length === 0 ? (
          <div className="scholar-chat-empty">
            {snapshot.readingSet
              ? 'Ask a question about the papers in this reading set.'
              : 'Ask a question about the active paper.'}
          </div>
        ) : snapshot.messages.map(message => (
          <TranscriptMessage key={message.id} message={message} snapshot={snapshot} actions={actions} />
        ))}
        {snapshot.status && <div className="scholar-chat-progress"><span className="codicon codicon-loading codicon-modifier-spin" />{snapshot.status}</div>}
        {snapshot.error && (
          <div className="scholar-chat-error" role="alert">
            <span>{snapshot.error}</span>
            {snapshot.retryContent && <button type="button" className="theia-button" onClick={() => runAction(actions.retry)}>Retry</button>}
          </div>
        )}
      </div>

      <form className="scholar-chat-composer" onSubmit={submit}>
        {snapshot.currentSection && (
          <button
            type="button"
            className="scholar-chat-section-summary"
            disabled={snapshot.streaming}
            onClick={() => runAction(actions.summarizeCurrentSection)}
          >Кратко пересказать текущую секцию</button>
        )}
        {snapshot.nextContext && (
          <div className="scholar-chat-context-chip" title={contextLabel(snapshot.nextContext)}>
            <span>{contextLabel(snapshot.nextContext)}</span>
            <button type="button" aria-label="Remove context" onClick={actions.clearNextContext}>×</button>
          </div>
        )}
        <div className="scholar-chat-input">
          <textarea
            className="theia-input"
            aria-label="Message"
            value={draft}
            rows={3}
            maxLength={20_000}
            disabled={snapshot.streaming}
            placeholder={snapshot.readingSet ? 'Ask about the papers in this set…' : 'Ask about this paper…'}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          {snapshot.streaming ? (
            <button type="button" className="scholar-chat-submit" aria-label="Stop" title="Stop" onClick={actions.cancelStream}>
              <ChatSubmitIcon stop />
            </button>
          ) : (
            <button type="submit" className="scholar-chat-submit" aria-label="Send" title="Send" disabled={!draft.trim()}>
              <ChatSubmitIcon />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

@injectable()
export class ScholarChatWidget extends ReactWidget {
  private readonly actions: ScholarChatActions

  constructor(@inject(ScholarChatService) private readonly chat: ScholarChatService) {
    super()
    this.id = SCHOLAR_CHAT_WIDGET_ID
    this.title.label = 'Chat'
    this.title.caption = 'Grounded chat for the active paper'
    this.title.iconClass = 'codicon codicon-comment-discussion'
    this.title.closable = true
    this.node.classList.add('scholar-widget', 'scholar-side-widget', 'scholar-chat-widget')
    this.actions = {
      selectConversation: id => this.chat.selectConversation(id),
      createConversation: title => this.chat.createConversation(title),
      renameConversation: (id, title) => this.chat.renameConversation(id, title),
      deleteConversation: id => this.chat.deleteConversation(id),
      sendMessage: content => this.chat.sendMessage(content),
      retry: () => this.chat.retry(),
      cancelStream: () => this.chat.cancelStream(),
      clearNextContext: () => this.chat.clearNextContext(),
      confirmAction: id => this.chat.confirmAction(id),
      rejectAction: id => this.chat.rejectAction(id),
      requestCitation: citation => this.chat.requestCitation(citation),
      summarizeCurrentSection: () => this.chat.summarizeCurrentSection(),
      closeReadingSetChat: () => this.chat.closeReadingSetChat(),
    }
    this.toDispose.push(Disposable.create(this.chat.subscribe(() => this.update())))
    void this.chat.initialize().finally(() => this.update())
    this.update()
  }

  protected override render(): React.ReactNode {
    return <ScholarChatView snapshot={this.chat.getSnapshot()} actions={this.actions} />
  }
}
