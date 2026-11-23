// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BffOptions, BffResult } from '../api';
import {
  GATE_FRAME_MS,
  LiveVoiceSession,
  type LiveTurn,
  type MicPipeline,
  type LiveVoiceState,
  type RecorderLike,
} from './live-voice';

const SID = `lv_${'a1B2'.repeat(10)}`;
const session = { session_id: SID, max_seconds: 300, idle_seconds: 20, is_mock: true };

type Call = { path: string; options: BffOptions | undefined };

function fakeApi(audioResults: BffResult<unknown>[] = []) {
  const calls: Call[] = [];
  const api = vi.fn(async <T>(path: string, options?: BffOptions): Promise<BffResult<T>> => {
    calls.push({ path, options });
    if (path === '/api/v1/voice/sessions') {
      return { ok: true, status: 201, data: session as T, etag: null };
    }
    if (path.endsWith('/audio') && audioResults.length > 0) {
      return audioResults.shift() as BffResult<T>;
    }
    return {
      ok: true,
      status: path.endsWith('/close') ? 202 : 204,
      data: undefined as T,
      etag: null,
    };
  });
  return { api, calls };
}

/** An SSE response whose frames the test pushes; `end()` closes it (a network drop). */
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    send(id: string, payload: object) {
      controller.enqueue(
        new TextEncoder().encode(`id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`),
      );
    },
    end() {
      controller.close();
    },
  };
}

class FakeRecorder implements RecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}

const flush = async (times = 20) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup(audioResults: BffResult<unknown>[] = [], streams = [controlledStream()]) {
  const { api, calls } = fakeApi(audioResults);
  const fetchUrls: string[] = [];
  const queue = [...streams];
  const fetch = vi.fn(async (url: string) => {
    fetchUrls.push(url);
    const next = queue.shift();
    if (!next) return new Response(null, { status: 503 });
    return next.response;
  }) as unknown as typeof globalThis.fetch;
  const recorder = new FakeRecorder();
  const track = { stop: vi.fn() };
  const states: LiveVoiceState[] = [];
  const turns: LiveTurn[] = [];
  const partials: string[] = [];
  const handlers = {
    onState: (s: LiveVoiceState) => states.push(s),
    onTurn: (t: LiveTurn) => turns.push(t),
    onPartial: (p: string) => partials.push(p),
    onSpeechStarted: vi.fn(),
    onClosed: vi.fn(),
    onError: vi.fn(),
  };
  const live = new LiveVoiceSession(handlers, {
    api: api as never,
    fetch,
    getUserMedia: async () => ({ getTracks: () => [track] }) as unknown as MediaStream,
    createRecorder: () => recorder,
    isTypeSupported: (m) => m.startsWith('audio/webm'),
    sleep: async () => undefined,
  });
  return { live, api, calls, fetchUrls, recorder, track, states, turns, partials, handlers };
}

const audioSeqs = (calls: Call[]) =>
  calls
    .filter((c) => c.path.endsWith('/audio'))
    .map((c) => (c.options?.json as { seq: number }).seq);

