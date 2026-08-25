import fs from 'node:fs'
import path from 'node:path'

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ScholarChatSnapshot } from '@/theia/scholar-extension/src/browser/scholar-chat-service'
import type { ScholarChatView as ScholarChatViewType } from '@/theia/scholar-extension/src/browser/scholar-chat-widget'

const css = fs.readFileSync(
  path.resolve(process.cwd(), 'theia/scholar-extension/src/browser/style/scholar.css'),
  'utf8',
)

const confirmDialogOpen = vi.fn<() => Promise<boolean | undefined>>()
const singleTextInputDialogOpen = vi.fn<() => Promise<string | undefined>>()

vi.mock('@theia/core/lib/browser', async () => {
  const actual = await vi.importActual<typeof import('@theia/core/lib/browser')>(
    '@theia/core/lib/browser',
  )
  return {
    ...actual,
    ConfirmDialog: vi.fn().mockImplementation(function ConfirmDialog() {
      return { open: confirmDialogOpen }
    }),
    SingleTextInputDialog: vi.fn().mockImplementation(function SingleTextInputDialog() {
      return { open: singleTextInputDialogOpen }
    }),
  }
})

let ScholarChatView: typeof ScholarChatViewType

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarChatView } = await import(
    '@/theia/scholar-extension/src/browser/scholar-chat-widget'
  ))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
  delete (window as typeof window & { MathJax?: object }).MathJax
})

function snapshot(overrides: Partial<ScholarChatSnapshot> = {}): ScholarChatSnapshot {
  return {
    activePaperId: 'paper-a',
    conversations: [{
      id: 1, paper_id: 'paper-a', title: 'Main',
      created_at: '2026-08-23T20:00:00Z', updated_at: '2026-08-23T20:00:00Z',
    }],
    activeConversationId: 1,
    messages: [], loading: false, streaming: false, status: null, error: null,
    nextContext: null, currentSection: null, retryContent: null, actionBusyId: null,
    ...overrides,
  }
}

function actions() {
  return {
    selectConversation: vi.fn(), createConversation: vi.fn(), renameConversation: vi.fn(),
    deleteConversation: vi.fn(), sendMessage: vi.fn(), retry: vi.fn(), cancelStream: vi.fn(),
    clearNextContext: vi.fn(), confirmAction: vi.fn(), rejectAction: vi.fn(),
    requestCitation: vi.fn(), summarizeCurrentSection: vi.fn(),
  }
}

