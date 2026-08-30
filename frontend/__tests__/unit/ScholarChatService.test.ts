import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ChatApi, ChatConversation, ChatMessage } from '@/lib/chat-api'
import type { ReadingSet } from '@/lib/reading-set-api'
import type { ScholarChatService as ScholarChatServiceClass } from '@/theia/scholar-extension/src/browser/scholar-chat-service'

let ScholarChatService: typeof ScholarChatServiceClass

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarChatService } = await import(
    '@/theia/scholar-extension/src/browser/scholar-chat-service'
  ))
})

function conversation(id: number, paperId = 'paper-a'): ChatConversation {
  return {
    id,
    paper_id: paperId,
    title: `Conversation ${id}`,
    created_at: '2026-08-23T20:00:00Z',
    updated_at: '2026-08-23T20:00:00Z',
  }
}

function message(id: number, role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id,
    conversation_id: 1,
    role,
    content,
    context: null,
    citations: [],
    pending_action: null,
    created_at: '2026-08-23T20:00:00Z',
  }
}

function setup() {
  let workspaceListener: (() => void) | undefined
  const workspace = {
    getSnapshot: vi.fn(() => ({ activePaperId: 'paper-a' as string | null })),
    subscribe: vi.fn((listener: () => void) => {
      workspaceListener = listener
      return () => undefined
    }),
    refreshPaper: vi.fn().mockResolvedValue({}),
    refreshTooltips: vi.fn().mockResolvedValue([]),
    setActiveEntity: vi.fn(),
    setSemanticSelection: vi.fn(),
  }
  const selectionService = { selection: undefined as unknown }
  const api: ChatApi = {
    listConversations: vi.fn().mockResolvedValue([conversation(1)]),
    createConversation: vi.fn().mockResolvedValue(conversation(2)),
    renameConversation: vi.fn().mockImplementation(async (_paper, id, title) => ({
      ...conversation(id), title,
    })),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    listMessages: vi.fn().mockResolvedValue([message(1, 'user', 'Hello')]),
    streamMessage: vi.fn().mockImplementation(async (_paper, _conversation, _request, onEvent) => {
      onEvent({ type: 'status', stage: 'retrieval', message: 'Searching' })
      const final = {
        type: 'final' as const,
        message: message(2, 'assistant', 'Answer'),
        citations: [],
        pending_action: null,
      }
      onEvent(final)
      return final
    }),
    confirmAction: vi.fn(),
    rejectAction: vi.fn(),
  }
  const citations = { openPaper: vi.fn().mockResolvedValue(undefined) }
  const service = new ScholarChatService(
    api, workspace as never, selectionService as never, citations as never,
  )
  return { api, service, workspace, selectionService, citations, notifyWorkspace: () => workspaceListener?.() }
}

function readingSet(): ReadingSet {
  return {
    id: 'set-1',
    name: 'Preference Optimization',
    created_at: '2026-08-29T10:00:00Z',
    updated_at: '2026-08-29T10:00:00Z',
    papers: [
      {
        id: 'paper-a', filename: 'paper-a.tar.gz', arxiv_id: null, title: 'Paper Alpha',
        has_html: true, has_knowledge_graph: true, added_at: '2026-08-29T10:00:00Z',
      },
      {
        id: 'paper-b', filename: 'paper-b.tar.gz', arxiv_id: null, title: 'Paper Beta',
        has_html: true, has_knowledge_graph: false, added_at: '2026-08-29T10:00:00Z',
      },
    ],
  }
}

