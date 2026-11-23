import { chatStreamEventSchema, type ChatStreamEvent } from '@karen/api-contracts';

/** One server-sent-events frame (WHATWG EventSource field rules, minus `retry`). */
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
  /** True for comment-only frames (`: ping` heartbeats). */
  heartbeat: boolean;
}

/**
 * Incremental SSE parser: feed arbitrary text chunks (frames may be split anywhere, CRLF or LF
 * line endings), get complete frames back. Pure and synchronous — unit-tested in isolation.
 */
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk;
      // Normalise CRLF/CR, but keep a trailing lone CR (its LF may arrive in the next chunk).
      const keepCr = buffer.endsWith('\r');
      buffer =
        (keepCr ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, '\n') + (keepCr ? '\r' : '');
      const frames: SseFrame[] = [];
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame(raw);
        if (frame) frames.push(frame);
        boundary = buffer.indexOf('\n\n');
      }
      return frames;
    },
  };
}

function parseFrame(raw: string): SseFrame | null {
  const data: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  let comment = false;
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    if (line.startsWith(':')) {
      comment = true;
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
    else if (field === 'event') event = value;
  }
  if (data.length === 0) return comment ? { data: '', heartbeat: true } : null;
  return {
    ...(id !== undefined ? { id } : {}),
    ...(event !== undefined ? { event } : {}),
    data: data.join('\n'),
    heartbeat: false,
  };
}

/** Validates a frame's data against the public chat event contract; null if it is not one. */
export function toChatEvent(frame: SseFrame): ChatStreamEvent | null {
  if (frame.heartbeat || !frame.data) return null;
  let json: unknown;
  try {
    json = JSON.parse(frame.data);
  } catch {
    return null;
  }
  const parsed = chatStreamEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export const isTerminalEvent = (e: ChatStreamEvent): boolean =>
  e.type === 'complete' || e.type === 'error';

/** Reconnect delay: 0.5 s, 1 s, 2 s … capped at 15 s, with ±20 % jitter (random in [0,1)). */
export function backoffDelay(attempt: number, random: number = Math.random()): number {
  const base = Math.min(500 * 2 ** Math.max(0, attempt), 15_000);
  return Math.round(base * (0.8 + 0.4 * random));
}
