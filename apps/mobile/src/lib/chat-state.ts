import type { ChatStreamEvent, Message, MessageStatus } from '@karen/api-contracts';

/** Live view of one assistant message while it streams. */
export interface LiveMessage {
  id: string;
  content: string;
  status: MessageStatus;
  /** Highest event seq applied — the resume point (`Last-Event-ID`). */
  lastSeq: number;
  isMock: boolean | null;
  routeTier: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
  done: boolean;
}

export const liveFromMessage = (m: Message): LiveMessage => ({
  id: m.id,
  content: m.content,
  status: m.status,
  lastSeq: m.last_event_seq,
  isMock: m.is_mock,
  routeTier: m.route_tier,
  error: m.error,
  done: ['completed', 'incomplete', 'failed', 'canceled'].includes(m.status),
});

/**
 * Applies one event. Events at or below `lastSeq` are duplicates (replay after reconnect) and
 * are ignored, so text is never appended twice. Pure.
 */
export function applyChatEvent(state: LiveMessage, event: ChatStreamEvent): LiveMessage {
  if (event.seq <= state.lastSeq || state.done) return state;
  const next = { ...state, lastSeq: event.seq };
  switch (event.type) {
    case 'accepted':
      return { ...next, status: next.status === 'pending' ? 'accepted' : next.status };
    case 'status':
      return { ...next, status: event.status };
    case 'token_delta':
      return { ...next, status: 'streaming', content: next.content + event.text };
    case 'complete':
      return {
        ...next,
        status: 'completed',
        isMock: event.is_mock,
        routeTier: event.route_tier,
        done: true,
      };
    case 'error':
      return {
        ...next,
        status: event.status,
        error: { code: event.code, message: event.message, retryable: event.retryable },
        done: true,
      };
    default:
      return next; // usage / reserved types: position only
  }
}

/** Replaces a live view with an authoritative server snapshot when it is at least as new. */
export function mergeSnapshot(state: LiveMessage, m: Message): LiveMessage {
  if (m.last_event_seq < state.lastSeq) return state;
  return liveFromMessage(m);
}
