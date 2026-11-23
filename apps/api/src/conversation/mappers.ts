import type { ChatStreamEvent, Conversation, Message, MessageStatus } from '@karen/api-contracts';
import type {
  ConversationMessage,
  ConversationThread,
  MessageFeedback,
} from '../generated/prisma/client.js';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toConversation(t: ConversationThread): Conversation {
  return {
    id: t.id,
    title: t.title,
    locale: t.locale,
    mode: t.mode as Conversation['mode'],
    pinned: t.pinned,
    archived: t.archivedAt !== null,
    archived_at: iso(t.archivedAt),
    last_message_at: iso(t.lastMessageAt),
    expires_at: iso(t.expiresAt),
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
    version: t.version,
  };
}

export type MessageRow = ConversationMessage & { feedback?: MessageFeedback | null };

/** Safe failure text for persisted error codes (the code alone is stored). */
const FAILURE_TEXT: Record<string, string> = {
  CANCELED: 'You stopped this answer.',
  GENERATION_INTERRUPTED: 'The answer was interrupted. You can regenerate it.',
  GENERATION_TIMEOUT: 'The answer took too long. You can try again.',
  AI_BUSY: 'KAREN is very busy right now. Please try again in a moment.',
  AI_UNAVAILABLE: 'KAREN couldn’t answer just now. Please try again.',
  SERVICE_LIMIT_REACHED: 'KAREN has reached its AI usage limit for now. Please try again later.',
};

export const failureText = (code: string): string =>
  FAILURE_TEXT[code] ?? 'KAREN couldn’t answer just now. Please try again.';

export function toMessage(m: MessageRow): Message {
  return {
    id: m.id,
    conversation_id: m.threadId,
    seq: m.seq,
    role: m.role as Message['role'],
    status: m.status as MessageStatus,
    content: m.content,
    reply_to_message_id: m.replyToMessageId,
    regenerated_from_message_id: m.regeneratedFromId,
    superseded: m.supersededAt !== null,
    error: m.errorCode
      ? {
          code: m.errorCode,
          message: failureText(m.errorCode),
          retryable: m.errorRetryable ?? false,
        }
      : null,
    is_mock: m.role === 'assistant' ? m.isMock : null,
    route_tier: m.routeTier,
    feedback: m.feedback
      ? {
          rating: m.feedback.rating as 'up' | 'down',
          category: (m.feedback.category as NonNullable<Message['feedback']>['category']) ?? null,
        }
      : null,
    last_event_seq: m.lastEventSeq,
    created_at: m.createdAt.toISOString(),
    completed_at: iso(m.completedAt),
  };
}

/**
 * The terminal event that describes a finished message — used when its stored events were
 * purged by retention but a client resumes the stream anyway.
 */
export function terminalEventFor(m: ConversationMessage): ChatStreamEvent | null {
  const seq = Math.max(m.lastEventSeq, 1);
  switch (m.status) {
    case 'completed':
      return {
        seq,
        type: 'complete',
        status: 'completed',
        finish_reason: m.finishReason ?? 'stop',
        is_mock: m.isMock ?? false,
        route_tier: m.routeTier,
      };
    case 'incomplete':
    case 'failed':
    case 'canceled': {
      const code = m.errorCode ?? (m.status === 'canceled' ? 'CANCELED' : 'AI_UNAVAILABLE');
      return {
        seq,
        type: 'error',
        status: m.status,
        code,
        message: failureText(code),
        retryable: m.errorRetryable ?? m.status !== 'canceled',
      };
    }
    default:
      return null;
  }
}
