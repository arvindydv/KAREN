// @vitest-environment node
import type { ChatStreamEvent, Message } from '@karen/api-contracts';
import { describe, expect, it, vi } from 'vitest';
import { resetsAt } from './api';
import { applyEvent, latestAssistant, messagesReducer, visibleMessages } from './messages-state';
import { nextRevealLength, safeSliceEnd } from './smooth-text';
import { SseParser } from './sse';
import { backoffMs, followChatStream } from './stream-client';

describe('SseParser', () => {
  it('handles frames split anywhere, CRLF split across chunks, multi-line data and heartbeats', () => {
    const p = new SseParser();
    const text =
      ': ping\r\n\r\nid: 1\r\nevent: token_delta\r\ndata: {"a":\r\ndata: 1}\r\n\r\nid: 2\ndata: x\n\n';
    const frames = [];
    for (const ch of text) frames.push(...p.push(ch));
    expect(frames).toEqual([
      { id: '1', event: 'token_delta', data: '{"a":\n1}' },
      { id: '2', event: null, data: 'x' },
    ]);
    expect(p.heartbeats).toBe(1);
  });
});

const ev = (seq: number, e: Partial<ChatStreamEvent> & { type: ChatStreamEvent['type'] }) =>
  ({ seq, ...e }) as ChatStreamEvent;
