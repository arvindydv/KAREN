import { z } from 'zod';
import { memoryStatusSchema } from './memory.js';

/**
 * Phase 02 — conversations, messages and the public chat streaming protocol
 * (ADR-0021 data model, ADR-0022 streaming, ADR-0023 usage limits).
 *
 * Ownership rules the server enforces (never the client): the author of every message is
 * derived from the route (`user`) or from the generation pipeline (`assistant`); clients cannot
 * create assistant messages, sources, tool proposals or outcomes.
 */

export const CONVERSATION_MODES = ['standard', 'ephemeral'] as const;
export const conversationModeSchema = z.enum(CONVERSATION_MODES);
export type ConversationMode = z.infer<typeof conversationModeSchema>;

/** Hours an ephemeral conversation is kept before automatic deletion. */
export const EPHEMERAL_RETENTION_HOURS = 24;

/** Bounds shared by server validation and client input limits. */
export const MESSAGE_MAX_CHARS = 8_000;
export const TITLE_MAX_CHARS = 120;
export const SEARCH_MAX_CHARS = 100;

export const MESSAGE_ROLES = ['user', 'assistant'] as const;
export const MESSAGE_STATUSES = [
  'pending',
  'accepted',
  'streaming',
  'completed',
  'incomplete',
  'failed',
  'canceled',
] as const;
export const messageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof messageStatusSchema>;
/** Statuses after which a message never changes again (except feedback / supersession). */
export const TERMINAL_MESSAGE_STATUSES = ['completed', 'incomplete', 'failed', 'canceled'] as const;
export const isTerminalMessageStatus = (s: MessageStatus): boolean =>
  (TERMINAL_MESSAGE_STATUSES as readonly string[]).includes(s);

export const FEEDBACK_CATEGORIES = [
  'wrong_fact',
  'too_slow',
  'language',
  'unsafe_action',
  'unhelpful',
  'other',
] as const;
export const feedbackRatingSchema = z.enum(['up', 'down']);

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title cannot be empty')
  .max(TITLE_MAX_CHARS, `At most ${TITLE_MAX_CHARS} characters`);

export const conversationSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    locale: z.string(),
    mode: conversationModeSchema,
    pinned: z.boolean(),
    archived: z.boolean(),
    archived_at: z.iso.datetime().nullable(),
    last_message_at: z.iso.datetime().nullable(),
    /** Ephemeral conversations: when the server deletes it automatically. */
    expires_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    /** For `If-Match` on PATCH. */
    version: z.number().int().min(0),
    /**
     * Phase 03 (D8): this conversation's memory switch. Ephemeral conversations are always false.
     * Memory is used only when this is on AND the feature is on AND memory permission is eligible.
     */
    memory_enabled: z.boolean(),
    /** Detail responses only: the effective memory status the chat header shows (D8, §3.5). */
    memory_status: memoryStatusSchema.optional(),
  })
  .strict()
  .meta({ id: 'Conversation' });
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationListSchema = z
  .object({ items: z.array(conversationSchema), next_cursor: z.string().nullable() })
  .strict()
  .meta({ id: 'ConversationList' });
export type ConversationList = z.infer<typeof conversationListSchema>;

export const conversationListQuerySchema = z
  .object({
    cursor: z.string().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** Case-insensitive search over titles and message text (your conversations only). */
    q: z.string().trim().min(1).max(SEARCH_MAX_CHARS).optional(),
    archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  })
  .strict();
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const createConversationRequestSchema = z
  .object({
    title: titleSchema.optional(),
    /** BCP 47; defaults to the profile locale. */
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Use a locale like en-IN or hi-IN')
      .optional(),
    mode: conversationModeSchema.default('standard'),
    /**
     * Phase 03. Omit for the default (on for standard conversations when memory permission is
     * eligible). `true` without permission → 403 CONSENT_REQUIRED; `true` on an ephemeral
     * conversation → 400. Ignored while the memory feature is off.
     */
    memory_enabled: z.boolean().optional(),
  })
  .strict()
  .meta({ id: 'CreateConversationRequest' });
export type CreateConversationRequest = z.input<typeof createConversationRequestSchema>;

