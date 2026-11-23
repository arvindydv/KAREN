import type { ChatStreamEvent } from '@karen/api-contracts';
import { parseApiError, type ApiErrorBody } from '../errors';
import { SseParser } from './sse';

export type StreamConnection = 'connecting' | 'open' | 'reconnecting' | 'offline' | 'closed';

export interface StreamOptions {
  /** BFF path, e.g. /api/v1/conversations/{id}/messages/{mid}/stream */
  path: string;
  /** Last event seq already applied (resume point). */
  afterSeq: number;
  onEvent: (event: ChatStreamEvent) => void;
  onConnection?: (state: StreamConnection) => void;
  signal: AbortSignal;
  fetch?: typeof globalThis.fetch;
  /** Waits until the browser is online (injectable for tests). */
  waitForOnline?: (signal: AbortSignal) => Promise<void>;
  isOnline?: () => boolean;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  maxAttempts?: number;
}

export type StreamOutcome =
  | { kind: 'terminal'; event: ChatStreamEvent }
  | { kind: 'aborted' }
  | { kind: 'error'; status: number; error: ApiErrorBody | null };

const isTerminal = (e: ChatStreamEvent) => e.type === 'complete' || e.type === 'error';

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

const defaultWaitForOnline = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (typeof navigator === 'undefined' || navigator.onLine) return resolve();
    const done = () => {
      window.removeEventListener('online', done);
      resolve();
    };
    window.addEventListener('online', done);
    signal.addEventListener('abort', done, { once: true });
  });

/** Exponential backoff with jitter: 0.5 s, 1 s, 2 s … capped at 10 s. */
export const backoffMs = (attempt: number, random = Math.random): number =>
  Math.min(10_000, 500 * 2 ** attempt) * (0.75 + random() * 0.5);

/**
 * Follows one assistant message's event stream until its terminal event. Reconnects with
 * `Last-Event-ID` after network drops (waiting for `online` when offline), applies each `seq`
 * exactly once (duplicates and out-of-order replays are ignored), and stops on 4xx errors.
 */
export async function followChatStream(options: StreamOptions): Promise<StreamOutcome> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = options.sleep ?? defaultSleep;
  const waitForOnline = options.waitForOnline ?? defaultWaitForOnline;
  const isOnline = options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine);
  const maxAttempts = options.maxAttempts ?? 12;
  let lastSeq = options.afterSeq;
  let attempt = 0;
  const report = (s: StreamConnection) => options.onConnection?.(s);

  while (!options.signal.aborted) {
    if (!isOnline()) {
      report('offline');
      await waitForOnline(options.signal);
      if (options.signal.aborted) break;
    }
    report(attempt === 0 ? 'connecting' : 'reconnecting');
    let response: Response;
    try {
      response = await doFetch(options.path, {
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          ...(lastSeq > 0 ? { 'last-event-id': String(lastSeq) } : {}),
        },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: options.signal,
      });
    } catch {
      if (options.signal.aborted) break;
      if (++attempt >= maxAttempts) return { kind: 'error', status: 0, error: null };
      await sleep(backoffMs(attempt), options.signal);
      continue;
    }
    if (!response.ok || !response.body) {
      const body: unknown = await response.json().catch(() => null);
      const error = parseApiError(body);
      // 4xx (other than 408/429) will not get better by retrying.
      if (
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 429].includes(response.status)
      ) {
        return { kind: 'error', status: response.status, error };
      }
      if (++attempt >= maxAttempts) return { kind: 'error', status: response.status, error };
      await sleep(backoffMs(attempt), options.signal);
      continue;
    }
    report('open');
    const parser = new SseParser();
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(value)) {
          let event: ChatStreamEvent;
          try {
            event = JSON.parse(frame.data) as ChatStreamEvent;
          } catch {
            continue;
          }
          if (typeof event.seq !== 'number' || event.seq <= lastSeq) continue; // dedupe
          lastSeq = event.seq;
          attempt = 0;
          options.onEvent(event);
          if (isTerminal(event)) {
            report('closed');
            await reader.cancel().catch(() => undefined);
            return { kind: 'terminal', event };
          }
        }
      }
    } catch {
      // Network drop mid-stream: fall through to reconnect from lastSeq.
    }
    if (options.signal.aborted) break;
    if (++attempt >= maxAttempts) return { kind: 'error', status: 0, error: null };
    await sleep(backoffMs(attempt), options.signal);
  }
  report('closed');
  return { kind: 'aborted' };
}