describe('ScholarChatService', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })
  it('loads persisted conversations and ordered history for the active paper', async () => {
    const { api, service } = setup()
    await service.initialize()
    expect(api.listConversations).toHaveBeenCalledWith('paper-a')
    expect(api.listMessages).toHaveBeenCalledWith('paper-a', 1)
    expect(service.getSnapshot()).toMatchObject({
      activePaperId: 'paper-a', activeConversationId: 1, loading: false,
    })
  })

  it('creates, renames, deletes conversations and streams a grounded response', async () => {
    const { api, service } = setup()
    await service.initialize()
    await service.createConversation('Research notes')
    expect(api.createConversation).toHaveBeenCalledWith('paper-a', 'Research notes')
    await service.renameConversation(2, 'Renamed')
    expect(service.getSnapshot().conversations[0].title).toBe('Renamed')
    await service.sendMessage('What is the method?')
    expect(api.streamMessage).toHaveBeenCalled()
    expect(service.getSnapshot()).toMatchObject({ streaming: false, status: null, error: null })
    await service.deleteConversation(2)
    expect(api.deleteConversation).toHaveBeenCalledWith('paper-a', 2)
  })

  it('creates a titled persisted conversation when sending from an empty or deleted chat', async () => {
    const { api, service } = setup()
    vi.mocked(api.listConversations)
      .mockResolvedValueOnce([])
      .mockResolvedValue([conversation(2)])
    vi.mocked(api.createConversation)
      .mockResolvedValueOnce(conversation(2))
      .mockResolvedValueOnce(conversation(3))

    await service.initialize()
    await service.sendMessage('  Explain   the main result  ')
    expect(api.createConversation).toHaveBeenNthCalledWith(1, 'paper-a', 'Explain the main result')
    expect(api.streamMessage).toHaveBeenCalledWith(
      'paper-a', 2, expect.any(Object), expect.any(Function), expect.any(AbortSignal),
    )

    await service.deleteConversation(2)
    expect(service.getSnapshot().activeConversationId).toBeNull()
    await service.sendMessage('Start again')
    expect(api.createConversation).toHaveBeenNthCalledWith(2, 'paper-a', 'Start again')
    expect(api.streamMessage).toHaveBeenLastCalledWith(
      'paper-a', 3, expect.any(Object), expect.any(Function), expect.any(AbortSignal),
    )
  })

  it('uses one-shot context and cancels an active stream when the paper changes', async () => {
    const { api, service, workspace, notifyWorkspace } = setup()
    await service.initialize()
    service.setNextContext({ kind: 'selection', data_id: 'p-1', quote: 'selected text' })
    await service.sendMessage('Explain this')
    expect(api.streamMessage).toHaveBeenCalledWith(
      'paper-a', 1,
      { content: 'Explain this', context: { kind: 'selection', data_id: 'p-1', quote: 'selected text' } },
      expect.any(Function), expect.any(AbortSignal),
    )
    expect(service.getSnapshot().nextContext).toBeNull()

    workspace.getSnapshot.mockReturnValue({ activePaperId: 'paper-b' })
    notifyWorkspace()
    await vi.waitFor(() => expect(api.listConversations).toHaveBeenCalledWith('paper-b'))
    expect(service.getSnapshot().activePaperId).toBe('paper-b')
  })

  it('reuses one-shot context when retrying a failed stream', async () => {
    const { api, service } = setup()
    vi.mocked(api.streamMessage).mockRejectedValueOnce(new Error('Provider failed'))
    const context = {
      kind: 'entity' as const,
      subject_id: 'topic:grpo',
      data_id: 'p-grpo',
      label: 'GRPO',
    }

    await service.initialize()
    service.setNextContext(context)
    await service.sendMessage('Make this definition more specific')
    await service.retry()

    expect(api.streamMessage).toHaveBeenNthCalledWith(
      2, 'paper-a', 1,
      { content: 'Make this definition more specific', context },
      expect.any(Function), expect.any(AbortSignal),
    )
  })

  it('tracks the visible section and sends the section summary as one-shot context', async () => {
    const { api, service } = setup()
    await service.initialize()
    service.setCurrentSection('paper-a', 'sec-2')
    expect(service.getSnapshot().currentSection).toEqual({
      kind: 'section', section_id: 'sec-2', data_id: 'sec-2',
    })

    await service.summarizeCurrentSection()
    expect(api.streamMessage).toHaveBeenCalledWith(
      'paper-a', 1,
      { content: 'Кратко перескажи текущую секцию.', context: {
        kind: 'section', section_id: 'sec-2', data_id: 'sec-2',
      } },
      expect.any(Function), expect.any(AbortSignal),
    )
    expect(service.getSnapshot().nextContext).toBeNull()
  })

  it('navigates quote citations and reveals entity citations through graph selection', async () => {
    vi.useFakeTimers()
    const { service, workspace, selectionService } = setup()
    await service.initialize()
    document.body.innerHTML = `
      <div data-scholar-paper-id="paper-a">
        <section data-id="sec-1"><p data-id="p-1">The exact supporting phrase is here.</p></section>
      </div>`
    const target = document.querySelector<HTMLElement>('[data-id="p-1"]')!
    const section = document.querySelector<HTMLElement>('[data-id="sec-1"]')!
    target.scrollIntoView = vi.fn()
    section.scrollIntoView = vi.fn()

    service.requestCitation({
      kind: 'quote', label: 'Evidence', source_id: 'p-1', quote: 'exact supporting phrase',
    })
    expect(target.scrollIntoView).toHaveBeenCalled()
    expect(target.querySelector('mark.scholar-chat-quote-highlight')?.textContent)
      .toBe('exact supporting phrase')

    service.requestCitation({ kind: 'section', label: 'Methods', section_id: 'sec-1' })
    expect(section.scrollIntoView).toHaveBeenCalled()

    service.requestCitation({ kind: 'entity', label: 'Attention', subject_id: 'object:attention' })
    expect(workspace.setActiveEntity).toHaveBeenCalledWith('paper-a', 'object:attention')
    expect(workspace.setSemanticSelection).toHaveBeenCalledWith(
      'paper-a', expect.objectContaining({ kind: 'node', id: 'object:attention' }),
    )
    expect(selectionService.selection).toEqual(expect.objectContaining({
      paperId: 'paper-a',
      payload: expect.objectContaining({ kind: 'node', id: 'object:attention' }),
    }))
  })

  it('confirms and rejects pending definition actions and refreshes semantic notes', async () => {
    const { api, service, workspace, selectionService } = setup()
    const pending = {
      id: 8, source_message_id: 2, action_type: 'redefine' as const, subject_id: 'object:x',
      base_definition: 'Old', proposed_definition: 'New', payload: null,
      knowledge_graph_version: 'v1', status: 'pending' as const,
      created_at: '2026-08-23T20:00:00Z', updated_at: '2026-08-23T20:00:00Z',
    }
    vi.mocked(api.listMessages).mockResolvedValue([{
      ...message(2, 'assistant', 'Proposal'), pending_action: pending,
    }])
    vi.mocked(api.confirmAction).mockResolvedValue({
      action: { ...pending, status: 'confirmed' },
      tooltip: {} as never,
      subject: {
        schema_version: '1',
        subject: {
          stable_id: 'object:x', kind: 'topic', label: 'X', aliases: [], roles: [],
          facets: [], units: null, constraints: [], object_ids: [],
        },
        explanation: null, occurrences: [], evidence: [], occurrence_total: 0,
        defining_equation: null,
      },
    })
    vi.mocked(api.rejectAction).mockResolvedValue({ ...pending, status: 'rejected' })
    await service.initialize()
    await service.confirmAction(8)
    expect(service.getSnapshot().messages[0].pending_action?.status).toBe('confirmed')
    expect(workspace.refreshTooltips).toHaveBeenCalledWith('paper-a')
    expect(workspace.refreshPaper).not.toHaveBeenCalled()
    expect(selectionService.selection).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ kind: 'node', id: 'object:x' }),
    }))
    vi.mocked(api.listMessages).mockResolvedValue([{
      ...message(2, 'assistant', 'Proposal'), pending_action: pending,
    }])
    await service.activatePaper('paper-a')
    await service.rejectAction(8)
    expect(service.getSnapshot().messages[0].pending_action?.status).toBe('rejected')
  })

  it('refreshes the paper HTML after confirming an entity addition', async () => {
    const { api, service, workspace, selectionService } = setup()
    const pending = {
      id: 9, source_message_id: 2, action_type: 'add_entity' as const, subject_id: null,
      base_definition: null, proposed_definition: 'DPO aligns a policy without a reward model.',
      payload: {
        label: 'DPO', kind: 'procedure', quote: 'DPO',
        dom_node_id: 'p-1', section_id: null, section_title: null,
      },
      knowledge_graph_version: 'v1', status: 'pending' as const,
      created_at: '2026-08-23T20:00:00Z', updated_at: '2026-08-23T20:00:00Z',
    }
    vi.mocked(api.listMessages).mockResolvedValue([{
      ...message(2, 'assistant', 'Proposal'), pending_action: pending,
    }])
    vi.mocked(api.confirmAction).mockResolvedValue({
      action: { ...pending, status: 'confirmed', subject_id: 'procedure:dpo' },
      tooltip: null,
      subject: {
        schema_version: '1',
        subject: {
          stable_id: 'procedure:dpo', kind: 'procedure', label: 'DPO', aliases: [], roles: [],
          facets: [], units: null, constraints: [], object_ids: [],
        },
        explanation: null, occurrences: [], evidence: [], occurrence_total: 0,
        defining_equation: null,
      },
    })
    await service.initialize()
    await service.confirmAction(9)
    expect(service.getSnapshot().messages[0].pending_action?.status).toBe('confirmed')
    expect(workspace.refreshPaper).toHaveBeenCalledWith('paper-a')
    expect(workspace.refreshTooltips).toHaveBeenCalledWith('paper-a')
    expect(selectionService.selection).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ kind: 'node', id: 'procedure:dpo' }),
    }))
  })

  it('refreshes the paper HTML after confirming an entity annotation', async () => {
    const { api, service, workspace, selectionService } = setup()
    const pending = {
      id: 10, source_message_id: 2, action_type: 'annotate_entity' as const, subject_id: 'procedure:dpo',
      base_definition: null, proposed_definition: 'DPO aligns a policy without a reward model.',
      payload: { label: 'DPO', occurrence_count: 12 },
      knowledge_graph_version: 'v1', status: 'pending' as const,
      created_at: '2026-08-23T20:00:00Z', updated_at: '2026-08-23T20:00:00Z',
    }
    vi.mocked(api.listMessages).mockResolvedValue([{
      ...message(2, 'assistant', 'Proposal'), pending_action: pending,
    }])
    vi.mocked(api.confirmAction).mockResolvedValue({
      action: { ...pending, status: 'confirmed' },
      tooltip: null,
      subject: {
        schema_version: '1',
        subject: {
          stable_id: 'procedure:dpo', kind: 'procedure', label: 'DPO', aliases: [], roles: [],
          facets: [], units: null, constraints: [], object_ids: [],
        },
        explanation: null, occurrences: [], evidence: [], occurrence_total: 0,
        defining_equation: null,
      },
    })
    await service.initialize()
    await service.confirmAction(10)
    expect(service.getSnapshot().messages[0].pending_action?.status).toBe('confirmed')
    expect(workspace.refreshPaper).toHaveBeenCalledWith('paper-a')
    expect(workspace.refreshTooltips).toHaveBeenCalledWith('paper-a')
    expect(selectionService.selection).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ kind: 'node', id: 'procedure:dpo' }),
    }))
  })

  it('pins a reading-set scope that survives paper switches until closed', async () => {
    const { api, service, workspace, notifyWorkspace } = setup()
    await service.initialize()

    await service.activateReadingSet(readingSet())
    expect(api.listConversations).toHaveBeenLastCalledWith({ readingSetId: 'set-1' })
    expect(service.getSnapshot().readingSet).toMatchObject({
      id: 'set-1',
      name: 'Preference Optimization',
      paperTitles: { 'paper-a': 'Paper Alpha', 'paper-b': 'Paper Beta' },
    })

    workspace.getSnapshot.mockReturnValue({ activePaperId: 'paper-b' })
    notifyWorkspace()
    expect(service.getSnapshot().readingSet?.id).toBe('set-1')
    expect(api.listConversations).toHaveBeenLastCalledWith({ readingSetId: 'set-1' })

    await service.closeReadingSetChat()
    expect(service.getSnapshot().readingSet).toBeNull()
    expect(api.listConversations).toHaveBeenLastCalledWith('paper-b')
  })

  it('creates conversations and streams messages against the reading-set routes', async () => {
    const { api, service } = setup()
    vi.mocked(api.listConversations).mockResolvedValue([])
    vi.mocked(api.createConversation).mockResolvedValue({
      id: 7, reading_set_id: 'set-1', title: 'Compare methods',
      created_at: '2026-08-29T10:00:00Z', updated_at: '2026-08-29T10:00:00Z',
    })
    await service.activateReadingSet(readingSet())

    await service.sendMessage('Compare methods')
    expect(api.createConversation).toHaveBeenCalledWith({ readingSetId: 'set-1' }, 'Compare methods')
    expect(api.streamMessage).toHaveBeenCalledWith(
      { readingSetId: 'set-1' }, 7, expect.any(Object), expect.any(Function), expect.any(AbortSignal),
    )
  })

  it('tags one-shot context with the source paper while in reading-set scope', async () => {
    const { service } = setup()
    await service.activateReadingSet(readingSet())

    service.setNextContextForPaper('paper-b', { kind: 'selection', data_id: 'p-9', quote: 'phrase' })
    expect(service.getSnapshot().nextContext).toEqual({
      kind: 'selection', data_id: 'p-9', quote: 'phrase', paper_id: 'paper-b',
    })

    service.setNextContextForPaper('paper-x', { kind: 'selection', data_id: 'p-1', quote: 'other' })
    expect(service.getSnapshot().nextContext?.paper_id).toBe('paper-b')
  })

  it('opens the cited paper tab and reveals the passage for reading-set citations', async () => {
    const { service, citations } = setup()
    await service.activateReadingSet(readingSet())
    document.body.innerHTML = `
      <div data-scholar-paper-id="paper-b">
        <section data-id="sec-9"><p data-id="p-9">The exact cross-paper phrase is here.</p></section>
      </div>`
    const target = document.querySelector<HTMLElement>('[data-id="p-9"]')!
    target.scrollIntoView = vi.fn()

    service.requestCitation({
      kind: 'quote', label: 'Evidence', source_id: 'p-9',
      quote: 'exact cross-paper phrase', paper_id: 'paper-b',
    })
    await vi.waitFor(() => expect(citations.openPaper).toHaveBeenCalledWith('paper-b'))
    await vi.waitFor(() => expect(target.scrollIntoView).toHaveBeenCalled())
    expect(target.querySelector('mark.scholar-chat-quote-highlight')?.textContent)
      .toBe('exact cross-paper phrase')
  })
})
