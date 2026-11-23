import type { ChatStreamEvent, Message } from '@karen/api-contracts';
import { ApiRequestError } from './api-error';
import { backoffDelay, createSseParser, isTerminalEvent, toChatEvent } from './sse';

/**
 * Follows one assistant message's SSE stream (ADR-0022) on mobile.
 *
 * - Uses a streaming-capable fetch (`expo/fetch` in the app) with the bearer token from the
 *   session manager; a 401 triggers ONE single-flight refresh and retry.
 * - Resumes with `Last-Event-ID: <lastSeq>` after any drop, with jittered backoff; events at
 *   or below `lastSeq` are ignored, so text is never duplicated.
 * - `pause()` (app backgrounded) closes the connection and keeps the resume point;
 *   `resume()` (foreground again) reconnects from it.
 * - If the runtime cannot stream response bodies, it falls back to polling the message every
 *   second until it is terminal (`onSnapshot`).
 *
 * NOT VERIFIED on physical iOS/Android devices (Phase 02 spike SP-2).
 */
export type StreamConnection =
  'connecting' | 'live' | 'reconnecting' | 'offline' | 'polling' | 'paused' | 'closed';

export interface ChatStreamDeps {
  baseUrl: string;
  getAccessToken: () => Promise<string | undefined>;
  handleUnauthorized: (usedToken: string | undefined) => Promise<string | undefined>;
  /** Must support streaming response bodies (`expo/fetch`). */
  fetch: typeof globalThis.fetch;
  /** GET the message (polling fallback). */
  pollMessage: () => Promise<Message>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  pollIntervalMs?: number;
}

export interface StreamHandlers {
  onEvent: (event: ChatStreamEvent) => void;
  onSnapshot: (message: Message) => void;
  onConnection: (state: StreamConnection) => void;
  /** Unrecoverable (404/403/session ended): stop and show an error. */
  onFatal: (error: Error) => void;
}

class FatalStreamError extends Error {}

const TERMINAL = ['completed', 'incomplete', 'failed', 'canceled'];
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ChatStreamFollower {
  private lastSeq: number;
  private generation = 0;
  private controller: AbortController | null = null;
  private finished = false;
  private paused = false;

  constructor(
    private readonly deps: ChatStreamDeps,
    private readonly path: string,
    lastSeq: number,
    private readonly handlers: StreamHandlers,
  ) {
    this.lastSeq = lastSeq;
  }

  get resumePoint(): number {
    return this.lastSeq;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  start(): void {
    if (this.finished) return;
    this.paused = false;
    const gen = ++this.generation;
    // Never leave an older connection open beside the new one.
    this.controller?.abort();
    void this.run(gen);
  }

  /** App backgrounded: drop the connection, keep the resume point. */
  pause(): void {
    if (this.finished || this.paused) return;
    this.paused = true;
    this.generation++;
    this.controller?.abort();
    this.handlers.onConnection('paused');
  }

  /**
   * App foregrounded: reconnect from the last seq. A no-op unless paused — iOS reports
   * `active` after every `inactive` blip (Control Centre, system sheets) without a background,
   * and restarting then would open a second connection beside the live one.
   */
  resume(): void {
    if (this.finished || !this.paused) return;
    this.start();
  }

  close(): void {
    this.finished = true;
    this.generation++;
    this.controller?.abort();
    this.handlers.onConnection('closed');
  }

  private alive = (gen: number) => !this.finished && gen === this.generation;

  private async run(gen: number): Promise<void> {
    const sleep = this.deps.sleep ?? defaultSleep;
    let attempt = 0;
    while (this.alive(gen)) {
      this.handlers.onConnection(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        const outcome = await this.connectOnce(gen);
        if (outcome === 'done') return this.finish();
        if (outcome === 'unsupported') return void (await this.poll(gen));
        if (outcome === 'progress') attempt = 0;
      } catch (error) {
        if (!this.alive(gen)) return;
        if (error instanceof FatalStreamError) {
          this.finished = true;
          this.handlers.onConnection('closed');
          this.handlers.onFatal(error);
          return;
        }
        this.handlers.onConnection('offline');
      }
      if (!this.alive(gen)) return;
      await sleep(backoffDelay(attempt++, (this.deps.random ?? Math.random)()));
    }
  }

  private finish(): void {
    this.finished = true;
    this.handlers.onConnection('closed');
  }

  private async open(gen: number, token: string | undefined): Promise<Response> {
    const controller = new AbortController();
    this.controller = controller;
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (this.lastSeq > 0) headers['last-event-id'] = String(this.lastSeq);
    const res = await this.deps.fetch(`${this.deps.baseUrl.replace(/\/$/, '')}${this.path}`, {
      headers,
      signal: controller.signal,
    });
    // Abort THIS attempt's request only: `this.controller` may already belong to a newer one.
    if (!this.alive(gen)) controller.abort();
    return res;
  }

  /** One connection. 'done' = terminal event seen; 'progress'/'ended' = reconnect. */
  private async connectOnce(gen: number): Promise<'done' | 'progress' | 'ended' | 'unsupported'> {
    const token = await this.deps.getAccessToken();
    let res = await this.open(gen, token);
    if (res.status === 401) {
      const fresh = await this.deps.handleUnauthorized(token);
      if (!fresh) throw new FatalStreamError('Your session has ended. Please sign in again.');
      res = await this.open(gen, fresh);
    }
    if (res.status === 404 || res.status === 403 || res.status === 401) {
      throw new FatalStreamError('This answer is no longer available.');
    }
    if (!res.ok) throw new Error(`stream HTTP ${res.status}`);
    const reader = res.body?.getReader?.();
    if (!reader) return 'unsupported';
    this.handlers.onConnection('live');
    const parser = createSseParser();
    const decoder = new TextDecoder();
    let progressed = false;
    try {
      while (this.alive(gen)) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
        for (const frame of parser.push(text)) {
          const event = toChatEvent(frame);
          if (!event || event.seq <= this.lastSeq) continue;
          this.lastSeq = event.seq;
          progressed = true;
          this.handlers.onEvent(event);
          if (isTerminalEvent(event)) return 'done';
        }
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    return progressed ? 'progress' : 'ended';
  }

  private async poll(gen: number): Promise<void> {
    const sleep = this.deps.sleep ?? defaultSleep;
    this.handlers.onConnection('polling');
    while (this.alive(gen)) {
      try {
        const m = await this.deps.pollMessage();
        if (!this.alive(gen)) return;
        this.lastSeq = Math.max(this.lastSeq, m.last_event_seq);
        this.handlers.onSnapshot(m);
        if (TERMINAL.includes(m.status)) return this.finish();
        this.handlers.onConnection('polling');
      } catch (error) {
        if (!this.alive(gen)) return;
        // Gone / not yours / session ended: polling again can never succeed.
        if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
          this.finished = true;
          this.handlers.onConnection('closed');
          this.handlers.onFatal(
            new FatalStreamError(
              error.status === 401
                ? 'Your session has ended. Please sign in again.'
                : 'This answer is no longer available.',
            ),
          );
          return;
        }
        this.handlers.onConnection('offline');
      }
      await sleep(this.deps.pollIntervalMs ?? 1_000);
    }
  }
}
