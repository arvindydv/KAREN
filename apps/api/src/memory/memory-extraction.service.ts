import type { MemoryCandidate } from '@karen/ai-model-contracts';
import {
  MEMORY_WORKFLOWS,
  TASK_QUEUES,
  memoryExtractionRequestId,
  memoryExtractionWorkflowId,
} from '@karen/domain';
import { pseudonymizeUserId } from '@karen/observability';
import {
  MEMORY_LIMITS,
  MEMORY_POLICY_VERSION,
  isSingleValuedSlot,
  rejectWholeMessage,
  validateCandidate,
  type MemoryKind,
  type MemoryRejectionClass,
} from '@karen/domain/memory';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { AiServiceClient, AiServiceError } from '../infrastructure/ai/ai-service.client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import {
  WORKFLOW_STARTER,
  type WorkflowStarter,
} from '../infrastructure/temporal/workflow-starter.js';
import { UsageLimitsService } from '../usage/usage-limits.service.js';
import { usdToMicro } from '../usage/usage-periods.js';
import { MemoryConsentService, lockUserForMemory } from './memory-consent.js';
import { memoryCount } from './memory-metrics.js';
import {
  countActiveItems,
  countJobsToday,
  countPendingSuggestions,
  findActiveDuplicate,
  finishJob,
  insertExtractionJob,
  insertItem,
  insertSuggestion,
  lockActiveSingleSlot,
  lockJob,
  supersedeItem,
  valueKeyOf,
  type ItemContent,
  type JobRow,
} from './memory.repository.js';

/** Same local-only fallback as IdentityService; deployed environments must set the env key. */
const LOCAL_PSEUDONYMIZATION_KEY = 'local-only-pseudonymization-key';

const DAY_MS = 86_400_000;
/** A `running` job older than this was abandoned by a dead attempt and may be taken over (§8.4). */
export const STEP_TIMEOUT_MS = 90_000;
/**
 * Q10 (OPEN, engineering default isolated here): only replies that ended `completed` or
 * `incomplete` enqueue extraction; `failed` / `canceled` do not (the user can resend, and a later
 * successful regenerate of the same user message still enqueues — one job per source message).
 */
export const EXTRACTION_ELIGIBLE_REPLY_STATUSES: readonly string[] = ['completed', 'incomplete'];
const REJECTION_SEVERITY: MemoryRejectionClass[] = ['secret', 'minor', 'sensitive', 'invalid'];

export interface StepResult {
  outcome: string;
}
const errClass = (e: unknown) => (e instanceof Error ? e.constructor.name : typeof e);

/**
 * Extraction job pipeline (arch §8; D10). Workflow input/history carry the job id only; the user
 * is always re-derived from the job row. Every write step re-reads the job, the source message,
 * the thread switch and consent UNDER the user-row lock (the lock `ConsentService.decide()` takes
 * FOR UPDATE), so a revoke, a clear, a thread/message deletion or an erasure can never be
 * overtaken: nothing is stored for a source that is no longer eligible ("no resurrection").
 * Duplicate execution writes once (compare-and-set on `version`). Model output is untrusted and
 * re-validated deterministically (V1–V12) before anything is stored.
 */