describe('ScholarChatView', () => {
  it('shows active-paper empty and progress/error states', () => {
    const { rerender } = render(<ScholarChatView snapshot={snapshot({ activePaperId: null })} actions={actions()} />)
    expect(screen.getByText(/Open a paper/)).toBeInTheDocument()
    rerender(<ScholarChatView snapshot={snapshot({ loading: true })} actions={actions()} />)
    expect(screen.getByText('Loading conversations…')).toBeInTheDocument()
    rerender(<ScholarChatView snapshot={snapshot({ error: 'Provider failed', retryContent: 'Question' })} actions={actions()} />)
    expect(screen.getByText('Provider failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('renders escaped markdown, citation chips, and pending definition actions', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    render(<ScholarChatView snapshot={snapshot({ messages: [{
      id: 4, conversation_id: 1, role: 'assistant',
      content: '**Result**\n<script>alert(1)</script>', context: null,
      citations: [{ kind: 'quote', label: 'Evidence', source_id: 'p-1', quote: 'exact phrase' }],
      pending_action: {
        id: 8, source_message_id: 4, subject_id: 'object:x', base_definition: 'Old',
        proposed_definition: 'New', knowledge_graph_version: 'v1', status: 'pending',
        created_at: '2026-08-23T20:00:00Z', updated_at: '2026-08-23T20:00:00Z',
      }, created_at: '2026-08-23T20:00:00Z',
    }] })} actions={handlers} />)
    expect(screen.getByText('Result', { selector: 'strong' })).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Evidence' }))
    expect(handlers.requestCitation).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm definition' }))
    expect(handlers.confirmAction).toHaveBeenCalledWith(8)
    await user.click(screen.getByRole('button', { name: 'Reject definition' }))
    expect(handlers.rejectAction).toHaveBeenCalledWith(8)
  })

  it('renders markdown tables and typesets inline and display LaTeX', async () => {
    const typesetPromise = vi.fn().mockResolvedValue(undefined)
    const typesetClear = vi.fn()
    ;(window as typeof window & { MathJax?: object }).MathJax = {
      typesetPromise,
      typesetClear,
    }

    render(<ScholarChatView snapshot={snapshot({ messages: [{
      id: 5, conversation_id: 1, role: 'assistant',
      content: [
        '| Method | Objective |',
        '| --- | --- |',
        '| DPO | $\\log \\sigma(x)$ |',
        '',
        '$$',
        'J(\\theta) = \\mathbb{E}[r]',
        '$$',
      ].join('\n'),
      context: null, citations: [], pending_action: null,
      created_at: '2026-08-23T20:00:00Z',
    }] })} actions={actions()} />)

    expect(screen.getByRole('columnheader', { name: 'Method' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'DPO' })).toBeInTheDocument()
    await vi.waitFor(() => expect(typesetPromise).toHaveBeenCalledTimes(2))
    expect(typesetPromise.mock.calls.every(([elements]) => elements.length === 1)).toBe(true)
  })

  it('allows horizontal but not vertical scrolling for display LaTeX', () => {
    const displayMath = css.match(/\.scholar-chat-math-display \{[^}]*\}/)?.[0] ?? ''

    expect(displayMath).toMatch(/overflow-x: auto;/)
    expect(displayMath).toMatch(/overflow-y: hidden;/)
  })

  it('renders consecutive markdown quote lines as a blockquote', () => {
    render(<ScholarChatView snapshot={snapshot({ messages: [{
      id: 6, conversation_id: 1, role: 'assistant',
      content: '> First quoted line\n> Second **important** line',
      context: null, citations: [], pending_action: null,
      created_at: '2026-08-23T20:00:00Z',
    }] })} actions={actions()} />)

    const quote = screen.getByText(/First quoted line/).closest('blockquote')
    expect(quote).toHaveTextContent('First quoted line Second important line')
    expect(quote?.querySelector('strong')).toHaveTextContent('important')
  })

  it('shows the evidence attached to persisted user messages', () => {
    render(<ScholarChatView snapshot={snapshot({ messages: [
      {
        id: 7, conversation_id: 1, role: 'user', content: 'Change the definition',
        context: {
          kind: 'entity', subject_id: 'artifact:simpo', data_id: 'p-1', label: 'SimPO',
        },
        citations: [], pending_action: null, created_at: '2026-08-23T20:00:00Z',
      },
      {
        id: 8, conversation_id: 1, role: 'user', content: 'Explain this',
        context: { kind: 'selection', data_id: 'p-2', quote: 'exact selected phrase' },
        citations: [], pending_action: null, created_at: '2026-08-23T20:01:00Z',
      },
    ] })} actions={actions()} />)

    expect(screen.getAllByText('Attached evidence')).toHaveLength(2)
    expect(screen.getByText('Entity: SimPO').closest('.scholar-chat-attached-evidence-value'))
      .toHaveAttribute('title', 'Entity: SimPO')
    expect(screen.getByText('Selection: exact selected phrase').closest('.scholar-chat-attached-evidence-value')).toHaveAttribute(
      'title',
      'Selection: exact selected phrase',
    )
  })

  it('submits composer text and disables it while streaming', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    const { rerender } = render(<ScholarChatView snapshot={snapshot()} actions={handlers} />)
    const message = screen.getByLabelText('Message')
    const send = screen.getByRole('button', { name: 'Send' })
    expect(message).toHaveClass('theia-input')
    expect(message.parentElement).toHaveClass('scholar-chat-input')
    expect(send.parentElement).toBe(message.parentElement)
    expect(send).toHaveClass('scholar-chat-submit')
    expect(send.querySelector('svg')).toHaveClass('scholar-chat-submit-icon')
    expect(send.querySelector('.codicon')).toBeNull()
    await user.type(message, 'Explain the result')
    await user.click(send)
    expect(handlers.sendMessage).toHaveBeenCalledWith('Explain the result')
    rerender(<ScholarChatView snapshot={snapshot({ streaming: true, status: 'Searching' })} actions={handlers} />)
    expect(screen.getByText('Searching')).toBeInTheDocument()
    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(stop).toHaveClass('scholar-chat-submit')
    expect(stop.querySelector('svg')).toHaveClass('scholar-chat-submit-icon')
  })

  it('shows selection context and summarizes the current section', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    render(<ScholarChatView snapshot={snapshot({
      nextContext: { kind: 'selection', data_id: 'p-1', quote: 'selected phrase' },
      currentSection: { kind: 'section', section_id: 'sec-2', data_id: 'sec-2' },
    })} actions={handlers} />)

    expect(screen.getByText('Selection: selected phrase')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Кратко пересказать текущую секцию' }))
    expect(handlers.summarizeCurrentSection).toHaveBeenCalledOnce()
  })

  it('supports conversation create, rename, select, and delete controls', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    singleTextInputDialogOpen
      .mockResolvedValueOnce('Second conversation')
      .mockResolvedValueOnce('Renamed conversation')
    confirmDialogOpen.mockResolvedValueOnce(true)
    render(<ScholarChatView snapshot={snapshot({ conversations: [
      ...snapshot().conversations,
      {
        id: 2, paper_id: 'paper-a', title: 'Other',
        created_at: '2026-08-23T20:00:00Z', updated_at: '2026-08-23T20:00:00Z',
      },
    ] })} actions={handlers} />)
    expect(screen.getByLabelText('Conversation')).toHaveClass('theia-select')
    await user.click(screen.getByRole('button', { name: 'New conversation' }))
    await vi.waitFor(() => expect(handlers.createConversation).toHaveBeenCalledWith('Second conversation'))
    await user.click(screen.getByRole('button', { name: 'Rename conversation' }))
    await vi.waitFor(() => expect(handlers.renameConversation).toHaveBeenCalledWith(1, 'Renamed conversation'))
    await user.selectOptions(screen.getByLabelText('Conversation'), '2')
    expect(handlers.selectConversation).toHaveBeenCalledWith(2)
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await vi.waitFor(() => expect(handlers.deleteConversation).toHaveBeenCalledWith(1))
  })
})
