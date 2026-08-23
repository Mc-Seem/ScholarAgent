import { describe, expect, it, vi } from 'vitest'

import {
  ChatApiError,
  HttpChatApi,
  parseChatSse,
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
