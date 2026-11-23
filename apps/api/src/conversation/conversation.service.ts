import { randomUUID } from 'node:crypto';
import {
  EPHEMERAL_RETENTION_HOURS,
  isTerminalMessageStatus,
  type Conversation,
  type ConversationList,
  type ConversationListQuery,
  type FeedbackRequest,
  type Message,
  type MessageList,
  type MessageStatus,
  type RegenerateResponse,
  type SendMessageResponse,
  type UpdateConversationRequest,
} from '@karen/api-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ConversationThread } from '../generated/prisma/client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';
import {
  DEFAULT_TITLE,
  autoTitle,
  decodeThreadCursor,
  encodeThreadCursor,
  likePattern,
} from './chat-policy.js';
import { GenerationService } from './generation.service.js';
import { StreamHub } from './stream-hub.js';
import { toConversation, toMessage, type MessageRow } from './mappers.js';
import { UsageLimitsService } from './usage-limits.service.js';

const ACTIVE: MessageStatus[] = ['pending', 'accepted', 'streaming'];
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export interface Caller {
  userId: string;
  userRef: string;
}

const notFound = () => new ApiError('NOT_FOUND', 'Conversation not found.');
const messageNotFound = () => new ApiError('NOT_FOUND', 'Message not found.');

export function requireIdempotencyKey(raw: string | undefined): string {
  if (!raw) {
    throw new ApiError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
      details: [{ path: 'Idempotency-Key', message: 'Required' }],
    });
  }
  if (!IDEMPOTENCY_KEY.test(raw)) {
    throw new ApiError('VALIDATION_FAILED', 'Idempotency-Key must be 8–128 URL-safe characters.');
  }
  return raw;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Conversations and messages (Phase 02, ADR-0021). Every query runs in `withUserScope`
 * (PostgreSQL RLS) AND filters by the verified principal's user id. Message authorship is
 * decided here: the route creates `user` messages; only the generation pipeline fills
 * `assistant` messages.
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly generation: GenerationService,
    private readonly hub: StreamHub,
    private readonly usage: UsageLimitsService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private streamPath = (conversationId: string, messageId: string) =>
    `/v1/conversations/${conversationId}/messages/${messageId}/stream`;

  // ── Threads ─────────────────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    input: { title?: string | undefined; locale?: string | undefined; mode: Conversation['mode'] },
  ): Promise<Conversation> {
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      const locale =
        input.locale ??
        (await tx.user.findUnique({ where: { id: userId }, select: { locale: true } }))?.locale ??
        'en-IN';
      return tx.conversationThread.create({
        data: {
          userId,
          title: input.title ?? DEFAULT_TITLE,
          titleSource: input.title ? 'user' : 'auto',
          locale,
          mode: input.mode,
          expiresAt:
            input.mode === 'ephemeral'
              ? new Date(Date.now() + EPHEMERAL_RETENTION_HOURS * 3_600_000)
              : null,
        },
      });
    });
    return toConversation(row);
  }

  async list(userId: string, query: ConversationListQuery): Promise<ConversationList> {
    const cursor = query.cursor ? decodeThreadCursor(query.cursor) : null;
    const sortAt = Prisma.sql`COALESCE(t.last_message_at, t.created_at)`;
    const conditions: Prisma.Sql[] = [
      Prisma.sql`t.user_id = ${userId}::uuid`,
      Prisma.sql`(t.expires_at IS NULL OR t.expires_at > now())`,
    ];
    if (query.archived === 'exclude') conditions.push(Prisma.sql`t.archived_at IS NULL`);
    if (query.archived === 'only') conditions.push(Prisma.sql`t.archived_at IS NOT NULL`);
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(Prisma.sql`(t.title ILIKE ${pattern} OR EXISTS (
        SELECT 1 FROM conversation.messages m
         WHERE m.thread_id = t.id AND m.user_id = t.user_id AND m.content ILIKE ${pattern}))`);
    }
    if (cursor) {
      // Keyset over (pinned DESC, sort_at DESC, id DESC).
      conditions.push(Prisma.sql`(
        (t.pinned::int < ${cursor.pinned ? 1 : 0})
        OR (t.pinned::int = ${cursor.pinned ? 1 : 0} AND ${sortAt} < ${new Date(cursor.at)})
        OR (t.pinned::int = ${cursor.pinned ? 1 : 0} AND ${sortAt} = ${new Date(cursor.at)} AND t.id < ${cursor.id}::uuid))`);
    }
    const rows = await this.prisma.withUserScope(userId, async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>`
        SELECT t.id FROM conversation.threads t
         WHERE ${Prisma.join(conditions, ' AND ')}
         ORDER BY t.pinned DESC, ${sortAt} DESC, t.id DESC
         LIMIT ${query.limit + 1}`;
      if (ids.length === 0) return [];
      const found = await tx.conversationThread.findMany({
        where: { id: { in: ids.map((r) => r.id) }, userId },
      });
      const byId = new Map(found.map((t) => [t.id, t]));
      return ids.map((r) => byId.get(r.id)).filter((t): t is ConversationThread => Boolean(t));
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toConversation),
      next_cursor:
        rows.length > query.limit && last
          ? encodeThreadCursor({
              pinned: last.pinned,
              at: (last.lastMessageAt ?? last.createdAt).toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  private async ownedThread(
    tx: TransactionClient,
    userId: string,
    id: string,
    lock = false,
  ): Promise<ConversationThread> {
    if (lock) {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM conversation.threads
         WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw notFound();
    }
    const thread = await tx.conversationThread.findFirst({ where: { id, userId } });
    if (!thread || (thread.expiresAt && thread.expiresAt.getTime() <= Date.now())) {
      throw notFound();
    }
    return thread;
  }

  async get(userId: string, id: string): Promise<Conversation> {
    return toConversation(
      await this.prisma.withUserScope(userId, (tx) => this.ownedThread(tx, userId, id)),
    );
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: UpdateConversationRequest,
  ): Promise<Conversation> {
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      const current = await this.ownedThread(tx, userId, id);
      const data: Prisma.ConversationThreadUpdateManyMutationInput = {
        version: { increment: 1 },
      };
      if (patch.title !== undefined) {
        data.title = patch.title;
        data.titleSource = 'user';
      }
      if (patch.pinned !== undefined) data.pinned = patch.pinned;
      if (patch.archived !== undefined) {
        data.archivedAt = patch.archived ? (current.archivedAt ?? new Date()) : null;
      }
      const { count } = await tx.conversationThread.updateMany({
        where: { id, userId, version: expectedVersion },
        data,
      });
      if (count !== 1) {
        throw new ApiError('PRECONDITION_FAILED', 'This conversation was changed elsewhere.');
      }
      return tx.conversationThread.findUniqueOrThrow({ where: { id } });
    });
    return toConversation(row);
  }

  /** Hard delete (user content; cascades to messages, events, feedback). Stops a running answer. */
  async remove(userId: string, id: string): Promise<void> {
    const active = await this.prisma.withUserScope(userId, async (tx) => {
      await this.ownedThread(tx, userId, id, true);
      const running = await tx.conversationMessage.findMany({
        where: { threadId: id, userId, status: { in: ACTIVE } },
        select: { id: true },
      });
      await tx.conversationThread.delete({ where: { id } });
      await this.audit.record(
        {
          actorType: 'USER',
          actorRef: userId,
          action: 'conversation.deleted',
          subjectType: 'conversation',
          subjectId: id,
          outcome: 'SUCCESS',
        },
        tx,
      );
      return running.map((r) => r.id);
    });
    for (const messageId of active) this.generation.abortLocal(messageId, 'canceled');
  }

  // ── Messages ────────────────────────────────────────────────────────────────────────────

  async listMessages(
    userId: string,
    threadId: string,
    query: { before?: string | undefined; limit: number },
  ): Promise<MessageList> {
    const before = query.before ? Number(query.before) : undefined;
    const rows = await this.prisma.withUserScope(userId, async (tx) => {
      await this.ownedThread(tx, userId, threadId);
      return tx.conversationMessage.findMany({
        where: { threadId, userId, ...(before ? { seq: { lt: before } } : {}) },
        orderBy: { seq: 'desc' },
        take: query.limit + 1,
        include: { feedback: true },
      });
    });
    const page = rows.slice(0, query.limit).reverse();
    return {
      items: page.map(toMessage),
      next_cursor: rows.length > query.limit && page[0] ? String(page[0].seq) : null,
    };
  }

  async getMessage(userId: string, threadId: string, messageId: string): Promise<Message> {
    return toMessage(await this.ownedMessage(userId, threadId, messageId));
  }

  private async ownedMessage(
    userId: string,
    threadId: string,
    messageId: string,
  ): Promise<MessageRow> {
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      await this.ownedThread(tx, userId, threadId);
      return tx.conversationMessage.findFirst({
        where: { id: messageId, threadId, userId },
        include: { feedback: true },
      });
    });
    if (!row) throw messageNotFound();
    return row;
  }

  /** Per-user message rate limit (Redis, fail closed). */
  private async rateLimit(userId: string): Promise<void> {
    const key = `karen:chat:rate:${userId}:${Math.floor(Date.now() / 60_000)}`;
    let count: number;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, 120);
    } catch (error) {
      throw new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'KAREN can’t accept messages right now. Please try again shortly.',
        { retryable: true, cause: error },
      );
    }
    if (count > this.env.CHAT_MESSAGES_PER_MINUTE) {
      throw new ApiError('RATE_LIMITED', 'You’re sending messages too quickly.', {
        retryable: true,
      });
    }
  }

  private async assertCanStartGeneration(
    tx: TransactionClient,
    userId: string,
    threadId: string,
  ): Promise<void> {
    const active = await tx.conversationMessage.findMany({
      where: { userId, role: 'assistant', status: { in: ACTIVE } },
      select: { threadId: true },
    });
    if (active.some((m) => m.threadId === threadId)) {
      throw new ApiError(
        'CONFLICT',
        'KAREN is still answering in this conversation. Wait for it or stop it first.',
        { nextOptions: ['CANCEL_GENERATION'] },
      );
    }
    if (active.length >= this.env.CHAT_MAX_ACTIVE_GENERATIONS_PER_USER) {
      throw new ApiError('RATE_LIMITED', 'Too many answers are in progress. Please wait.', {
        retryable: true,
      });
    }
  }

  /** Allocates `count` consecutive message positions under the thread row lock. */
  private async allocateSeq(
    tx: TransactionClient,
    thread: ConversationThread,
    count: number,
  ): Promise<number> {
    await tx.conversationThread.update({
      where: { id: thread.id },
      data: { nextSeq: { increment: count }, lastMessageAt: new Date() },
    });
    return thread.nextSeq;
  }

  private async insertAssistant(
    tx: TransactionClient,
    args: {
      userId: string;
      threadId: string;
      seq: number;
      replyTo: string;
      regeneratedFrom?: string;
      idempotencyKey?: string;
    },
  ): Promise<MessageRow> {
    const assistant = await tx.conversationMessage.create({
      data: {
        userId: args.userId,
        threadId: args.threadId,
        seq: args.seq,
        role: 'assistant',
        status: 'accepted',
        requestId: `chat_${randomUUID()}`,
        replyToMessageId: args.replyTo,
        regeneratedFromId: args.regeneratedFrom ?? null,
        clientIdempotencyKey: args.idempotencyKey ?? null,
        lastEventSeq: 1,
        leaseExpiresAt: new Date(Date.now() + this.env.CHAT_GENERATION_LEASE_SECONDS * 1000),
      },
    });
    await tx.messageEvent.create({
      data: {
        userId: args.userId,
        messageId: assistant.id,
        seq: 1,
        type: 'accepted',
        payload: {
          seq: 1,
          type: 'accepted',
          message_id: assistant.id,
          conversation_id: args.threadId,
        },
      },
    });
    return { ...assistant, feedback: null };
  }

  /** Replays an idempotent send: same key → the same messages, never a second generation. */
  private async existingSend(
    userId: string,
    idempotencyKey: string,
    expect: { threadId?: string; content: string },
  ): Promise<SendMessageResponse | null> {
    return this.prisma.withUserScope(userId, async (tx) => {
      const user = await tx.conversationMessage.findFirst({
        where: { userId, clientIdempotencyKey: idempotencyKey },
      });
      if (!user) return null;
      if (
        user.role !== 'user' ||
        user.content !== expect.content ||
        (expect.threadId !== undefined && user.threadId !== expect.threadId)
      ) {
        throw new ApiError(
          'CONFLICT',
          'This Idempotency-Key was already used for a different request.',
        );
      }
      const [thread, assistant] = await Promise.all([
        tx.conversationThread.findUniqueOrThrow({ where: { id: user.threadId } }),
        tx.conversationMessage.findFirst({
          where: { userId, replyToMessageId: user.id },
          orderBy: { seq: 'asc' },
          include: { feedback: true },
        }),
      ]);
      if (!assistant) return null;
      return {
        conversation: toConversation(thread),
        user_message: toMessage({ ...user, feedback: null }),
        assistant_message: toMessage(assistant),
        stream_path: this.streamPath(thread.id, assistant.id),
      };
    });
  }

  async send(
    caller: Caller,
    threadId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<SendMessageResponse> {
    const { userId } = caller;
    const replay = await this.existingSend(userId, idempotencyKey, { threadId, content });
    if (replay) return replay;
    await this.rateLimit(userId);
    const reservationKey = `send:${userId}:${idempotencyKey}`;
    const reserved = await this.usage.reserve(userId, reservationKey);
    let result: { thread: ConversationThread; user: MessageRow; assistant: MessageRow };
    try {
      result = await this.prisma.withUserScope(userId, async (tx) => {
        const thread = await this.ownedThread(tx, userId, threadId, true);
        await this.assertCanStartGeneration(tx, userId, threadId);
        const seq = await this.allocateSeq(tx, thread, 2);
        const user = await tx.conversationMessage.create({
          data: {
            userId,
            threadId,
            seq,
            role: 'user',
            status: 'completed',
            content,
            clientIdempotencyKey: idempotencyKey,
            completedAt: new Date(),
          },
        });
        const assistant = await this.insertAssistant(tx, {
          userId,
          threadId,
          seq: seq + 1,
          replyTo: user.id,
        });
        const updated = await tx.conversationThread.update({
          where: { id: threadId },
          data: {
            archivedAt: null,
            ...(thread.titleSource === 'auto' && thread.title === DEFAULT_TITLE
              ? { title: autoTitle(content), version: { increment: 1 } }
              : {}),
          },
        });
        return { thread: updated, user: { ...user, feedback: null }, assistant };
      });
    } catch (error) {
      // Only the request that created the reservation releases it (see UsageLimitsService).
      if (reserved) await this.usage.release(userId, reservationKey);
      if (isUniqueViolation(error)) {
        // A concurrent retry with the same key won the race, or a generation just started.
        const again = await this.existingSend(userId, idempotencyKey, { threadId, content });
        if (again) return again;
        throw new ApiError('CONFLICT', 'KAREN is still answering in this conversation.', {
          nextOptions: ['CANCEL_GENERATION'],
        });
      }
      throw error;
    }
    this.generation.start({
      userId,
      userRef: caller.userRef,
      messageId: result.assistant.id,
      reservationKey,
    });
    return {
      conversation: toConversation(result.thread),
      user_message: toMessage(result.user),
      assistant_message: toMessage(result.assistant),
      stream_path: this.streamPath(threadId, result.assistant.id),
    };
  }

  /** New answer to the same question. Only the latest, finished answer can be regenerated. */
  async regenerate(
    caller: Caller,
    threadId: string,
    messageId: string,
    idempotencyKey: string,
  ): Promise<RegenerateResponse> {
    const { userId } = caller;
    const prior = await this.prisma.withUserScope(userId, (tx) =>
      tx.conversationMessage.findFirst({
        where: { userId, clientIdempotencyKey: idempotencyKey },
        include: { feedback: true },
      }),
    );
    if (prior) {
      if (prior.regeneratedFromId !== messageId || prior.threadId !== threadId) {
        throw new ApiError(
          'CONFLICT',
          'This Idempotency-Key was already used for a different request.',
        );
      }
      return {
        assistant_message: toMessage(prior),
        stream_path: this.streamPath(threadId, prior.id),
      };
    }
    await this.rateLimit(userId);
    const reservationKey = `regen:${userId}:${idempotencyKey}`;
    const reserved = await this.usage.reserve(userId, reservationKey);
    let assistant: MessageRow;
    try {
      assistant = await this.prisma.withUserScope(userId, async (tx) => {
        const thread = await this.ownedThread(tx, userId, threadId, true);
        const old = await tx.conversationMessage.findFirst({
          where: { id: messageId, threadId, userId },
        });
        if (!old || old.role !== 'assistant' || !old.replyToMessageId) throw messageNotFound();
        if (!isTerminalMessageStatus(old.status as MessageStatus)) {
          throw new ApiError('CONFLICT', 'Wait for this answer to finish or stop it first.');
        }
        if (old.supersededAt || old.seq !== thread.nextSeq - 1) {
          throw new ApiError('CONFLICT', 'Only the latest answer can be regenerated.');
        }
        await this.assertCanStartGeneration(tx, userId, threadId);
        await tx.conversationMessage.update({
          where: { id: old.id },
          data: { supersededAt: new Date(), version: { increment: 1 } },
        });
        const seq = await this.allocateSeq(tx, thread, 1);
        return this.insertAssistant(tx, {
          userId,
          threadId,
          seq,
          replyTo: old.replyToMessageId,
          regeneratedFrom: old.id,
          idempotencyKey,
        });
      });
    } catch (error) {
      // Only the request that created the reservation releases it (see UsageLimitsService).
      if (reserved) await this.usage.release(userId, reservationKey);
      if (isUniqueViolation(error)) {
        throw new ApiError('CONFLICT', 'This answer is already being regenerated.');
      }
      throw error;
    }
    this.generation.start({
      userId,
      userRef: caller.userRef,
      messageId: assistant.id,
      reservationKey,
    });
    return {
      assistant_message: toMessage(assistant),
      stream_path: this.streamPath(threadId, assistant.id),
    };
  }

  /**
   * "Edit a previous message": a NEW conversation with everything before that message, then the
   * edited text, then a fresh answer. The original conversation is untouched (linear threads).
   */
  async fork(
    caller: Caller,
    sourceId: string,
    fromMessageId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<SendMessageResponse> {
    const { userId } = caller;
    const replay = await this.existingSend(userId, idempotencyKey, { content });
    if (replay) return replay;
    await this.rateLimit(userId);
    const reservationKey = `fork:${userId}:${idempotencyKey}`;
    const reserved = await this.usage.reserve(userId, reservationKey);
    let result: { thread: ConversationThread; user: MessageRow; assistant: MessageRow };
    try {
      result = await this.prisma.withUserScope(userId, async (tx) => {
        const source = await this.ownedThread(tx, userId, sourceId);
        const from = await tx.conversationMessage.findFirst({
          where: { id: fromMessageId, threadId: sourceId, userId, role: 'user' },
        });
        if (!from) throw messageNotFound();
        await this.assertCanStartGeneration(tx, userId, '00000000-0000-0000-0000-000000000000');
        const history = await tx.conversationMessage.findMany({
          where: {
            threadId: sourceId,
            userId,
            seq: { lt: from.seq },
            supersededAt: null,
            status: { in: ['completed', 'incomplete'] },
          },
          orderBy: { seq: 'asc' },
        });
        const title = `${source.title.slice(0, 100)} (edited)`;
        const thread = await tx.conversationThread.create({
          data: {
            userId,
            title,
            titleSource: 'auto',
            locale: source.locale,
            mode: source.mode,
            expiresAt: source.expiresAt,
            nextSeq: 1,
            lastMessageAt: new Date(),
          },
        });
        // Copy history with fresh ids, preserving reply links within the copy.
        const idMap = new Map<string, string>();
        let seq = 1;
        for (const m of history) {
          const replyTo = m.replyToMessageId ? idMap.get(m.replyToMessageId) : undefined;
          if (m.role === 'assistant' && !replyTo) continue;
          const copy = await tx.conversationMessage.create({
            data: {
              userId,
              threadId: thread.id,
              seq: seq++,
              role: m.role,
              status: m.status,
              content: m.content,
              replyToMessageId: replyTo ?? null,
              finishReason: m.finishReason,
              routeTier: m.routeTier,
              isMock: m.isMock,
              errorCode: m.errorCode,
              errorRetryable: m.errorRetryable,
              completedAt: m.completedAt,
            },
          });
          idMap.set(m.id, copy.id);
        }
        const user = await tx.conversationMessage.create({
          data: {
            userId,
            threadId: thread.id,
            seq,
            role: 'user',
            status: 'completed',
            content,
            clientIdempotencyKey: idempotencyKey,
            completedAt: new Date(),
          },
        });
        const assistant = await this.insertAssistant(tx, {
          userId,
          threadId: thread.id,
          seq: seq + 1,
          replyTo: user.id,
        });
        const updated = await tx.conversationThread.update({
          where: { id: thread.id },
          data: { nextSeq: seq + 2 },
        });
        return { thread: updated, user: { ...user, feedback: null }, assistant };
      });
    } catch (error) {
      // Only the request that created the reservation releases it (see UsageLimitsService).
      if (reserved) await this.usage.release(userId, reservationKey);
      if (isUniqueViolation(error)) {
        const again = await this.existingSend(userId, idempotencyKey, { content });
        if (again) return again;
      }
      throw error;
    }
    this.generation.start({
      userId,
      userRef: caller.userRef,
      messageId: result.assistant.id,
      reservationKey,
    });
    return {
      conversation: toConversation(result.thread),
      user_message: toMessage(result.user),
      assistant_message: toMessage(result.assistant),
      stream_path: this.streamPath(result.thread.id, result.assistant.id),
    };
  }

  /**
   * Stops a running answer. Idempotent: a finished message is returned unchanged. The flag is
   * durable (any instance's runner sees it on its next write) and signalled for a prompt stop.
   */
  async cancel(userId: string, threadId: string, messageId: string): Promise<Message> {
    const row = await this.ownedMessage(userId, threadId, messageId);
    if (row.role !== 'assistant') throw messageNotFound();
    if (isTerminalMessageStatus(row.status as MessageStatus)) return toMessage(row);
    await this.prisma.withUserScope(userId, (tx) =>
      tx.conversationMessage.updateMany({
        where: { id: messageId, userId, status: { in: ACTIVE }, cancelRequestedAt: null },
        data: { cancelRequestedAt: new Date() },
      }),
    );
    if (!this.generation.abortLocal(messageId, 'canceled')) {
      await this.hub.publishCancel(messageId);
    }
    // Wait briefly for the runner's terminal write so the response reflects the outcome.
    const deadline = Date.now() + 3_000;
    for (;;) {
      const current = await this.ownedMessage(userId, threadId, messageId);
      if (isTerminalMessageStatus(current.status as MessageStatus) || Date.now() > deadline) {
        return toMessage(current);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async feedback(
    userId: string,
    threadId: string,
    messageId: string,
    input: FeedbackRequest,
  ): Promise<Message> {
    const row = await this.ownedMessage(userId, threadId, messageId);
    if (row.role !== 'assistant' || !isTerminalMessageStatus(row.status as MessageStatus)) {
      throw new ApiError('CONFLICT', 'Feedback can be given on finished answers only.');
    }
    await this.prisma.withUserScope(userId, (tx) =>
      tx.messageFeedback.upsert({
        where: { messageId },
        create: {
          messageId,
          userId,
          rating: input.rating,
          category: input.category ?? null,
          comment: input.comment ?? null,
        },
        update: {
          rating: input.rating,
          category: input.category ?? null,
          comment: input.comment ?? null,
          version: { increment: 1 },
        },
      }),
    );
    return this.getMessage(userId, threadId, messageId);
  }

  async clearFeedback(userId: string, threadId: string, messageId: string): Promise<Message> {
    await this.ownedMessage(userId, threadId, messageId);
    await this.prisma.withUserScope(userId, (tx) =>
      tx.messageFeedback.deleteMany({ where: { messageId, userId } }),
    );
    return this.getMessage(userId, threadId, messageId);
  }
}
