import { voiceEventSchema, type VoiceSession } from '@karen/api-contracts';
import { createSseParser } from '../../lib/sse';

/**
 * Live conversation transport for the phone (ADR-0031): the same protocol as the web app.
 *
 *   microphone PCM (16 kHz, 16-bit) → 250 ms chunks → POST /v1/voice/sessions/{id}/audio
 *   GET /v1/voice/sessions/{id}/events (SSE) → speech_started / partial / end_of_turn / closed
 *
 * Deepgram's live model detects the end of each turn (~0.7–1 s after you stop), so there is no
 * record → upload → transcribe wait. Chunks are sent one at a time in order; a failed chunk is
 * retried with the SAME seq (the server drops duplicates). The event stream resumes after the
 * last event id. Each end_of_turn is delivered once. Audio is never stored.
 */
export type ListenEvent =
  | { type: 'speech_started' }
  | { type: 'partial'; text: string }
  | { type: 'turn'; text: string; key: string }
  | { type: 'ended'; reason: string }
  | { type: 'error'; code: string };

export interface LiveTransport {
  createSession(body: {
    conversation_id?: string;
    audio_format: 'pcm16';
    language?: 'en' | 'hi' | 'hi-Latn';
  }): Promise<VoiceSession>;
  sendAudio(
    sessionId: string,
    body: { seq: number; audio_base64: string },
  ): Promise<{ ok: true } | { ok: false; status: number; retryable: boolean }>;
  closeSession(sessionId: string): Promise<void>;
  /** Streaming GET of the event stream (bearer auth, `after` resume point). */
  openEvents(sessionId: string, after: string | null, signal: AbortSignal): Promise<Response>;
}

/** 250 ms of 16 kHz 16-bit mono audio. */
export const PCM_CHUNK_BYTES = 8_000;
const MAX_CHUNK_ATTEMPTS = 4;
const MAX_STREAM_FAILURES = 6;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

export class LiveConversation {
  private seq = 0;
  private pending = new Uint8Array(0);
  private queue: Uint8Array[] = [];
  private pumping = false;
  private closed = false;
  private lastEventId: string | null = null;
  private readonly seenTurns = new Set<number>();
  private readonly abort = new AbortController();

  private constructor(
    private readonly transport: LiveTransport,
    private readonly session: VoiceSession,
    private readonly onEvent: (event: ListenEvent) => void,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  static async open(
    transport: LiveTransport,
    options: { conversationId?: string; language?: 'en' | 'hi' | 'hi-Latn' },
    onEvent: (event: ListenEvent) => void,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ): Promise<LiveConversation> {
    const session = await transport.createSession({
      audio_format: 'pcm16',
      ...(options.conversationId ? { conversation_id: options.conversationId } : {}),
      ...(options.language ? { language: options.language } : {}),
    });
    const live = new LiveConversation(transport, session, onEvent, sleep);
    void live.follow();
    return live;
  }

  get sessionId(): string {
    return this.session.session_id;
  }

  get isMock(): boolean {
    return this.session.is_mock;
  }

  /** Microphone audio (16 kHz, 16-bit mono PCM). Sent in 250 ms chunks. */
  sendPcm(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    const merged = new Uint8Array(this.pending.length + bytes.length);
    merged.set(this.pending);
    merged.set(bytes, this.pending.length);
    let offset = 0;
    while (merged.length - offset >= PCM_CHUNK_BYTES) {
      this.queue.push(merged.slice(offset, offset + PCM_CHUNK_BYTES));
      offset += PCM_CHUNK_BYTES;
    }
    this.pending = merged.slice(offset);
    void this.pump();
  }

  /** Ends the session (server settles usage). Safe to call twice. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.abort.abort();
    try {
      await this.transport.closeSession(this.session.session_id);
    } catch (err) {
      // The server also ends idle sessions by itself; nothing else to do.
      if (__DEV__) console.warn('[karen] live session close failed', (err as Error).name); // eslint-disable-line no-console
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        const chunk = this.queue.shift()!;
        const seq = this.seq++;
        const body = { seq, audio_base64: toBase64(chunk) };
        if (!(await this.sendChunk(body))) return;
      }
    } finally {
      this.pumping = false;
    }
  }

  private async sendChunk(body: { seq: number; audio_base64: string }): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
      let result: Awaited<ReturnType<LiveTransport['sendAudio']>>;
      try {
        result = await this.transport.sendAudio(this.session.session_id, body);
      } catch {
        result = { ok: false, status: 0, retryable: true };
      }
      if (result.ok) return true;
      if (result.status === 404 || !result.retryable || attempt === MAX_CHUNK_ATTEMPTS) {
        this.end(result.status === 404 ? 'session_ended' : 'upload_failed');
        return false;
      }
      await this.sleep(250 * 2 ** (attempt - 1));
    }
    return false;
  }

  private async follow(): Promise<void> {
    let failures = 0;
    while (!this.closed && failures < MAX_STREAM_FAILURES) {
      let res: Response;
      try {
        res = await this.transport.openEvents(
          this.session.session_id,
          this.lastEventId,
          this.abort.signal,
        );
      } catch {
        if (this.abort.signal.aborted) return;
        failures++;
        await this.sleep(400 * 2 ** failures);
        continue;
      }
      if ([401, 403, 404].includes(res.status)) {
        this.end('session_ended');
        return;
      }
      const reader = res.ok ? res.body?.getReader?.() : undefined;
      if (!reader) {
        failures++;
        await this.sleep(400 * 2 ** failures);
        continue;
      }
      const parser = createSseParser();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
          for (const frame of parser.push(text)) {
            failures = 0;
            if (frame.id) this.lastEventId = frame.id;
            if (frame.heartbeat || !frame.data) continue;
            this.apply(frame.data);
            if (this.closed) return;
          }
        }
      } catch {
        if (this.abort.signal.aborted) return;
      }
      if (!this.closed) {
        failures++;
        await this.sleep(400 * 2 ** failures);
      }
    }
    if (!this.closed) {
      this.onEvent({ type: 'error', code: 'STREAM_LOST' });
      this.end('stream_lost');
    }
  }

  private apply(data: string): void {
    let parsed: ReturnType<typeof voiceEventSchema.safeParse>;
    try {
      parsed = voiceEventSchema.safeParse(JSON.parse(data));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const event = parsed.data;
    switch (event.type) {
      case 'speech_started':
        this.onEvent({ type: 'speech_started' });
        return;
      case 'partial':
        this.onEvent({ type: 'partial', text: event.text });
        return;
      case 'end_of_turn': {
        const index = event.turn_index ?? this.seenTurns.size;
        if (this.seenTurns.has(index)) return;
        this.seenTurns.add(index);
        const text = event.text.trim();
        if (text) {
          // Same key for the same turn: a retried send is a no-op on the server.
          this.onEvent({ type: 'turn', text, key: `voice-${this.session.session_id}-${index}` });
        }
        return;
      }
      case 'error':
        this.onEvent({ type: 'error', code: event.code });
        return;
      case 'closed':
        this.end(event.reason);
        return;
      default:
    }
  }

  private end(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.abort.abort();
    this.onEvent({ type: 'ended', reason });
  }
}
