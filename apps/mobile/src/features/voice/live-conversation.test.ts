import { describe, expect, it, jest } from '@jest/globals';
import {
  LiveConversation,
  PCM_CHUNK_BYTES,
  type ListenEvent,
  type LiveTransport,
} from './live-conversation';

const SID = `lv_${'a1B2'.repeat(10)}`;
const flush = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(() => r()));
};

/** An SSE response whose frames the test pushes; `end()` closes it. */
function controlledStream() {
  const chunks: string[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  const reader = {
    read: async (): Promise<{ done: boolean; value?: string }> => {
      while (chunks.length === 0 && !ended) await new Promise<void>((r) => (wake = r));
      if (chunks.length > 0) return { done: false, value: chunks.shift()! };
      return { done: true };
    },
  };
  return {
    response: { status: 200, ok: true, body: { getReader: () => reader } } as unknown as Response,
    push(id: number, event: object) {
      chunks.push(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
  };
}

function setup(audioResults: Awaited<ReturnType<LiveTransport['sendAudio']>>[] = []) {
  const stream = controlledStream();
  const sent: { seq: number; bytes: number }[] = [];
  const transport: LiveTransport = {
    createSession: jest.fn(async () => ({
      session_id: SID,
      max_seconds: 300,
      idle_seconds: 20,
      is_mock: false,
    })),
    sendAudio: jest.fn(async (_sid: string, body: { seq: number; audio_base64: string }) => {
      sent.push({ seq: body.seq, bytes: atob(body.audio_base64).length });
      return audioResults.shift() ?? { ok: true as const };
    }),
    closeSession: jest.fn(async () => undefined),
    openEvents: jest.fn(async () => stream.response),
  };
  const events: ListenEvent[] = [];
  return { transport, stream, sent, events, onEvent: (e: ListenEvent) => events.push(e) };
}

describe('LiveConversation (phone ↔ live speech recognition)', () => {
  it('opens a pcm16 session and sends 250 ms chunks in order', async () => {
    const t = setup();
    const live = await LiveConversation.open(
      t.transport,
      { conversationId: 'c1' },
      t.onEvent,
      async () => {},
    );
    expect(t.transport.createSession).toHaveBeenCalledWith({
      audio_format: 'pcm16',
      conversation_id: 'c1',
    });
    live.sendPcm(new Uint8Array(3_000));
    live.sendPcm(new Uint8Array(PCM_CHUNK_BYTES * 2)); // 3 000 + 16 000 → two chunks + 3 000 kept
    await flush();
    expect(t.sent).toEqual([
      { seq: 0, bytes: PCM_CHUNK_BYTES },
      { seq: 1, bytes: PCM_CHUNK_BYTES },
    ]);
    await live.close();
  });

  it('retries a failed chunk with the SAME seq before sending the next', async () => {
    const t = setup([{ ok: false, status: 503, retryable: true }]);
    const live = await LiveConversation.open(t.transport, {}, t.onEvent, async () => {});
    live.sendPcm(new Uint8Array(PCM_CHUNK_BYTES * 2));
    await flush();
    expect(t.sent.map((s) => s.seq)).toEqual([0, 0, 1]);
    await live.close();
  });

  it('delivers partials and each end of turn once, with a stable idempotency key', async () => {
    const t = setup();
    const live = await LiveConversation.open(t.transport, {}, t.onEvent, async () => {});
    t.stream.push(1, { type: 'speech_started', turn_index: 0 });
    t.stream.push(2, { type: 'partial', turn_index: 0, text: 'kal ka' });
    t.stream.push(3, {
      type: 'end_of_turn',
      turn_index: 0,
      text: ' kal ka plan ',
      language: 'hi-Latn',
    });
    t.stream.push(4, {
      type: 'end_of_turn',
      turn_index: 0,
      text: 'kal ka plan',
      language: 'hi-Latn',
    });
    await flush();
    expect(t.events).toEqual([
      { type: 'speech_started' },
      { type: 'partial', text: 'kal ka' },
      { type: 'turn', text: 'kal ka plan', key: `voice-${SID}-0` },
    ]);
    await live.close();
  });

  it('reports the server closing the session and stops sending audio', async () => {
    const t = setup();
    const live = await LiveConversation.open(t.transport, {}, t.onEvent, async () => {});
    t.stream.push(1, { type: 'closed', reason: 'max_duration', audio_seconds: 300 });
    await flush();
    expect(t.events).toEqual([{ type: 'ended', reason: 'max_duration' }]);
    live.sendPcm(new Uint8Array(PCM_CHUNK_BYTES));
    await flush();
    expect(t.sent).toEqual([]);
  });

  it('a gone session (404 on audio) ends the conversation', async () => {
    const t = setup([{ ok: false, status: 404, retryable: false }]);
    const live = await LiveConversation.open(t.transport, {}, t.onEvent, async () => {});
    live.sendPcm(new Uint8Array(PCM_CHUNK_BYTES));
    await flush();
    expect(t.events).toContainEqual({ type: 'ended', reason: 'session_ended' });
  });
});
