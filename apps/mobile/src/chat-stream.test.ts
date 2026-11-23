import { describe, expect, it, jest } from '@jest/globals';
import type { ChatStreamEvent, Message } from '@karen/api-contracts';
import { applyChatEvent, liveFromMessage, mergeSnapshot } from './lib/chat-state';
import { ChatStreamFollower, type StreamConnection } from './lib/chat-stream';
import { usageResetTime } from './lib/chat-queries';
import { ApiRequestError } from './lib/api-error';
import { redactForSharing } from '@karen/domain';
import { backoffDelay, createSseParser, toChatEvent } from './lib/sse';

const MID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const CID = '9b2f0c1e-1d6a-4c2b-8f0e-3a5b6c7d8e9f';

const message = (over: Partial<Message> = {}): Message => ({
  id: MID,
  conversation_id: CID,
  seq: 2,
  role: 'assistant',
  status: 'accepted',
  content: '',
  reply_to_message_id: '0b2f0c1e-1d6a-4c2b-8f0e-3a5b6c7d8e90',
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

const frame = (e: ChatStreamEvent) =>
  `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const delta = (seq: number, text: string): ChatStreamEvent => ({ seq, type: 'token_delta', text });
const complete = (seq: number): ChatStreamEvent => ({
  seq,
  type: 'complete',
  status: 'completed',
  finish_reason: 'stop',
  is_mock: true,
  route_tier: 'BALANCED',
});

describe('SSE parser', () => {
  it('handles frames split anywhere, CRLF line endings, heartbeats and multi-line data', () => {
    const parser = createSseParser();
    const text = `: ping\r\n\r\nid: 3\r\nevent: token_delta\r\ndata: {"seq":3,\r\ndata: "type":"token_delta","text":"hi"}\r\n\r\n`;
    const frames = text.split('').flatMap((ch) => parser.push(ch));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({ data: '', heartbeat: true });
    expect(frames[1]).toMatchObject({ id: '3', event: 'token_delta', heartbeat: false });
    expect(toChatEvent(frames[1]!)).toEqual({ seq: 3, type: 'token_delta', text: 'hi' });
  });

  it('ignores data that is not a contract event', () => {
    const parser = createSseParser();
    const [a, b] = parser.push('data: not json\n\ndata: {"seq":1,"type":"bogus"}\n\n');
    expect(toChatEvent(a!)).toBeNull();
    expect(toChatEvent(b!)).toBeNull();
    expect(parser.push('retry: 2000\n\n')).toEqual([]);
  });

  it('backs off exponentially with jitter, capped', () => {
    expect(backoffDelay(0, 0.5)).toBe(500);
    expect(backoffDelay(3, 0.5)).toBe(4_000);
    expect(backoffDelay(20, 0.5)).toBe(15_000);
    expect(backoffDelay(1, 0)).toBe(800);
    expect(backoffDelay(1, 0.999)).toBeLessThanOrEqual(1_200);
  });
});

describe('chat state', () => {
  it('applies events in order and ignores duplicates from a replay', () => {
    let s = liveFromMessage(message());
    for (const e of [
      delta(2, 'Hel'),
      delta(3, 'lo'),
      delta(2, 'Hel'),
      delta(3, 'lo'),
      complete(4),
    ]) {
      s = applyChatEvent(s, e);
    }
    expect(s).toMatchObject({
      content: 'Hello',
      status: 'completed',
      lastSeq: 4,
      done: true,
      isMock: true,
    });
    // After the terminal event nothing changes.
    expect(applyChatEvent(s, delta(5, '!'))).toBe(s);
  });

  it('records errors with the terminal status', () => {
    const s = applyChatEvent(liveFromMessage(message({ content: 'part', last_event_seq: 3 })), {
      seq: 4,
      type: 'error',
      status: 'incomplete',
      code: 'GENERATION_INTERRUPTED',
      message: 'The answer was interrupted.',
      retryable: true,
    });
    expect(s).toMatchObject({ status: 'incomplete', content: 'part', done: true });
    expect(s.error?.code).toBe('GENERATION_INTERRUPTED');
  });

  it('only accepts snapshots at least as new as the live view', () => {
    const live = { ...liveFromMessage(message()), lastSeq: 5, content: 'newer' };
    expect(mergeSnapshot(live, message({ last_event_seq: 3, content: 'old' }))).toBe(live);
    expect(
      mergeSnapshot(live, message({ last_event_seq: 6, content: 'final', status: 'completed' }))
        .content,
    ).toBe('final');
  });
});

/** A fake streaming Response whose body yields the given chunks, then ends (or errors). */
function streamResponse(chunks: string[], opts: { failAfter?: boolean } = {}): Response {
  let i = 0;
  const body = {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) return { done: false, value: chunks[i++] };
        if (opts.failAfter) throw new TypeError('Network request failed');
        return { done: true, value: undefined };
      },
      cancel: async () => undefined,
    }),
  };
  return { status: 200, ok: true, body } as unknown as Response;
}
/** A fake streaming Response that yields the chunks, then stays open (never ends). */
function openStream(chunks: string[]): Response {
  let i = 0;
  const body = {
    getReader: () => ({
      read: () =>
        i < chunks.length
          ? Promise.resolve({ done: false, value: chunks[i++] })
          : new Promise<never>(() => undefined),
      cancel: async () => undefined,
    }),
  };
  return { status: 200, ok: true, body } as unknown as Response;
}
const status = (code: number) => ({ status: code, ok: false, body: null }) as unknown as Response;

function follow(
  responses: (Response | Error)[],
  over: Partial<ConstructorParameters<typeof ChatStreamFollower>[0]> = {},
) {
  const requests: { headers: Record<string, string> }[] = [];
  const events: ChatStreamEvent[] = [];
  const states: StreamConnection[] = [];
  const fatal: string[] = [];
  const snapshots: Message[] = [];
  const fetchImpl = jest.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push({ headers: init?.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) return new Promise<Response>(() => undefined); // hang
    if (next instanceof Error) throw next;
    return next;
  });
  const deps = {
    baseUrl: 'http://api.test/',
    fetch: fetchImpl as unknown as typeof fetch,
    getAccessToken: async () => 'tok-1',
    handleUnauthorized: jest.fn(async () => 'tok-2'),
    pollMessage: jest.fn(async () => message()),
    sleep: async () => undefined,
    random: () => 0.5,
    pollIntervalMs: 0,
    ...over,
  };
  const follower = new ChatStreamFollower(
    deps,
    `/v1/conversations/${CID}/messages/${MID}/stream`,
    1,
    {
      onEvent: (e) => events.push(e),
      onSnapshot: (m) => snapshots.push(m),
      onConnection: (s) => states.push(s),
      onFatal: (e) => fatal.push(e.message),
    },
  );
  return { follower, requests, events, states, fatal, snapshots, deps, fetchImpl };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('ChatStreamFollower', () => {
  it('streams to the terminal event with the bearer token and resume point', async () => {
    const f = follow([
      streamResponse([frame(delta(2, 'Hi ')), frame(delta(3, 'there')) + frame(complete(4))]),
    ]);
    f.follower.start();
    await settle();
    expect(f.events.map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(f.requests[0]!.headers).toMatchObject({
      authorization: 'Bearer tok-1',
      'last-event-id': '1',
    });
    expect(f.follower.isFinished).toBe(true);
    expect(f.states.at(-1)).toBe('closed');
  });

  it('reconnects after a drop with Last-Event-ID and never duplicates events', async () => {
    const f = follow([
      streamResponse([frame(delta(2, 'a')), frame(delta(3, 'b'))], { failAfter: true }),
      // The server replays from Last-Event-ID; a duplicate (3) must be ignored anyway.
      streamResponse([frame(delta(3, 'b')), frame(delta(4, 'c')), frame(complete(5))]),
    ]);
    f.follower.start();
    await settle();
    expect(f.requests[1]!.headers['last-event-id']).toBe('3');
    expect(f.events.map((e) => e.seq)).toEqual([2, 3, 4, 5]);
    expect(f.states).toContain('offline');
  });

  it('refreshes the session once on 401, then retries', async () => {
    const f = follow([status(401), streamResponse([frame(complete(2))])]);
    f.follower.start();
    await settle();
    expect(f.deps.handleUnauthorized).toHaveBeenCalledWith('tok-1');
    expect(f.requests[1]!.headers.authorization).toBe('Bearer tok-2');
    expect(f.events).toHaveLength(1);
  });

  it('stops with a fatal error on 404 (deleted / not yours)', async () => {
    const f = follow([status(404)]);
    f.follower.start();
    await settle();
    expect(f.fatal).toEqual(['This answer is no longer available.']);
    expect(f.follower.isFinished).toBe(true);
  });

  it('falls back to polling when the runtime cannot stream bodies', async () => {
    const polls = [
      message({ status: 'streaming', last_event_seq: 3 }),
      message({ status: 'completed', content: 'done', last_event_seq: 5 }),
    ];
    const f = follow([{ status: 200, ok: true, body: null } as unknown as Response], {
      pollMessage: jest.fn(async () => polls.shift() ?? message({ status: 'completed' })),
    });
    f.follower.start();
    await settle();
    expect(f.states).toContain('polling');
    expect(f.snapshots.map((m) => m.status)).toEqual(['streaming', 'completed']);
    expect(f.follower.isFinished).toBe(true);
  });

  it('pauses in the background and resumes from the last seq', async () => {
    const f = follow([streamResponse([frame(delta(2, 'a'))])]);
    f.follower.start();
    await settle();
    f.follower.pause();
    expect(f.states.at(-1)).toBe('paused');
    const calls = f.fetchImpl.mock.calls.length;
    f.follower.resume();
    await settle();
    expect(f.fetchImpl.mock.calls.length).toBeGreaterThan(calls);
    expect(f.requests.at(-1)!.headers['last-event-id']).toBe('2');
    f.follower.close();
  });

  it('ignores resume() while still connected (iOS inactive → active): one connection only', async () => {
    const f = follow([openStream([frame(delta(2, 'a'))])]);
    f.follower.start();
    await settle();
    f.follower.resume();
    await settle();
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.states.filter((s) => s === 'connecting')).toHaveLength(1);
    f.follower.close();
  });

  it('a late response from a paused attempt never aborts the newer connection', async () => {
    let resolveFirst: (r: Response) => void = () => undefined;
    const signals: AbortSignal[] = [];
    const fetchImpl = jest.fn((_url: unknown, init?: RequestInit) => {
      signals.push(init!.signal!);
      // The first request ignores its abort signal and answers late.
      if (signals.length === 1) return new Promise<Response>((r) => (resolveFirst = r));
      return Promise.resolve(openStream([frame(delta(2, 'a'))]));
    });
    const f = follow([], { fetch: fetchImpl as unknown as typeof fetch });
    f.follower.start();
    await settle();
    f.follower.pause();
    f.follower.resume();
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    resolveFirst(openStream([]));
    await settle();
    expect(signals[1]!.aborted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    f.follower.close();
  });

  it('stops polling with a fatal error when the message is gone (404)', async () => {
    const pollMessage = jest.fn(async (): Promise<Message> => {
      throw new ApiRequestError({ status: 404, code: 'NOT_FOUND', message: 'Not found' });
    });
    const f = follow([{ status: 200, ok: true, body: null } as unknown as Response], {
      pollMessage,
      sleep: () => new Promise<void>((r) => setTimeout(r, 0)),
    });
    f.follower.start();
    await settle();
    await settle();
    expect(pollMessage).toHaveBeenCalledTimes(1);
    expect(f.fatal).toEqual(['This answer is no longer available.']);
    expect(f.follower.isFinished).toBe(true);
  });
});

describe('helpers', () => {
  it('reads the reset time from USAGE_LIMIT_REACHED', () => {
    const err = new ApiRequestError({
      status: 429,
      code: 'USAGE_LIMIT_REACHED',
      message: 'limit',
      nextOptions: ['RESETS_AT:2026-11-22T00:00:00.000Z'],
    });
    expect(usageResetTime(err)?.toISOString()).toBe('2026-11-22T00:00:00.000Z');
    expect(
      usageResetTime(new ApiRequestError({ status: 429, code: 'RATE_LIMITED', message: 'x' })),
    ).toBeNull();
  });

  it('redacts personal details for sharing (mirror of @karen/domain rules)', () => {
    expect(redactForSharing('Call 9876543210 or mail a@b.co on 21/11/2026').text).toBe(
      'Call [phone hidden] or mail [email hidden] on 21/11/2026',
    );
  });
});