@Injectable()
export class MemoryExtractionService {
  private readonly logger = new Logger(MemoryExtractionService.name);
  private readonly pseudonymKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: MemoryConsentService,
    private readonly ai: AiServiceClient,
    private readonly usage: UsageLimitsService,
    private readonly audit: AuditService,
    @Inject(WORKFLOW_STARTER) private readonly workflows: WorkflowStarter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.pseudonymKey = env.LOG_PSEUDONYMIZATION_KEY ?? LOCAL_PSEUDONYMIZATION_KEY;
  }

  // ── job creation (inside finalize's memory savepoint, §8.2) ─────────────────────────────

  /** Inserts the job when ALL conditions hold; returns what to start after commit, or null. */
  async enqueueInTx(
    tx: TransactionClient,
    input: { userId: string; replyMessageId: string; replyStatus: string },
  ): Promise<{ jobId: string; sourceMessageId: string } | null> {
    if (!this.env.MEMORY_FEATURE_ENABLED) return null;
    if (!EXTRACTION_ELIGIBLE_REPLY_STATUSES.includes(input.replyStatus)) return null;
    const reply = await tx.conversationMessage.findFirst({
      where: { id: input.replyMessageId, userId: input.userId, role: 'assistant' },
      select: { threadId: true, replyToMessageId: true },
    });
    if (!reply?.replyToMessageId) return null;
    const [thread, source] = await Promise.all([
      tx.conversationThread.findFirst({
        where: { id: reply.threadId, userId: input.userId },
        select: { mode: true, memoryEnabled: true },
      }),
      tx.conversationMessage.findFirst({
        where: {
          id: reply.replyToMessageId,
          userId: input.userId,
          threadId: reply.threadId,
          role: 'user',
        },
        select: { id: true },
      }),
    ]);
    if (!thread || thread.mode !== 'standard' || !thread.memoryEnabled || !source) return null;
    if (!(await this.consent.isEligibleInTx(tx, input.userId))) return null;
    if ((await countJobsToday(tx, input.userId)) >= this.env.MEMORY_EXTRACTIONS_PER_DAY) {
      return null;
    }
    const jobId = await insertExtractionJob(tx, {
      userId: input.userId,
      sourceMessageId: source.id,
      threadId: reply.threadId,
      replyMessageId: input.replyMessageId,
    });
    return jobId ? { jobId, sourceMessageId: source.id } : null;
  }

  /** After the terminal commit. A start failure never affects chat; the sweep re-kicks (§8.5). */
  async startWorkflow(job: { jobId: string; sourceMessageId: string }): Promise<void> {
    try {
      await this.workflows.start(
        MEMORY_WORKFLOWS.EXTRACTION,
        memoryExtractionWorkflowId(job.sourceMessageId),
        TASK_QUEUES.TASKS,
        { jobId: job.jobId },
      );
    } catch (error) {
      this.logger.warn(
        { job_id: job.jobId, err_class: errClass(error) },
        'Memory extraction workflow start failed; the maintenance sweep will re-kick it',
      );
      memoryCount('karen_memory_job_enqueue_failures_total', { stage: 'start' });
    }
  }

  // ── run step (§8.4) ──────────────────────────────────────────────────────────────────────

  private async lookup(jobId: string): Promise<{ userId: string; status: string }> {
    const rows = await this.prisma.$queryRaw<{ user_id: string; status: string }[]>`
      SELECT user_id, status FROM memory.lookup_extraction_job(${jobId}::uuid)`;
    const row = rows[0];
    if (!row) throw new ApiError('NOT_FOUND', 'Not found.');
    return { userId: row.user_id, status: row.status };
  }

  private async storedOutcome(userId: string, jobId: string): Promise<StepResult> {
    const row = await this.prisma.withUserScope(userId, (tx) =>
      tx.memoryExtractionJob.findFirst({
        where: { id: jobId, userId },
        select: { outcomeCode: true, status: true },
      }),
    );
    return { outcome: row?.outcomeCode ?? row?.status ?? 'source_gone' };
  }

  private finishInOwnTx(
    userId: string,
    jobId: string,
    version: number,
    f: Parameters<typeof finishJob>[4],
  ): Promise<boolean> {
    return this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      return finishJob(tx, userId, jobId, version, f);
    });
  }

  async run(jobId: string): Promise<StepResult> {
    const located = await this.lookup(jobId); // unknown → 404 (non-retryable for the worker)
    if (!['pending', 'running'].includes(located.status)) {
      return this.storedOutcome(located.userId, jobId); // idempotent replay
    }
    const userId = located.userId;

    // TX-A: re-check everything under the user lock, take ownership with a CAS.
    const claim = await this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      const job = await lockJob(tx, userId, jobId);
      if (!job) return { kind: 'gone' as const };
      if (!['pending', 'running'].includes(job.status)) {
        return { kind: 'done' as const, outcome: job.outcome_code ?? job.status };
      }
      if (
        job.status === 'running' &&
        job.started_at &&
        Date.now() - job.started_at.getTime() < STEP_TIMEOUT_MS
      ) {
        return { kind: 'busy' as const }; // another attempt owns it
      }
      const skip = await this.ineligibleReason(tx, userId, job);
      if (skip) {
        await finishJob(tx, userId, jobId, job.version, { status: 'skipped', outcome: skip });
        return { kind: 'done' as const, outcome: skip };
      }
      if (job.attempts >= MEMORY_LIMITS.maxAttempts) {
        await finishJob(tx, userId, jobId, job.version, {
          status: 'failed',
          outcome: 'gateway_error',
        });
        return { kind: 'done' as const, outcome: 'gateway_error' };
      }
      await tx.$executeRaw`
        UPDATE memory.extraction_jobs
           SET status = 'running', attempts = attempts + 1, started_at = now(),
               policy_version = ${MEMORY_POLICY_VERSION}, version = version + 1
         WHERE id = ${jobId}::uuid AND user_id = ${userId}::uuid AND version = ${job.version}`;
      const source = await tx.conversationMessage.findFirstOrThrow({
        where: { id: job.source_message_id, userId },
        select: { content: true, createdAt: true },
      });
      const thread = await tx.conversationThread.findFirstOrThrow({
        where: { id: job.thread_id, userId },
        select: { locale: true },
      });
      return {
        kind: 'claimed' as const,
        job: { ...job, attempts: job.attempts + 1, version: job.version + 1 },
        message: source.content,
        recordedAt: source.createdAt,
        locale: thread.locale,
      };
    });
    if (claim.kind === 'gone') return { outcome: 'source_gone' };
    if (claim.kind === 'done') return { outcome: claim.outcome };
    if (claim.kind === 'busy') return { outcome: 'running' };

    const { job, message } = claim;
    if ([...message].length > MEMORY_LIMITS.maxMessageChars) {
      await this.finishInOwnTx(userId, jobId, job.version, {
        status: 'skipped',
        outcome: 'too_long',
      });
      return { outcome: 'too_long' };
    }
    // Usage: reserve before the AI call (D10); refused → skipped/budget.
    const reservationKey = `memx:${jobId}:${job.attempts}`;
    const reserveUsd = this.env.MEMORY_EXTRACTION_RESERVE_USD;
    try {
      await this.usage.reserve(userId, reservationKey, new Date(), usdToMicro(reserveUsd));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'USAGE_LIMIT_REACHED') {
        await this.finishInOwnTx(userId, jobId, job.version, {
          status: 'skipped',
          outcome: 'budget',
        });
        return { outcome: 'budget' };
      }
      await this.releaseForRetry(userId, jobId, job.version);
      throw error;
    }
    // M-06: consent re-checked IMMEDIATELY before the AI call (both purposes).
    const stillAllowed = await this.prisma.withUserScope(userId, async (tx) => {
      const [memory, ai] = await Promise.all([
        this.consent.isEligibleInTx(tx, userId),
        tx.consentGrant.findFirst({
          where: {
            userId,
            purpose: 'AI_PROCESSING',
            scope: '*',
            status: 'ACTIVE',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { id: true },
        }),
      ]);
      return memory && ai !== null;
    });
    if (!stillAllowed) {
      await this.usage.settleCounters(userId, reservationKey, 0);
      await this.finishInOwnTx(userId, jobId, job.version, {
        status: 'skipped',
        outcome: 'consent_revoked',
      });
      return { outcome: 'consent_revoked' };
    }

    let candidates: MemoryCandidate[];
    let isMock = true;
    let costMicro = 0;
    let servedModel: string | null = null;
    let requestedModel: string | null = null;
    let promptVersion: string | null = null;
    const requestId = memoryExtractionRequestId(jobId, job.attempts);
    const started = Date.now();
    try {
      const res = await this.ai.extractMemory({
        request_id: requestId,
        user_ref: pseudonymizeUserId(userId, this.pseudonymKey),
        message_text: message,
        ...(claim.locale ? { locale: claim.locale } : {}),
        max_candidates: MEMORY_LIMITS.maxCandidatesPerMessage,
        max_cost_usd: reserveUsd,
      });
      candidates = res.candidates;
      isMock = res.is_mock;
      costMicro = res.is_mock ? 0 : usdToMicro(res.estimated_cost_usd ?? reserveUsd);
      servedModel = res.served_model;
      requestedModel = res.requested_model;
      promptVersion = res.prompt_version;
    } catch (error) {
      await this.usage.settleCounters(userId, reservationKey, 0);
      if (error instanceof AiServiceError && !error.retryable) {
        await this.finishInOwnTx(userId, jobId, job.version, {
          status: 'failed',
          outcome: 'gateway_error',
        });
        return { outcome: 'gateway_error' };
      }
      await this.releaseForRetry(userId, jobId, job.version);
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Extraction temporarily unavailable.', {
        retryable: true,
        cause: error,
      });
    }

    // TX-B: re-check under the user lock, then write with ON CONFLICT / row locks (M-02).
    const outcome = await this.prisma.withUserScope(
      userId,
      async (tx) => {
        await lockUserForMemory(tx, userId);
        const current = await lockJob(tx, userId, jobId);
        if (!current) return 'source_gone';
        if (current.status !== 'running' || current.version !== job.version) {
          return current.outcome_code ?? current.status; // canceled/cleared/lost CAS: write nothing
        }
        const skip = await this.ineligibleReason(tx, userId, current);
        if (skip) {
          await finishJob(tx, userId, jobId, current.version, { status: 'skipped', outcome: skip });
          return skip;
        }
        const result = await this.writeCandidates(
          tx,
          userId,
          current,
          message,
          claim.recordedAt,
          candidates,
        );
        await finishJob(tx, userId, jobId, current.version, {
          status: 'completed',
          outcome: result.outcome,
          stored: result.stored,
          suggested: result.suggested,
          rejected: result.rejected,
          rejectedClass: result.rejectedClass,
        });
        await tx.aiInvocation.create({
          data: {
            userId,
            messageId: null,
            requestId,
            routeTier: 'ECONOMY',
            requestedModel,
            servedModel,
            promptVersion,
            costMicroUsd: BigInt(costMicro),
            latencyMs: Date.now() - started,
            isMock,
            status: 'completed',
          },
        });
        await this.usage.recordInLedger(tx, {
          userId,
          costMicroUsd: costMicro,
          inputTokens: null,
          outputTokens: null,
          kind: 'memory_extraction',
        });
        await this.audit.record(
          {
            actorType: 'SYSTEM',
            actorRef: 'temporal:memoryExtractionWorkflow',
            action: 'memory.extraction.completed',
            subjectType: 'memory_extraction_job',
            subjectId: jobId,
            outcome: 'SUCCESS',
            metadata: {
              outcome: result.outcome,
              stored: result.stored,
              suggested: result.suggested,
              rejected: result.rejected,
              is_mock: isMock,
            },
          },
          tx,
        );
        memoryCount(
          'karen_memory_rejections_total',
          { class: result.rejectedClass ?? 'none' },
          result.rejected,
        );
        return result.outcome;
      },
      { timeoutMs: 15_000 },
    );
    await this.usage.settleCounters(userId, reservationKey, costMicro);
    memoryCount('karen_memory_extraction_jobs_total', {
      outcome_code: outcome,
      is_mock: String(isMock),
    });
    memoryCount(
      'karen_memory_extraction_cost_micro_usd_total',
      { is_mock: String(isMock) },
      costMicro,
    );
    return { outcome };
  }

  /** Workflow gave up after its retries: mark failed (idempotent; terminal rows untouched). */
  async abandon(jobId: string): Promise<StepResult> {
    const located = await this.lookup(jobId);
    if (!['pending', 'running'].includes(located.status)) {
      return this.storedOutcome(located.userId, jobId);
    }
    const userId = located.userId;
    return this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      const job = await lockJob(tx, userId, jobId);
      if (!job) return { outcome: 'source_gone' };
      if (!['pending', 'running'].includes(job.status))
        return { outcome: job.outcome_code ?? job.status };
      await finishJob(tx, userId, jobId, job.version, { status: 'failed', outcome: 'abandoned' });
      memoryCount('karen_memory_extraction_jobs_total', {
        outcome_code: 'abandoned',
        is_mock: 'unknown',
      });
      return { outcome: 'abandoned' };
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────

  /** Puts a claimed job back to `pending` so a workflow retry can take it immediately. */
  private async releaseForRetry(userId: string, jobId: string, version: number): Promise<void> {
    await this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      await tx.$executeRaw`
        UPDATE memory.extraction_jobs
           SET status = 'pending', started_at = NULL, next_attempt_at = now(), version = version + 1
         WHERE id = ${jobId}::uuid AND user_id = ${userId}::uuid AND version = ${version}
           AND status = 'running'`;
    });
  }

  /** Re-derives eligibility from the database (never from workflow input). */
  private async ineligibleReason(
    tx: TransactionClient,
    userId: string,
    job: JobRow,
  ): Promise<string | null> {
    if (!this.env.MEMORY_FEATURE_ENABLED) return 'feature_off';
    const [source, thread] = await Promise.all([
      tx.conversationMessage.findFirst({
        where: { id: job.source_message_id, userId, threadId: job.thread_id, role: 'user' },
        select: { id: true },
      }),
      tx.conversationThread.findFirst({
        where: { id: job.thread_id, userId },
        select: { mode: true, memoryEnabled: true },
      }),
    ]);
    if (!source || !thread) return 'source_gone';
    if (thread.mode !== 'standard' || !thread.memoryEnabled) return 'thread_off';
    if (!(await this.consent.isEligibleInTx(tx, userId))) return 'consent_revoked';
    return null;
  }

  private async writeCandidates(
    tx: TransactionClient,
    userId: string,
    job: JobRow,
    message: string,
    recordedAt: Date,
    candidates: readonly MemoryCandidate[],
  ): Promise<{
    outcome: string;
    stored: number;
    suggested: number;
    rejected: number;
    rejectedClass: MemoryRejectionClass | null;
  }> {
    let stored = 0;
    let suggested = 0;
    let rejected = 0;
    let duplicates = 0;
    let capped = 0;
    let worst: MemoryRejectionClass | null = null;
    const reject = (c: MemoryRejectionClass, n = 1) => {
      rejected += n;
      if (worst === null || REJECTION_SEVERITY.indexOf(c) < REJECTION_SEVERITY.indexOf(worst))
        worst = c;
    };
    // V5/V6b on the WHOLE message: any hit means no memory at all from it.
    const whole = rejectWholeMessage(message);
    if (whole) {
      reject(whole.class, Math.max(1, candidates.length));
      return { outcome: 'rejected', stored, suggested, rejected, rejectedClass: worst };
    }
    const settings = await tx.memoryUserSettings.findUnique({ where: { userId } });
    const now = new Date();
    const suggestionTtl = new Date(now.getTime() + this.env.MEMORY_SUGGESTION_TTL_DAYS * DAY_MS);
    const revisionTtl = new Date(now.getTime() + this.env.MEMORY_REVISION_RETENTION_DAYS * DAY_MS);
    let active = await countActiveItems(tx, userId);
    let pending = await countPendingSuggestions(tx, userId);
    for (const cand of candidates.slice(0, MEMORY_LIMITS.maxCandidatesPerMessage)) {
      const d = validateCandidate(cand, {
        message,
        askBeforeSaving: settings?.askBeforeSaving ?? false,
      });
      if (!d.accepted) {
        reject(d.class);
        memoryCount('karen_memory_candidates_total', { decision: 'rejected', kind: 'unknown' });
        continue;
      }
      const content: ItemContent = {
        kind: d.kind,
        slot: d.slot,
        subject: d.subject,
        subjectLabel: d.subjectLabel,
        text: d.text,
      };
      const expiresAt = this.expiry(d.kind, d.validUntil, now);
      const source = {
        sourceMessageId: job.source_message_id,
        sourceThreadId: job.thread_id,
        sourceExcerpt: d.sourceSpan,
        sourceRecordedAt: recordedAt,
      };
      if (await findActiveDuplicate(tx, userId, content)) {
        duplicates += 1;
        memoryCount('karen_memory_candidates_total', { decision: 'duplicate', kind: d.kind });
        continue;
      }
      const holder =
        d.subject === 'self' && isSingleValuedSlot(d.slot)
          ? await lockActiveSingleSlot(tx, userId, d.slot)
          : null;
      const asSuggestion = async (
        reason: 'stated' | 'third_party' | 'conflict' | 'ask_before_saving',
        conflictsWith: string | null,
      ) => {
        if (pending >= this.env.MEMORY_MAX_PENDING_SUGGESTIONS) {
          capped += 1;
          return;
        }
        const id = await insertSuggestion(tx, {
          userId,
          ...content,
          reason,
          conflictsWithItemId: conflictsWith,
          ...source,
          validUntil: d.validUntil ? new Date(`${d.validUntil}T00:00:00Z`) : null,
          expiresAt: suggestionTtl,
        });
        if (id) {
          pending += 1;
          suggested += 1;
          memoryCount('karen_memory_candidates_total', { decision: 'tier2', kind: d.kind });
        } else {
          duplicates += 1;
        }
      };
      if (d.tier === 1) {
        // Tier 1 wins over an identical pending suggestion.
        await tx.memorySuggestion.deleteMany({
          where: { userId, kind: content.kind, slot: content.slot, valueKey: valueKeyOf(content) },
        });
        if (holder) {
          if (holder.pinned || holder.edited) {
            await asSuggestion('conflict', holder.id); // the user's own pin/edit is never overridden
          } else {
            await supersedeItem(tx, userId, holder.id, {
              ...content,
              ...source,
              expiresAt,
              revisionExpiresAt: revisionTtl,
            });
            stored += 1;
            memoryCount('karen_memory_candidates_total', { decision: 'tier1', kind: d.kind });
          }
          continue;
        }
        if (active >= this.env.MEMORY_MAX_ACTIVE_ITEMS) {
          capped += 1;
          continue;
        }
        const id = await insertItem(tx, {
          userId,
          ...content,
          origin: 'explicit_request',
          pinned: false,
          ...source,
          expiresAt,
          editedAt: null,
        });
        if (id) {
          active += 1;
          stored += 1;
          memoryCount('karen_memory_candidates_total', { decision: 'tier1', kind: d.kind });
        } else {
          duplicates += 1;
        }
        continue;
      }
      const reason =
        holder !== null
          ? 'conflict'
          : d.subject === 'third_party'
            ? 'third_party'
            : d.tier2Reason === 'ask_before_saving'
              ? 'ask_before_saving'
              : 'stated';
      await asSuggestion(reason, holder?.id ?? null);
    }
    const outcome =
      stored > 0
        ? 'stored'
        : suggested > 0
          ? 'suggested'
          : rejected > 0
            ? 'rejected'
            : capped > 0
              ? 'cap_reached'
              : duplicates > 0
                ? 'duplicate'
                : 'nothing_found';
    return { outcome, stored, suggested, rejected, rejectedClass: worst };
  }

  private expiry(kind: MemoryKind, validUntil: string | null, now: Date): Date | null {
    if (kind === 'context') {
      const stated = validUntil ? Date.parse(`${validUntil}T00:00:00Z`) + DAY_MS : NaN;
      return Number.isFinite(stated) && stated > now.getTime()
        ? new Date(stated)
        : new Date(now.getTime() + this.env.MEMORY_CONTEXT_TTL_DAYS * DAY_MS);
    }
    if (kind === 'event') return new Date(now.getTime() + this.env.MEMORY_EVENT_TTL_DAYS * DAY_MS);
    return null;
  }
}
