import type { ChatStreamEvent, MessageStatus } from '@karen/api-contracts';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { AiServiceClient, AiServiceError } from '../infrastructure/ai/ai-service.client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import {
  addressName,
  buildContextWindow,
  mapAiFailure,
  type ContextMessage,
  type MessageFailure,
  usdToMicro,
} from './chat-policy.js';
import { StreamHub } from './stream-hub.js';
import { UsageLimitsService } from './usage-limits.service.js';

export interface GenerationJob {
  userId: string;
  /** Pseudonymous reference for the AI service — never the user id or e-mail. */
  userRef: string;
  messageId: string;
  /** Usage reservation to settle (see UsageLimitsService). */
  reservationKey: string;
}

type AbortReason = 'canceled' | 'timeout' | 'shutdown' | 'error';

/** Thrown when the message left the active state underneath the runner (reaper, deletion). */
class LostOwnership extends Error {}

const ACTIVE: MessageStatus[] = ['pending', 'accepted', 'streaming'];
const FLUSH_MS = 40;

interface RunState {
  job: GenerationJob;
  controller: AbortController;
  seq: number;
  content: string;
  pending: string;
  status: MessageStatus;
  isMock: boolean | null;
  routeTier: string | null;
  firstTokenAt: number | null;
  startedAt: number;
  chain: Promise<void>;
  flushTimer: NodeJS.Timeout | null;
  lastWrite: number;
}

/**
 * Runs assistant generations (ADR-0022). One runner per assistant message, in the API process
 * that accepted it. It:
 *  - builds a bounded context from this conversation only and calls the AI service (signed);
 *  - persists every public event (and the accumulated text) BEFORE publishing it, so a
 *    reconnecting client can always replay from the database;
 *  - holds a lease it renews; a crashed runner's lease expires and the reaper closes the
 *    message as `incomplete`/`failed` — it is never silently re-run;
 *  - honours cancel (DB flag + pub/sub signal), an overall timeout and graceful shutdown;
 *  - records invocation metadata (never content) and settles the user's usage reservation.
 * The model only ever produces text here: no tools are exposed, nothing is executed.
 */