export const updateConversationRequestSchema = z
  .object({
    title: titleSchema.optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    /** Phase 03: same rules as on create; turning it off never needs permission. */
    memory_enabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field')
  .meta({ id: 'UpdateConversationRequest' });

export const deleteConversationQuerySchema = z
  .object({
    /**
     * Phase 03 (M-05, Q12 pending): also delete the memories saved from this conversation, in the
     * same transaction. Default false: saved memories are kept (and stay manageable in Memory).
     */
    delete_memories: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .strict();
export type UpdateConversationRequest = z.infer<typeof updateConversationRequestSchema>;

export const messageErrorSchema = z
  .object({
    code: z.string(),
    /** Safe, user-presentable. */
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();

export const messageSchema = z
  .object({
    id: z.uuid(),
    conversation_id: z.uuid(),
    /** Position in the conversation (stable order). */
    seq: z.number().int().positive(),
    role: z.enum(MESSAGE_ROLES),
    status: messageStatusSchema,
    /** Plain text / Markdown. Rendered WITHOUT raw HTML by clients. */
    content: z.string(),
    /** Assistant: the user message it answers. */
    reply_to_message_id: z.uuid().nullable(),
    /** Assistant: the earlier answer this one regenerates. */
    regenerated_from_message_id: z.uuid().nullable(),
    /** True when a newer regenerated answer replaced this one. */
    superseded: z.boolean(),
    error: messageErrorSchema.nullable(),
    /**
     * Assistant: `true` when produced by the local mock gateway (labelled SANDBOX in the UI,
     * never presented as a real model answer); `false` for live or deterministic answers.
     */
    is_mock: z.boolean().nullable(),
    /** Assistant: `NO_MODEL` for exact answers computed by code (date/time). */
    route_tier: z.string().nullable(),
    feedback: z
      .object({
        rating: feedbackRatingSchema,
        category: z.enum(FEEDBACK_CATEGORIES).nullable(),
      })
      .strict()
      .nullable(),
    /** Last persisted stream event seq (resume with `Last-Event-ID`). */
    last_event_seq: z.number().int().min(0),
    created_at: z.iso.datetime(),
    completed_at: z.iso.datetime().nullable(),
  })
  .strict()
  .meta({ id: 'Message' });
export type Message = z.infer<typeof messageSchema>;

export const messageListSchema = z
  .object({
    /** Ascending by `seq`. */
    items: z.array(messageSchema),
    /** Pass as `before` to load older messages; null when at the start. */
    next_cursor: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'MessageList' });
export type MessageList = z.infer<typeof messageListSchema>;

export const messageListQuerySchema = z
  .object({
    before: z
      .string()
      .regex(/^\d{1,9}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const messageContentSchema = z
  .string()
  .refine((s) => s.trim().length > 0, 'Message cannot be empty')
  .refine((s) => s.length <= MESSAGE_MAX_CHARS, `At most ${MESSAGE_MAX_CHARS} characters`);

export const sendMessageRequestSchema = z
  .object({
    content: messageContentSchema,
  })
  .strict()
  .meta({ id: 'SendMessageRequest' });
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const forkConversationRequestSchema = z
  .object({
    /** A user message in the source conversation; the fork keeps everything before it. */
    from_message_id: z.uuid(),
    /** The edited text that replaces that message in the new conversation. */
    content: messageContentSchema,
  })
  .strict()
  .meta({ id: 'ForkConversationRequest' });
export type ForkConversationRequest = z.infer<typeof forkConversationRequestSchema>;

/** 202: the user message is stored; the answer is generated asynchronously (stream it). */
export const sendMessageResponseSchema = z
  .object({
    conversation: conversationSchema,
    user_message: messageSchema,
    assistant_message: messageSchema,
    /** Relative path of the SSE stream for `assistant_message`. */
    stream_path: z.string(),
  })
  .strict()
  .meta({ id: 'SendMessageResponse' });
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

export const regenerateResponseSchema = z
  .object({ assistant_message: messageSchema, stream_path: z.string() })
  .strict()
  .meta({ id: 'RegenerateResponse' });
export type RegenerateResponse = z.infer<typeof regenerateResponseSchema>;

export const feedbackRequestSchema = z
  .object({
    rating: feedbackRatingSchema,
    category: z.enum(FEEDBACK_CATEGORIES).optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict()
  .meta({ id: 'FeedbackRequest' });
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

// ── Usage limits (ADR-0023) ─────────────────────────────────────────────────────────────

const usageWindowSchema = z
  .object({
    /** 0..1 share of the limit used (money is not exposed to clients). */
    used_ratio: z.number().min(0),
    limit_reached: z.boolean(),
    resets_at: z.iso.datetime(),
  })
  .strict();

export const aiUsageSchema = z
  .object({
    daily: usageWindowSchema,
    monthly: usageWindowSchema,
    /** `mock` = local test gateway: answers are labelled and nothing is billed. */
    gateway_mode: z.enum(['mock', 'live']),
  })
  .strict()
  .meta({ id: 'AiUsage' });
export type AiUsage = z.infer<typeof aiUsageSchema>;

// ── Public SSE protocol (ADR-0022) ──────────────────────────────────────────────────────
// Each frame: `id: <seq>` · `event: <type>` · `data: <JSON of the event>`. `seq` is monotonic
// per assistant message; reconnect with `Last-Event-ID: <seq>` to resume without duplicates.
// A stream ends after `complete` or `error`. Comment lines (`: ping`) are heartbeats.

const base = { seq: z.number().int().positive() };

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...base,
      type: z.literal('accepted'),
      message_id: z.uuid(),
      conversation_id: z.uuid(),
    })
    .strict(),
  z.object({ ...base, type: z.literal('status'), status: messageStatusSchema }).strict(),
  z.object({ ...base, type: z.literal('token_delta'), text: z.string() }).strict(),
  /** Reserved (Phase 08 grounded search). Not emitted in Phase 02. */
  z
    .object({
      ...base,
      type: z.literal('source'),
      title: z.string(),
      url: z.string(),
      retrieved_at: z.iso.datetime(),
    })
    .strict(),
  /** Reserved (Phase 04 approvals). Not emitted in Phase 02: no tools are exposed to the model. */
  z.object({ ...base, type: z.literal('tool_proposed'), tool: z.string() }).strict(),
  z
    .object({
      ...base,
      type: z.literal('usage'),
      input_tokens: z.number().int().min(0).nullable(),
      output_tokens: z.number().int().min(0).nullable(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('complete'),
      status: z.literal('completed'),
      finish_reason: z.string(),
      is_mock: z.boolean(),
      route_tier: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('error'),
      /** Terminal status of the message after this error. */
      status: z.enum(['failed', 'incomplete', 'canceled']),
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .strict(),
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
export type ChatStreamEventType = ChatStreamEvent['type'];