const frame = (e: ChatStreamEvent) =>
  `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const sseResponse = (chunks: string[], { end = true } = {}) => {
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < chunks.length) c.enqueue(new TextEncoder().encode(chunks[i++]));
        else if (end) c.close();
        else c.error(new TypeError('network')); // drop after delivering everything
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
};

describe('followChatStream', () => {
  const base = {
    path: '/api/v1/conversations/c/messages/m/stream',
    sleep: () => Promise.resolve(),
    isOnline: () => true,
  };

  it('resumes after a drop with Last-Event-ID and applies each seq exactly once', async () => {
    const seen: number[] = [];
    const calls: (string | null)[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
      calls.push(new Headers(init?.headers).get('last-event-id'));
      if (calls.length === 1) {
        // Drops after seq 3 (mid-stream network failure).
        return Promise.resolve(
          sseResponse(
            [
              frame(ev(2, { type: 'status', status: 'streaming' })),
              frame(ev(3, { type: 'token_delta', text: 'a' })),
            ],
            {
              end: false,
            },
          ),
        );
      }
      // Server replays seq 3 again (duplicate) then continues.
      return Promise.resolve(
        sseResponse([
          frame(ev(3, { type: 'token_delta', text: 'a' })),
          frame(ev(4, { type: 'token_delta', text: 'b' })),
          frame(
            ev(5, {
              type: 'complete',
              status: 'completed',
              finish_reason: 'stop',
              is_mock: true,
              route_tier: 'BALANCED',
            }),
          ),
        ]),
      );
    });
    const out = await followChatStream({
      ...base,
      afterSeq: 1,
      fetch,
      signal: new AbortController().signal,
      onEvent: (e) => seen.push(e.seq),
    });
    expect(out.kind).toBe('terminal');
    expect(seen).toEqual([2, 3, 4, 5]);
    expect(calls).toEqual(['1', '3']);
  });

  it('stops on 4xx (e.g. deleted message) without retrying', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        Response.json(
          { error: { code: 'NOT_FOUND', message: 'gone', correlation_id: 'x', retryable: false } },
          { status: 404 },
        ),
      ),
    );
    const out = await followChatStream({
      ...base,
      afterSeq: 0,
      fetch,
      signal: new AbortController().signal,
      onEvent: () => undefined,
    });
    expect(out).toMatchObject({ kind: 'error', status: 404, error: { code: 'NOT_FOUND' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx and network errors with backoff up to a limit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new TypeError('offline')));
    const sleep = vi.fn(() => Promise.resolve());
    const out = await followChatStream({
      ...base,
      sleep,
      afterSeq: 0,
      fetch,
      maxAttempts: 3,
      signal: new AbortController().signal,
      onEvent: () => undefined,
    });
    expect(out.kind).toBe('error');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports the connection closed when it gives up (no endless "reconnecting")', async () => {
    const states: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response('upstream down', { status: 503 })),
    );
    const out = await followChatStream({
      ...base,
      afterSeq: 0,
      fetch,
      maxAttempts: 2,
      signal: new AbortController().signal,
      onEvent: () => undefined,
      onConnection: (s) => states.push(s),
    });
    expect(out).toMatchObject({ kind: 'error', status: 503 });
    expect(states).toEqual(['connecting', 'reconnecting', 'closed']);

    const gone: string[] = [];
    await followChatStream({
      ...base,
      afterSeq: 0,
      fetch: () => Promise.resolve(Response.json({}, { status: 404 })),
      signal: new AbortController().signal,
      onEvent: () => undefined,
      onConnection: (s) => gone.push(s),
    });
    expect(gone.at(-1)).toBe('closed');
  });

  it('waits for the browser to come back online before reconnecting', async () => {
    let online = false;
    const waitForOnline = vi.fn(() => {
      online = true;
      return Promise.resolve();
    });
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        sseResponse([
          frame(
            ev(2, { type: 'error', status: 'failed', code: 'X', message: 'm', retryable: true }),
          ),
        ]),
      ),
    );
    const states: string[] = [];
    const out = await followChatStream({
      ...base,
      isOnline: () => online,
      waitForOnline,
      afterSeq: 1,
      fetch,
      signal: new AbortController().signal,
      onEvent: () => undefined,
      onConnection: (s) => states.push(s),
    });
    expect(out.kind).toBe('terminal');
    expect(states[0]).toBe('offline');
    expect(waitForOnline).toHaveBeenCalledOnce();
  });

  it('backoff grows and is capped', () => {
    const fixed = () => 0.5;
    expect(backoffMs(0, fixed)).toBe(500);
    expect(backoffMs(3, fixed)).toBe(4000);
    expect(backoffMs(20, fixed)).toBe(10_000);
  });
});

const msg = (over: Partial<Message>): Message => ({
  id: 'm1',
  conversation_id: 'c',
  seq: 2,
  role: 'assistant',
  status: 'accepted',
  content: '',
  reply_to_message_id: 'u1',
  regenerated_from_message_id: null,
  superseded: false,
  error: null,
  is_mock: null,
  route_tier: null,
  feedback: null,
  last_event_seq: 1,
  created_at: '2026-11-21T10:00:00.000Z',
  completed_at: null,
  ...over,
});

describe('messages state', () => {
  it('applies events idempotently and never goes backwards', () => {
    let m = msg({});
    m = applyEvent(m, ev(2, { type: 'token_delta', text: 'Hel' }));
    m = applyEvent(m, ev(2, { type: 'token_delta', text: 'Hel' })); // duplicate
    m = applyEvent(m, ev(3, { type: 'token_delta', text: 'lo' }));
    m = applyEvent(
      m,
      ev(4, {
        type: 'error',
        status: 'incomplete',
        code: 'GENERATION_INTERRUPTED',
        message: 'x',
        retryable: true,
      }),
    );
    expect(m).toMatchObject({ content: 'Hello', status: 'incomplete', last_event_seq: 4 });
    // A stale fetched copy does not undo streamed progress.
    const s = messagesReducer(
      { items: [m], olderCursor: null },
      { type: 'upsert', messages: [msg({ content: 'He', last_event_seq: 2 })] },
    );
    expect(s.items[0]!.content).toBe('Hello');
  });

  it('hides superseded answers and finds the latest assistant message', () => {
    const items = [
      msg({ id: 'u1', role: 'user', seq: 1, status: 'completed' }),
      msg({ id: 'a1', seq: 2, superseded: true, status: 'completed' }),
      msg({ id: 'a2', seq: 3, status: 'completed' }),
    ];
    expect(visibleMessages(items).map((m) => m.id)).toEqual(['u1', 'a2']);
    expect(latestAssistant(items)?.id).toBe('a2');
    expect(latestAssistant([...items, msg({ id: 'u2', role: 'user', seq: 4 })])).toBeNull();
  });

  it('merges older pages in seq order without duplicates', () => {
    const s = messagesReducer(
      { items: [msg({ id: 'b', seq: 5 })], olderCursor: '5' },
      {
        type: 'older',
        items: [msg({ id: 'a', seq: 3 }), msg({ id: 'b', seq: 5 })],
        olderCursor: null,
      },
    );
    expect(s.items.map((m) => m.id)).toEqual(['a', 'b']);
    expect(s.olderCursor).toBeNull();
  });
});

describe('smooth text', () => {
  it('reveals steadily and catches up with bursts', () => {
    expect(nextRevealLength(0, 10, 16)).toBeGreaterThanOrEqual(1);
    expect(nextRevealLength(0, 1000, 16)).toBeGreaterThan(50); // backlog drains in ~250 ms
    expect(nextRevealLength(10, 10, 16)).toBe(10);
    let shown = 0;
    let frames = 0;
    while (shown < 600 && frames < 600) {
      shown = nextRevealLength(shown, 600, 16);
      frames++;
    }
    expect(shown).toBe(600);
    expect(frames).toBeLessThan(75); // a 600-char burst is fully shown in about a second
  });
  it('never splits a surrogate pair or a Devanagari vowel sign', () => {
    expect(safeSliceEnd('a😀b', 2)).toBe(3);
    const hindi = 'नमस्ते';
    for (let i = 1; i < hindi.length; i++) {
      const end = safeSliceEnd(hindi, i);
      expect(end).toBeGreaterThanOrEqual(i);
    }
    expect(safeSliceEnd('कि', 1)).toBe(2); // क + ि stays together
  });
});

describe('resetsAt', () => {
  it('reads RESETS_AT from next_options', () => {
    expect(resetsAt(['RESETS_AT:2026-11-22T00:00:00.000Z'])?.toISOString()).toBe(
      '2026-11-22T00:00:00.000Z',
    );
    expect(resetsAt(['RESETS_AT:garbage'])).toBeNull();
    expect(resetsAt(undefined)).toBeNull();
  });
});
