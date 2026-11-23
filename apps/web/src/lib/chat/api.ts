/** Typed BFF calls for chat (browser side). Every call goes through /api/v1 (never the API). */
import type {
  AiUsage,
  Conversation,
  ConversationList,
  FeedbackRequest,
  Message,
  MessageList,
  RegenerateResponse,
  SendMessageResponse,
  UpdateConversationRequest,
} from '@karen/api-contracts';
import { bff, type BffResult } from '../api';

const base = '/api/v1/conversations';

export const chatApi = {
  list: (q: { cursor?: string | null; q?: string; archived?: 'exclude' | 'only' }) => {
    const p = new URLSearchParams({ limit: '20', archived: q.archived ?? 'exclude' });
    if (q.cursor) p.set('cursor', q.cursor);
    if (q.q) p.set('q', q.q);
    return bff<ConversationList>(`${base}?${p.toString()}`);
  },
  create: (body: { mode: 'standard' | 'ephemeral'; title?: string }) =>
    bff<Conversation>(base, { method: 'POST', json: body }),
  get: (id: string) => bff<Conversation>(`${base}/${id}`),
  update: (c: Pick<Conversation, 'id' | 'version'>, patch: UpdateConversationRequest) =>
    bff<Conversation>(`${base}/${c.id}`, { method: 'PATCH', json: patch, version: c.version }),
  remove: (id: string) => bff<null>(`${base}/${id}`, { method: 'DELETE' }),
  messages: (id: string, before?: string | null) =>
    bff<MessageList>(`${base}/${id}/messages?limit=50${before ? `&before=${before}` : ''}`),
  message: (id: string, mid: string) => bff<Message>(`${base}/${id}/messages/${mid}`),
  send: (id: string, content: string, key: string) =>
    bff<SendMessageResponse>(`${base}/${id}/messages`, {
      method: 'POST',
      json: { content },
      idempotencyKey: key,
    }),
  fork: (id: string, fromMessageId: string, content: string, key: string) =>
    bff<SendMessageResponse>(`${base}/${id}/fork`, {
      method: 'POST',
      json: { from_message_id: fromMessageId, content },
      idempotencyKey: key,
    }),
  cancel: (id: string, mid: string) =>
    bff<Message>(`${base}/${id}/messages/${mid}/cancel`, { method: 'POST' }),
  regenerate: (id: string, mid: string, key: string) =>
    bff<RegenerateResponse>(`${base}/${id}/messages/${mid}/regenerate`, {
      method: 'POST',
      idempotencyKey: key,
    }),
  feedback: (id: string, mid: string, body: FeedbackRequest) =>
    bff<Message>(`${base}/${id}/messages/${mid}/feedback`, { method: 'POST', json: body }),
  clearFeedback: (id: string, mid: string) =>
    bff<Message>(`${base}/${id}/messages/${mid}/feedback`, { method: 'DELETE' }),
  usage: () => bff<AiUsage>('/api/v1/me/ai-usage'),
  streamPath: (id: string, mid: string) => `${base}/${id}/messages/${mid}/stream`,
};

export type { BffResult };

/** "RESETS_AT:<iso>" from a USAGE_LIMIT_REACHED error's next_options. */
export function resetsAt(nextOptions: readonly string[] | undefined): Date | null {
  const raw = nextOptions?.find((o) => o.startsWith('RESETS_AT:'))?.slice('RESETS_AT:'.length);
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}
