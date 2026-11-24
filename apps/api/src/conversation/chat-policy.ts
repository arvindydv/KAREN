/**
 * Pure chat policy helpers (no I/O): context window, auto titles, cursors, AI error mapping,
 * SSE framing. Unit-tested in chat-policy.test.ts.
 */
import type { ChatStreamEvent } from '@karen/api-contracts';
import { ApiError } from '../common/api-error.js';

export const DEFAULT_TITLE = 'New conversation';

// ── Context window ────────────────────────────────────────────────────────────────────────

export interface ContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The bounded context sent to the model: the most recent messages of THIS conversation only
 * (no memory in Phase 02), newest kept first, never exceeding `maxMessages` / `maxChars`.
 * The final user message is always kept (truncated from the start if it alone is too long).
 * The window starts on a user turn so the model never sees an orphaned assistant reply.
 */
export function buildContextWindow(
  history: readonly ContextMessage[],
  limits: { maxMessages: number; maxChars: number },
): ContextMessage[] {
  const usable = history.filter((m) => m.content.trim().length > 0);
  const out: ContextMessage[] = [];
  let chars = 0;
  for (let i = usable.length - 1; i >= 0 && out.length < limits.maxMessages; i--) {
    const m = usable[i]!;
    if (out.length === 0) {
      const content =
        m.content.length > limits.maxChars ? m.content.slice(-limits.maxChars) : m.content;
      out.unshift({ role: m.role, content });
      chars += content.length;
      continue;
    }
    if (chars + m.content.length > limits.maxChars) break;
    out.unshift(m);
    chars += m.content.length;
  }
  while (out.length > 1 && out[0]!.role !== 'user') out.shift();
  return out;
}

// ── Titles ────────────────────────────────────────────────────────────────────────────────

/** A short, single-line title from the first user message (no model call). */
export function autoTitle(firstMessage: string, max = 60): string {
  const line = firstMessage
    .replace(/\[\[mock:[^\]]*\]\]/g, '')
    .replace(/[`*_#>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return DEFAULT_TITLE;
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ── Cursors (opaque to clients) ──────────────────────────────────────────────────────────

export interface ThreadCursor {
  pinned: boolean;
  /** ISO timestamp of COALESCE(last_message_at, created_at). */
  at: string;
  id: string;
}

export const encodeThreadCursor = (c: ThreadCursor): string =>
  Buffer.from(JSON.stringify([c.pinned ? 1 : 0, c.at, c.id])).toString('base64url');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeThreadCursor(raw: string): ThreadCursor {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(v) &&
      v.length === 3 &&
      (v[0] === 0 || v[0] === 1) &&
      typeof v[1] === 'string' &&
      !Number.isNaN(Date.parse(v[1])) &&
      typeof v[2] === 'string' &&
      UUID_RE.test(v[2])
    ) {
      return { pinned: v[0] === 1, at: v[1], id: v[2] };
    }
  } catch {
    // fall through: malformed cursors are a client error, reported below
  }
  throw new ApiError('VALIDATION_FAILED', 'Invalid cursor.');
}

/** Escapes LIKE metacharacters so search text is matched literally. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ── AI failure → user-facing message error ───────────────────────────────────────────────

export interface MessageFailure {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Maps internal AI/transport error codes to safe, user-presentable failures. Internal details
 * (model ids, provider names, upstream messages) never reach the client.
 */
export function mapAiFailure(code: string, retryable: boolean): MessageFailure {
  switch (code) {
    case 'CONSENT_REQUIRED':
      return {
        code: 'CONSENT_REQUIRED',
        message: 'AI assistance is turned off. Turn it on in Settings › Privacy.',
        retryable: false,
      };
    case 'BUDGET_EXCEEDED':
      return {
        code: 'SERVICE_LIMIT_REACHED',
        message: 'KAREN has reached its AI usage limit for now. Please try again later.',
        retryable: false,
      };
    case 'GATEWAY_RATE_LIMITED':
      return {
        code: 'AI_BUSY',
        message: 'KAREN is very busy right now. Please try again in a moment.',
        retryable: true,
      };
    case 'GATEWAY_TIMEOUT':
    case 'GENERATION_TIMEOUT':
      return {
        code: 'GENERATION_TIMEOUT',
        message: 'The answer took too long. You can try again.',
        retryable: true,
      };
    case 'CAPABILITY_UNAVAILABLE':
    case 'TIER_DISABLED':
      return {
        code: 'AI_UNAVAILABLE',
        message: 'Chat is not available right now.',
        retryable: false,
      };
    case 'AI_SERVICE_STREAM_DROPPED':
    case 'GENERATION_INTERRUPTED':
      return {
        code: 'GENERATION_INTERRUPTED',
        message: 'The answer was interrupted. You can regenerate it.',
        retryable: true,
      };
    default:
      return {
        code: 'AI_UNAVAILABLE',
        message: 'KAREN couldn’t answer just now. Please try again.',
        retryable: retryable || code === 'AI_SERVICE_UNREACHABLE',
      };
  }
}

// ── SSE framing ──────────────────────────────────────────────────────────────────────────

export const sseFrame = (event: ChatStreamEvent): string =>
  `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

export const SSE_HEARTBEAT = ': ping\n\n';

/** The slice of a writable socket that backpressure needs. */
export interface DrainableStream {
  once(event: 'drain' | 'close', listener: () => void): unknown;
  off(event: 'drain' | 'close', listener: () => void): unknown;
}

/**
 * Waits for a full socket buffer to drain. Also settles when the socket closes or `signal`
 * aborts: a closed socket never emits `drain`, and waiting on it alone would hang the reader
 * forever (leaking its pub/sub subscription and database polling).
 */
export function waitForDrain(stream: DrainableStream, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      stream.off('drain', done);
      stream.off('close', done);
      signal.removeEventListener('abort', done);
      resolve();
    };
    stream.once('drain', done);
    stream.once('close', done);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Parses a `Last-Event-ID` header / `after` query value; invalid → 0 (replay everything). */
export function parseResumeSeq(raw: string | undefined): number {
  if (!raw || !/^\d{1,9}$/.test(raw.trim())) return 0;
  return Number(raw.trim());
}

// ── Usage periods (UTC) ──────────────────────────────────────────────────────────────────

export const MICRO_USD_PER_USD = 1_000_000;
export const usdToMicro = (usd: number): number => Math.ceil(usd * MICRO_USD_PER_USD);

export function usagePeriods(now: Date) {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  const month = day.slice(0, 6);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayReset = new Date(dayStart.getTime() + 86_400_000);
  const monthReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { day, month, dayStart, monthStart, dayReset, monthReset };
}

/**
 * The name KAREN may call the user by (ADR-0034): the preferred name, else the first word of the
 * display name. Only letters/marks and ` . ' -` survive and at most 40 characters, so a name can
 * never carry instructions into the model prompt. Null when nothing usable is left.
 */
export function addressName(
  preferred: string | null | undefined,
  display: string | null | undefined,
): string | null {
  const source = preferred?.trim() || display?.trim().split(/\s+/)[0] || '';
  const cleaned = source
    .normalize('NFC')
    .replace(/[^\p{L}\p{M} .'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
  return /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(cleaned) ? cleaned : null;
}