@Injectable()
export class GenerationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(GenerationService.name);
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
    private readonly hub: StreamHub,
    private readonly usage: UsageLimitsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.hub.onCancel((messageId) => this.abortLocal(messageId, 'canceled'));
  }

  async onApplicationShutdown(): Promise<void> {
    const runs = [...this.running.keys()];
    for (const id of runs) this.abortLocal(id, 'shutdown');
    // Give runners a moment to write their terminal state; the reaper covers the rest.
    const deadline = Date.now() + 3_000;
    while (this.running.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  get activeCount(): number {
    return this.running.size;
  }

  abortLocal(messageId: string, reason: AbortReason): boolean {
    const controller = this.running.get(messageId);
    if (!controller) return false;
    controller.abort(reason);
    return true;
  }

  /** Starts a generation in the background. Never throws; failures end the message. */
  start(job: GenerationJob): void {
    if (this.running.has(job.messageId)) return;
    const controller = new AbortController();
    this.running.set(job.messageId, controller);
    void this.run(job, controller)
      .catch((error: unknown) => {
        this.logger.error({ err: error, message_id: job.messageId }, 'Generation runner crashed');
      })
      .finally(() => this.running.delete(job.messageId));
  }

  // ── runner ──────────────────────────────────────────────────────────────────────────────

  private async run(job: GenerationJob, controller: AbortController): Promise<void> {
    const loaded = await this.prisma.withUserScope(job.userId, async (tx) => {
      const msg = await tx.conversationMessage.findFirst({
        where: { id: job.messageId, userId: job.userId, role: 'assistant' },
      });
      if (!msg || !ACTIVE.includes(msg.status as MessageStatus)) return null;
      const [thread, user, prefs, history, question] = await Promise.all([
        tx.conversationThread.findUniqueOrThrow({ where: { id: msg.threadId } }),
        tx.user.findUnique({
          where: { id: job.userId },
          select: { timezone: true, preferredName: true, displayName: true },
        }),
        tx.userPreferences.findUnique({
          where: { userId: job.userId },
          select: { replyLanguage: true },
        }),
        tx.conversationMessage.findMany({
          where: {
            threadId: msg.threadId,
            seq: { lt: msg.seq },
            supersededAt: null,
            status: { in: ['completed', 'incomplete'] },
          },
          orderBy: { seq: 'desc' },
          take: this.env.CHAT_CONTEXT_MAX_MESSAGES * 2,
          select: { role: true, content: true },
        }),
        msg.replyToMessageId
          ? tx.conversationMessage.findFirst({
              where: { id: msg.replyToMessageId, userId: job.userId },
              select: { inputMode: true },
            })
          : null,
      ]);
      const replyLanguage = prefs?.replyLanguage;
      return {
        msg,
        thread,
        timezone: user?.timezone ?? null,
        // ADR-0034: KAREN addresses the user by the name they chose (cleaned; may be omitted).
        userName: addressName(user?.preferredName, user?.displayName),
        // ADR-0027: a saved reply language overrides automatic detection ("auto" = detect).
        replyLanguage: isReplyLanguage(replyLanguage) ? replyLanguage : null,
        // ADR-0029: a spoken question gets an answer written to be read aloud.
        spoken: question?.inputMode === 'voice',
        history: history.reverse(),
      };
    });
    if (!loaded) {
      await this.usage.settleCounters(job.userId, job.reservationKey, 0);
      return;
    }

    const state: RunState = {
      job,
      controller,
      seq: loaded.msg.lastEventSeq,
      content: '',
      pending: '',
      status: loaded.msg.status as MessageStatus,
      isMock: null,
      routeTier: null,
      firstTokenAt: null,
      startedAt: Date.now(),
      chain: Promise.resolve(),
      flushTimer: null,
      lastWrite: Date.now(),
    };
    const context = buildContextWindow(loaded.history as ContextMessage[], {
      maxMessages: this.env.CHAT_CONTEXT_MAX_MESSAGES,
      maxChars: this.env.CHAT_CONTEXT_MAX_CHARS,
    });
    const timeout = setTimeout(
      () => controller.abort('timeout' satisfies AbortReason),
      this.env.CHAT_GENERATION_TIMEOUT_SECONDS * 1000,
    );
    const leaseTimer = setInterval(
      () => this.enqueue(state, () => this.renewLease(state)),
      Math.max(1_000, (this.env.CHAT_GENERATION_LEASE_SECONDS * 1000) / 3),
    );

    let done: DoneInfo | null = null;
    let failure: Failure | null = null;

    try {
      if (context.length === 0 || context.at(-1)?.role !== 'user') {
        throw new AiServiceError('VALIDATION_ERROR', 'No user message to answer', false, null);
      }
      const stream = this.ai.stream(
        {
          request_id: loaded.msg.requestId ?? loaded.msg.id,
          task_kind: 'CHAT',
          messages: context,
          max_output_tokens: this.env.CHAT_MAX_OUTPUT_TOKENS,
          user_ref: job.userRef,
          max_cost_usd: this.env.CHAT_REQUEST_RESERVE_USD,
          locale: loaded.thread.locale,
          ...(loaded.timezone ? { timezone: loaded.timezone } : {}),
          ...(loaded.replyLanguage ? { reply_language: loaded.replyLanguage } : {}),
          ...(loaded.spoken ? { reply_style: 'spoken' as const } : {}),
          ...(loaded.userName ? { user_name: loaded.userName } : {}),
        },
        { signal: controller.signal },
      );
      for await (const ev of stream) {
        if (ev.event === 'start') {
          state.isMock = ev.is_mock;
          state.routeTier = ev.route_tier;
          this.enqueue(state, () =>
            this.persist(state, [{ type: 'status', status: 'streaming' }], {
              status: 'streaming',
              startedAt: new Date(),
              isMock: ev.is_mock,
              routeTier: ev.route_tier,
            }),
          );
        } else if (ev.event === 'delta') {
          if (state.firstTokenAt === null) state.firstTokenAt = Date.now();
          state.pending += ev.text;
          this.scheduleFlush(state);
        } else if (ev.event === 'done') {
          done = {
            finishReason: ev.finish_reason,
            costUsd: ev.estimated_cost_usd,
            inputTokens: ev.usage.input_tokens,
            outputTokens: ev.usage.output_tokens,
            requestedModel: ev.requested_model,
            servedModel: ev.served_model,
            gatewayRequestId: ev.gateway_request_id,
            promptVersion: ev.prompt_version,
          };
        } else {
          failure = { ...mapAiFailure(ev.code, ev.retryable), aiCode: ev.code };
        }
      }
    } catch (error) {
      const reason = controller.signal.aborted
        ? (controller.signal.reason as AbortReason)
        : undefined;
      if (error instanceof LostOwnership) {
        failure = null;
      } else if (reason === 'canceled') {
        failure = {
          code: 'CANCELED',
          message: 'You stopped this answer.',
          retryable: true,
          aiCode: 'CANCELED',
        };
      } else if (reason === 'timeout') {
        failure = { ...mapAiFailure('GENERATION_TIMEOUT', true), aiCode: 'GENERATION_TIMEOUT' };
      } else if (reason === 'shutdown' || reason === 'error') {
        failure = {
          ...mapAiFailure('GENERATION_INTERRUPTED', true),
          aiCode: 'GENERATION_INTERRUPTED',
        };
      } else if (error instanceof AiServiceError) {
        failure = { ...mapAiFailure(error.code, error.retryable), aiCode: error.code };
      } else {
        this.logger.error({ err: error, message_id: job.messageId }, 'Generation failed');
        failure = { ...mapAiFailure('INTERNAL_ERROR', true), aiCode: 'INTERNAL_ERROR' };
      }
      if (error instanceof LostOwnership) {
        clearTimeout(timeout);
        clearInterval(leaseTimer);
        await this.usage.settleCounters(job.userId, job.reservationKey, 0);
        return;
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(leaseTimer);
    }

    // Terminal state: pending text, terminal event, invocation metadata and the usage-ledger
    // entry commit in ONE transaction, so "answer finished" and "usage counted" never diverge.
    if (state.flushTimer) clearTimeout(state.flushTimer);
    const costMicroUsd = await this.finalize(state, done, failure).catch((error: unknown) => {
      if (!(error instanceof LostOwnership)) {
        this.logger.error({ err: error, message_id: job.messageId }, 'Terminal write failed');
      }
      return 0;
    });
    await this.usage.settleCounters(job.userId, job.reservationKey, costMicroUsd);
  }

  /**
   * Serialises writes for one run. A write that finds the message no longer active (cancel,
   * reaper, deletion) aborts the run; any other write failure ends it as interrupted.
   */
  private enqueue(state: RunState, fn: () => Promise<unknown>): void {
    state.chain = state.chain
      .then(fn)
      .then(() => undefined)
      .catch((error: unknown) => {
        if (error instanceof LostOwnership) {
          state.controller.abort('canceled' satisfies AbortReason);
          return;
        }
        this.logger.error({ err: error, message_id: state.job.messageId }, 'Stream write failed');
        state.controller.abort('error' satisfies AbortReason);
      });
  }

  private scheduleFlush(state: RunState): void {
    if (state.flushTimer) return;
    const flush = () => {
      state.flushTimer = null;
      if (!state.pending) return;
      const text = state.pending;
      state.pending = '';
      state.content += text;
      this.enqueue(state, () => this.persist(state, [{ type: 'token_delta', text }], {}));
    };
    // The first token goes out immediately (time to first token); later ones are batched.
    if (state.firstTokenAt !== null && state.content.length === 0) flush();
    else state.flushTimer = setTimeout(flush, FLUSH_MS);
  }

  private async renewLease(state: RunState): Promise<void> {
    if (Date.now() - state.lastWrite < 2_000) return;
    const lease = new Date(Date.now() + this.env.CHAT_GENERATION_LEASE_SECONDS * 1000);
    const { count } = await this.prisma.withUserScope(state.job.userId, (tx) =>
      tx.conversationMessage.updateMany({
        where: {
          id: state.job.messageId,
          status: { in: ACTIVE },
          cancelRequestedAt: null,
        },
        data: { leaseExpiresAt: lease },
      }),
    );
    state.lastWrite = Date.now();
    if (count === 0) throw new LostOwnership();
  }

  /**
   * Persists events + message state in one transaction, then publishes. Writes only while the
   * message is still active and not cancel-requested (unless `terminal`), so a reaper, a
   * deletion or a cancel stops the runner instead of being overwritten.
   */
  private async persist(
    state: RunState,
    events: DistributiveOmit<ChatStreamEvent, 'seq'>[],
    patch: {
      status?: MessageStatus;
      startedAt?: Date;
      isMock?: boolean;
      routeTier?: string;
      completedAt?: Date;
      finishReason?: string;
      errorCode?: string;
      errorRetryable?: boolean;
    },
    terminal = false,
    alsoInTx?: (tx: TransactionClient) => Promise<unknown>,
  ): Promise<ChatStreamEvent[]> {
    const startSeq = state.seq;
    const withSeq = events.map((e, i) => ({ ...e, seq: startSeq + i + 1 }));
    const lastSeq = startSeq + withSeq.length;
    const lease = terminal
      ? null
      : new Date(Date.now() + this.env.CHAT_GENERATION_LEASE_SECONDS * 1000);
    await this.prisma.withUserScope(state.job.userId, async (tx) => {
      const { count } = await tx.conversationMessage.updateMany({
        where: {
          id: state.job.messageId,
          status: { in: ACTIVE },
          ...(terminal ? {} : { cancelRequestedAt: null }),
        },
        data: {
          ...patch,
          content: state.content,
          lastEventSeq: lastSeq,
          leaseExpiresAt: lease,
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw new LostOwnership();
      await tx.messageEvent.createMany({
        data: withSeq.map((e) => ({
          userId: state.job.userId,
          messageId: state.job.messageId,
          seq: e.seq,
          type: e.type,
          payload: e,
        })),
      });
      if (alsoInTx) await alsoInTx(tx);
    });
    state.seq = lastSeq;
    state.lastWrite = Date.now();
    if (patch.status) state.status = patch.status;
    await this.hub.publish(state.job.messageId, withSeq);
    return withSeq;
  }

  /** Writes the terminal state; returns the cost charged to the user (micro-USD). */
  private async finalize(
    state: RunState,
    done: DoneInfo | null,
    failure: Failure | null,
  ): Promise<number> {
    await state.chain.catch(() => undefined);
    // Text still buffered when the stream ended goes out as a final delta in the SAME
    // transaction as the terminal event, so live readers and replays both receive it.
    const tail: DistributiveOmit<ChatStreamEvent, 'seq'>[] = state.pending
      ? [{ type: 'token_delta', text: state.pending }]
      : [];
    state.content += state.pending;
    state.pending = '';
    const now = new Date();
    const completed = done !== null && failure === null;
    const f: Failure = failure ?? {
      ...mapAiFailure('AI_SERVICE_STREAM_DROPPED', true),
      aiCode: 'AI_SERVICE_STREAM_DROPPED',
    };
    const status: MessageStatus = completed
      ? 'completed'
      : f.code === 'CANCELED'
        ? 'canceled'
        : state.content.length > 0
          ? 'incomplete'
          : 'failed';
    // Cost: mock and deterministic answers bill nothing; a failure with partial output is
    // charged the reserved worst case (the upstream may have billed it), otherwise actual.
    const reserve = usdToMicro(this.env.CHAT_REQUEST_RESERVE_USD);
    const cost =
      state.isMock || state.routeTier === 'NO_MODEL'
        ? 0
        : completed
          ? usdToMicro(done.costUsd ?? this.env.CHAT_REQUEST_RESERVE_USD)
          : state.content.length > 0
            ? reserve
            : 0;
    const record = async (tx: TransactionClient) => {
      await this.recordInvocation(tx, state, status, done, completed ? null : f, cost);
      await this.usage.recordInLedger(tx, {
        userId: state.job.userId,
        costMicroUsd: cost,
        inputTokens: done?.inputTokens ?? null,
        outputTokens: done?.outputTokens ?? null,
      });
    };
    if (completed) {
      await this.persist(
        state,
        [
          ...tail,
          { type: 'usage', input_tokens: done.inputTokens, output_tokens: done.outputTokens },
          {
            type: 'complete',
            status: 'completed',
            finish_reason: done.finishReason,
            is_mock: state.isMock ?? false,
            route_tier: state.routeTier,
          },
        ],
        { status: 'completed', completedAt: now, finishReason: done.finishReason },
        true,
        record,
      );
      return cost;
    }
    await this.persist(
      state,
      [
        ...tail,
        {
          type: 'error',
          status: status as 'failed' | 'incomplete' | 'canceled',
          code: f.code,
          message: f.message,
          retryable: f.retryable,
        },
      ],
      {
        status,
        completedAt: now,
        errorCode: f.code,
        errorRetryable: f.retryable,
        ...(state.isMock !== null ? { isMock: state.isMock } : {}),
      },
      true,
      record,
    );
    if (f.code !== 'CANCELED') {
      // Error class only — never content (no prompt or completion text in logs).
      this.logger.warn(
        { message_id: state.job.messageId, ai_error: f.aiCode, status },
        'Generation ended without completing',
      );
    }
    return cost;
  }

  private async recordInvocation(
    tx: TransactionClient,
    state: RunState,
    status: MessageStatus,
    done: DoneInfo | null,
    failure: Failure | null,
    costMicroUsd: number,
  ): Promise<void> {
    const msg = await tx.conversationMessage.findUnique({
      where: { id: state.job.messageId },
      select: { requestId: true },
    });
    await tx.aiInvocation.create({
      data: {
        userId: state.job.userId,
        messageId: state.job.messageId,
        requestId: msg?.requestId ?? state.job.messageId,
        routeTier: state.routeTier,
        requestedModel: done?.requestedModel ?? null,
        servedModel: done?.servedModel ?? null,
        gatewayRequestId: done?.gatewayRequestId ?? null,
        promptVersion: done?.promptVersion ?? null,
        inputTokens: done?.inputTokens ?? null,
        outputTokens: done?.outputTokens ?? null,
        costMicroUsd: BigInt(costMicroUsd),
        ttftMs: state.firstTokenAt === null ? null : state.firstTokenAt - state.startedAt,
        latencyMs: Date.now() - state.startedAt,
        fallbackUsed: Boolean(
          done?.requestedModel && done.servedModel && done.requestedModel !== done.servedModel,
        ),
        isMock: state.isMock ?? false,
        status,
        errorCode: failure?.aiCode ?? null,
      },
    });
  }
}

interface DoneInfo {
  finishReason: string;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  requestedModel: string | null;
  servedModel: string | null;
  gatewayRequestId: string | null;
  promptVersion: string | null;
}
type Failure = MessageFailure & { aiCode: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const REPLY_LANGUAGE_OVERRIDES = ['en', 'hi', 'hi-Latn'] as const;
function isReplyLanguage(
  value: string | undefined,
): value is (typeof REPLY_LANGUAGE_OVERRIDES)[number] {
  return (REPLY_LANGUAGE_OVERRIDES as readonly (string | undefined)[]).includes(value);
}
