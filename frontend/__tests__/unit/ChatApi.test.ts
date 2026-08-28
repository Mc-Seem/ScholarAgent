import { describe, expect, it, vi } from 'vitest'

import {
  ChatApiError,
  HttpChatApi,
  parseChatSse,
  validateChatMessage,
  type ChatStreamEvent,
} from '@/lib/chat-api'

const encoder = new TextEncoder()

function streamResponse(chunks: string[], init: ResponseInit = {}): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init })
}

describe('chat API SSE parser', () => {
  it('parses fragmented status and final events with validated contracts', async () => {
    const payload = {
      type: 'final',
      message: {
        id: 2,
        conversation_id: 1,
        role: 'assistant',
        content: 'Grounded answer',
        context: null,
        citations: [],
        pending_action: null,
        created_at: '2026-08-23T20:00:00Z',
      },
      citations: [],
      pending_action: null,
    }
    const events: ChatStreamEvent[] = []
    await parseChatSse(streamResponse([
      'event: status\ndata: {"type":"status","stage":"retr',
      'ieval","message":"Searching"}\n\nevent: final\ndata: ',
      `${JSON.stringify(payload)}\n\n`,
    ]), event => events.push(event))

    expect(events.map(event => event.type)).toEqual(['status', 'final'])
    expect(events[1]).toMatchObject({ type: 'final', message: { content: 'Grounded answer' } })
  })

  it('rejects malformed or unknown event payloads', async () => {
    await expect(parseChatSse(
      streamResponse(['event: status\ndata: {"type":"status","stage":"wrong"}\n\n']),
      () => undefined,
    )).rejects.toThrow('Invalid chat status event')
  })

  it('parses add_entity actions and defaults a missing action_type to redefine', () => {
    const baseAction = {
      id: 8, source_message_id: 4, subject_id: null, base_definition: null,
      proposed_definition: 'DPO aligns a policy without a reward model.',
      knowledge_graph_version: 'v1', status: 'pending',
      created_at: '2026-08-25T20:00:00Z', updated_at: '2026-08-25T20:00:00Z',
    }
    const message = (pending_action: unknown) => ({
      id: 4, conversation_id: 1, role: 'assistant', content: 'Answer',
      context: null, citations: [], pending_action, created_at: '2026-08-25T20:00:00Z',
    })

    const parsed = validateChatMessage(message({
      ...baseAction,
      action_type: 'add_entity',
      payload: {
        label: 'DPO', kind: 'procedure', quote: 'DPO',
        dom_node_id: 'p-1', section_id: null, section_title: null,
      },
    }))
    expect(parsed.pending_action).toMatchObject({
      action_type: 'add_entity',
      subject_id: null,
      payload: { label: 'DPO', kind: 'procedure' },
    })

    const legacy = validateChatMessage(message({ ...baseAction, subject_id: 'object:x' }))
    expect(legacy.pending_action).toMatchObject({ action_type: 'redefine', payload: null })

    expect(() => validateChatMessage(message({ ...baseAction, action_type: 'add_entity', payload: null })))
      .toThrow('Invalid action payload')
    expect(() => validateChatMessage(message({
      ...baseAction, action_type: 'add_entity', payload: { kind: 'procedure' },
    }))).toThrow('Invalid action payload')
    expect(() => validateChatMessage(message({ ...baseAction, action_type: 'wrong' })))
      .toThrow('Invalid pending chat action')
  })

  it('parses annotate_entity actions and requires a pending payload label', () => {
    const baseAction = {
      id: 12, source_message_id: 6, subject_id: 'procedure:dpo', base_definition: null,
      proposed_definition: 'DPO aligns a policy without a reward model.',
      knowledge_graph_version: 'v1', status: 'pending',
      created_at: '2026-08-25T20:00:00Z', updated_at: '2026-08-25T20:00:00Z',
    }
    const message = (pending_action: unknown) => ({
      id: 6, conversation_id: 1, role: 'assistant', content: 'Answer',
      context: null, citations: [], pending_action, created_at: '2026-08-25T20:00:00Z',
    })

    const parsed = validateChatMessage(message({
      ...baseAction,
      action_type: 'annotate_entity',
      payload: { label: 'DPO', occurrence_count: 12 },
    }))
    expect(parsed.pending_action).toMatchObject({
      action_type: 'annotate_entity',
      subject_id: 'procedure:dpo',
      payload: { label: 'DPO', occurrence_count: 12 },
    })

    expect(() => validateChatMessage(message({ ...baseAction, action_type: 'annotate_entity', payload: null })))
      .toThrow('Invalid action payload')
    expect(() => validateChatMessage(message({
      ...baseAction, action_type: 'annotate_entity', payload: { occurrence_count: 12 },
    }))).toThrow('Invalid action payload')
    expect(() => validateChatMessage(message({ ...baseAction, action_type: 'wrong' })))
      .toThrow('Invalid pending chat action')
  })

  it('accepts a null tooltip in add_entity confirmations', async () => {
    const api = new HttpChatApi('http://backend')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      action: {
        id: 8, source_message_id: 4, action_type: 'add_entity', subject_id: 'procedure:dpo',
        base_definition: null, proposed_definition: 'DPO aligns a policy without a reward model.',
        payload: {
          label: 'DPO', kind: 'procedure', quote: 'DPO',
          dom_node_id: 'p-1', section_id: null, section_title: null,
        },
        knowledge_graph_version: 'v1', status: 'confirmed',
        created_at: '2026-08-25T20:00:00Z', updated_at: '2026-08-25T20:00:00Z',
      },
      tooltip: null,
      subject: { subject: { stable_id: 'procedure:dpo', kind: 'procedure', label: 'DPO' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    const confirmation = await api.confirmAction('paper-a', 8)
    expect(confirmation.tooltip).toBeNull()
    expect(confirmation.action).toMatchObject({
      action_type: 'add_entity', status: 'confirmed', subject_id: 'procedure:dpo',
    })
    vi.unstubAllGlobals()
  })

  it('surfaces structured HTTP errors and supports abort', async () => {
    const api = new HttpChatApi('http://backend')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ detail: { code: 'stale_action', message: 'Changed' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )))
    await expect(api.confirmAction('paper a', 7)).rejects.toMatchObject({
      status: 409,
      code: 'stale_action',
      message: 'Changed',
    })

    const controller = new AbortController()
    controller.abort()
    await expect(parseChatSse(streamResponse([]), () => undefined, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(ChatApiError).toBeDefined()
    vi.unstubAllGlobals()
  })
})
