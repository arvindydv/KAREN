import type { ChatStreamEvent, Message } from '@karen/api-contracts';

/** Client view of a conversation's messages (ascending by seq). */
export interface MessagesState {
  items: Message[];
  /** `before` cursor for older messages; null at the start of the conversation. */
  olderCursor: string | null;
}

export type MessagesAction =
  | { type: 'loaded'; items: Message[]; olderCursor: string | null }
  | { type: 'older'; items: Message[]; olderCursor: string | null }
  | { type: 'upsert'; messages: Message[] }
  | { type: 'event'; messageId: string; event: ChatStreamEvent };

const bySeq = (a: Message, b: Message) => a.seq - b.seq;

function merge(current: Message[], incoming: Message[]): Message[] {
  const map = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) {
    const prev = map.get(m.id);
    // A stale fetch must never undo events already applied from the stream.
    if (!prev || m.last_event_seq >= prev.last_event_seq) map.set(m.id, m);
  }
  return [...map.values()].sort(bySeq);
}

/** Applies one public stream event to its message (idempotent by seq). */
export function applyEvent(m: Message, e: ChatStreamEvent): Message {
  if (e.seq <= m.last_event_seq) return m;
  const next: Message = { ...m, last_event_seq: e.seq };
  switch (e.type) {
    case 'accepted':
      return { ...next, status: 'accepted' };
    case 'status':
      return { ...next, status: e.status };
    case 'token_delta':
      return { ...next, status: 'streaming', content: m.content + e.text };
    case 'complete':
      return {
        ...next,
        status: 'completed',
        is_mock: e.is_mock,
        route_tier: e.route_tier,
        completed_at: new Date().toISOString(),
      };
    case 'error':
      return {
        ...next,
        status: e.status,
        error: { code: e.code, message: e.message, retryable: e.retryable },
        completed_at: new Date().toISOString(),
      };
    default:
      return next; // usage / reserved events change nothing visible
  }
}

export function messagesReducer(state: MessagesState, action: MessagesAction): MessagesState {
  switch (action.type) {
    case 'loaded':
      return { items: merge(state.items, action.items), olderCursor: action.olderCursor };
    case 'older':
      return { items: merge(state.items, action.items), olderCursor: action.olderCursor };
    case 'upsert':
      return { ...state, items: merge(state.items, action.messages) };
    case 'event':
      return {
        ...state,
        items: state.items.map((m) =>
          m.id === action.messageId ? applyEvent(m, action.event) : m,
        ),
      };
  }
}

export const isActive = (m: Message): boolean =>
  m.role === 'assistant' &&
  (m.status === 'pending' || m.status === 'accepted' || m.status === 'streaming');

/** Messages shown in the transcript (superseded answers are replaced by their regeneration). */
export const visibleMessages = (items: Message[]): Message[] => items.filter((m) => !m.superseded);

/** The latest visible assistant message (only it can be regenerated). */
export function latestAssistant(items: Message[]): Message | null {
  const visible = visibleMessages(items);
  const last = visible.at(-1);
  return last?.role === 'assistant' ? last : null;
}