describe('LiveVoiceSession (ADR-0027)', () => {
  it('opens a session with the recorder format and streams chunks in order', async () => {
    const t = setup();
    await t.live.start({ conversationId: 'c-1', language: 'hi' });
    expect(t.calls[0]!.options?.json).toEqual({
      audio_format: 'webm',
      conversation_id: 'c-1',
      language: 'hi',
    });
    expect(t.recorder.start).toHaveBeenCalledWith(250);
    expect(t.states).toEqual(['connecting', 'listening']);
    t.recorder.emit('a');
    t.recorder.emit('b');
    t.recorder.emit('c');
    await flush();
    expect(audioSeqs(t.calls)).toEqual([0, 1, 2]);
  });

  it('retries a failed chunk with the SAME seq (server dedupes) before sending the next', async () => {
    const t = setup([
      {
        ok: false,
        status: 503,
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'x',
          correlation_id: 'c',
          retryable: true,
        },
      },
    ]);
    await t.live.start();
    t.recorder.emit('a');
    t.recorder.emit('b');
    await flush();
    expect(audioSeqs(t.calls)).toEqual([0, 0, 1]);
  });

  it('delivers partials, barge-in and each final turn once with an idempotency key', async () => {
    const stream = controlledStream();
    const t = setup([], [stream]);
    await t.live.start();
    stream.send('1', { type: 'ready' });
    stream.send('2', { type: 'speech_started', turn_index: 0 });
    stream.send('3', { type: 'partial', turn_index: 0, text: 'mujhe kal' });
    const final = {
      type: 'end_of_turn',
      turn_index: 0,
      text: 'mujhe kal ki meetings batao',
      language: 'hi-Latn',
    };
    stream.send('4', final);
    stream.send('5', final); // duplicate (e.g. replay after reconnect)
    stream.send('6', { type: 'end_of_turn', turn_index: 1, text: '   ', language: null });
    await flush();
    expect(t.handlers.onSpeechStarted).toHaveBeenCalledTimes(1);
    expect(t.partials).toContain('mujhe kal');
    expect(t.turns).toEqual([
      {
        text: 'mujhe kal ki meetings batao',
        language: 'hi-Latn',
        turnIndex: 0,
        idempotencyKey: `voice-${SID}-0`,
      },
    ]);
  });

  it('reconnects the event stream after a drop, resuming after the last event id', async () => {
    const first = controlledStream();
    const second = controlledStream();
    const t = setup([], [first, second]);
    await t.live.start();
    first.send('1700000000000-3', { type: 'ready' });
    await flush();
    first.end();
    await flush();
    expect(t.fetchUrls[1]).toBe(`/api/v1/voice/sessions/${SID}/events?after=1700000000000-3`);
    second.send('1700000000000-4', {
      type: 'closed',
      reason: 'idle_timeout',
      audio_seconds: 3,
    });
    await flush();
    expect(t.handlers.onClosed).toHaveBeenCalledWith('idle_timeout');
    expect(t.track.stop).toHaveBeenCalled();
    expect(t.live.current).toBe('idle');
  });

  it('stop() stops the microphone, closes the session and waits for the closed event', async () => {
    const stream = controlledStream();
    const t = setup([], [stream]);
    await t.live.start();
    const stopping = t.live.stop();
    await flush();
    expect(t.recorder.stop).toHaveBeenCalled();
    expect(t.calls.some((c) => c.path === `/api/v1/voice/sessions/${SID}/close`)).toBe(true);
    stream.send('9', { type: 'closed', reason: 'client_closed', audio_seconds: 1 });
    await stopping;
    expect(t.handlers.onClosed).toHaveBeenCalledTimes(1);
    expect(t.track.stop).toHaveBeenCalled();
  });

  it('reports a denied microphone without creating a session', async () => {
    const { api, calls } = fakeApi();
    const states: LiveVoiceState[] = [];
    const onError = vi.fn();
    const live = new LiveVoiceSession(
      { onState: (s) => states.push(s), onError },
      {
        api: api as never,
        getUserMedia: async () => {
          throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        },
        isTypeSupported: () => true,
      },
    );
    await live.start();
    expect(states).toEqual(['connecting', 'permission_denied']);
    expect(onError).toHaveBeenCalledWith('MIC_PERMISSION_DENIED');
    expect(calls).toEqual([]);
  });

  it('stops streaming when the server says the session is gone (404)', async () => {
    const t = setup([
      {
        ok: false,
        status: 404,
        error: { code: 'NOT_FOUND', message: 'x', correlation_id: 'c', retryable: false },
      },
    ]);
    await t.live.start();
    t.recorder.emit('a');
    await flush();
    expect(t.handlers.onClosed).toHaveBeenCalledWith('session_ended');
    expect(t.recorder.stop).toHaveBeenCalled();
  });

  it('gates KAREN’s own voice out of the microphone and opens on a real barge-in (ADR-0033)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let clock = 0;
      let level = 0.01;
      const passing: boolean[] = [];
      const outputStream = { getTracks: () => [] } as unknown as MediaStream;
      const pipeline: MicPipeline = {
        output: outputStream,
        level: () => level,
        setPassing: (p) => passing.push(p),
        close: vi.fn(),
      };
      const { api } = fakeApi();
      const recorderStreams: MediaStream[] = [];
      const onBargeIn = vi.fn();
      const live = new LiveVoiceSession(
        { onBargeIn },
        {
          api: api as never,
          fetch: (async () => controlledStream().response) as unknown as typeof globalThis.fetch,
          getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
          createRecorder: (stream) => {
            recorderStreams.push(stream);
            return new FakeRecorder();
          },
          isTypeSupported: () => true,
          sleep: async () => undefined,
          createMicPipeline: async () => pipeline,
          now: () => clock,
        },
      );
      const tick = (ms: number) => {
        for (let t = 0; t < ms; t += GATE_FRAME_MS) {
          clock += GATE_FRAME_MS;
          vi.advanceTimersByTime(GATE_FRAME_MS);
        }
      };
      await live.start();
      expect(recorderStreams[0]).toBe(outputStream); // the gated stream is what gets recorded
      tick(200);
      expect(live.micPassing).toBe(true);

      live.setPhase('speaking');
      level = 0.01; // KAREN's echo, quiet (echo cancellation / headphones)
      tick(2_000);
      expect(live.micPassing).toBe(false);
      expect(passing.at(-1)).toBe(false);
      expect(onBargeIn).not.toHaveBeenCalled();

      level = 0.3; // the user talks over her, much louder than the echo
      tick(600);
      expect(onBargeIn).toHaveBeenCalledTimes(1);
      expect(live.micPassing).toBe(true);
      expect(passing.at(-1)).toBe(true);
      await live.stop();
      expect(pipeline.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records while the session is still connecting and sends that audio first, in order', async () => {
    const calls: Call[] = [];
    let resolveSession!: (r: BffResult<unknown>) => void;
    const api = vi.fn(async (path: string, options?: BffOptions) => {
      calls.push({ path, options });
      if (path === '/api/v1/voice/sessions') {
        return new Promise<BffResult<unknown>>((r) => {
          resolveSession = r;
        });
      }
      return { ok: true, status: 204, data: undefined, etag: null };
    });
    const recorder = new FakeRecorder();
    const states: LiveVoiceState[] = [];
    const live = new LiveVoiceSession(
      { onState: (st) => states.push(st) },
      {
        api: api as never,
        fetch: (async () => controlledStream().response) as unknown as typeof globalThis.fetch,
        getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
        createRecorder: () => recorder,
        isTypeSupported: () => true,
        sleep: async () => undefined,
      },
    );
    const starting = live.start();
    await flush();
    expect(recorder.start).toHaveBeenCalled(); // already recording
    expect(states.at(-1)).toBe('listening');
    recorder.emit('hey');
    recorder.emit('karen');
    await flush();
    expect(audioSeqs(calls)).toEqual([]); // nothing sent before the session exists
    resolveSession({ ok: true, status: 201, data: session, etag: null });
    await starting;
    await flush();
    expect(audioSeqs(calls)).toEqual([0, 1]);
    await live.stop();
  });

  it('stop() while connecting closes the new session and records nothing more', async () => {
    let resolveSession!: (r: BffResult<unknown>) => void;
    const calls: Call[] = [];
    const api = vi.fn(async (path: string, options?: BffOptions) => {
      calls.push({ path, options });
      if (path === '/api/v1/voice/sessions') {
        return new Promise<BffResult<unknown>>((r) => {
          resolveSession = r;
        });
      }
      return { ok: true, status: 202, data: undefined, etag: null };
    });
    const recorder = new FakeRecorder();
    const live = new LiveVoiceSession(
      {},
      {
        api: api as never,
        getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
        createRecorder: () => recorder,
        isTypeSupported: () => true,
        sleep: async () => undefined,
      },
    );
    const starting = live.start();
    await flush();
    await live.stop();
    expect(recorder.stop).toHaveBeenCalled();
    resolveSession({ ok: true, status: 201, data: session, etag: null });
    await starting;
    await flush();
    expect(calls.map((c) => c.path)).toContain(`/api/v1/voice/sessions/${SID}/close`);
    expect(audioSeqs(calls)).toEqual([]);
  });
});
