import { Inject, Injectable, Logger } from '@nestjs/common';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import type { SentMemory } from './memory-retrieval.service.js';
import { memoryCount } from './memory-metrics.js';
import { MemoryExtractionService } from './memory-extraction.service.js';
import { insertAccessEvents, touchLastUsed } from './memory.repository.js';

const SAVEPOINT = 'karen_memory_finalize';

export interface FinalizeMemoryInput {
  userId: string;
  replyMessageId: string;
  sent: readonly SentMemory[];
  /** Terminal status of the reply (drives extraction eligibility, Q10). */
  replyStatus: string;
}

/** What `finalize()` must do after its transaction commits. */
export interface FinalizeMemoryOutcome {
  ok: boolean;
  job: { jobId: string; sourceMessageId: string } | null;
}

const errClass = (e: unknown) => (e instanceof Error ? e.constructor.name : typeof e);

/**
 * The memory part of a reply's terminal transaction (arch §2.3 item 4, §9.4, H3).
 *
 * Everything runs behind ONE savepoint inside the caller's (finalize) transaction: the user row
 * is locked FOR KEY SHARE first (lock order, §5.4 — the mode the earlier FK inserts already
 * hold, so no upgrade is requested), then access events are written with `INSERT … SELECT` from
 * still-active owned items. Any error rolls back to the savepoint, is logged (error class only)
 * and counted — and the reply, its invocation record and its ledger entry still commit.
 * `finalize()` never updates `memory.items`; `last_used_at` is a separate post-commit step.
 */
@Injectable()
export class MemoryTurnService {
  private readonly logger = new Logger(MemoryTurnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: MemoryExtractionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * Access events AND the extraction job insert, behind ONE savepoint (H3, 03C-02). `ok=false`
   * when the memory section was rolled back (the caller's transaction is intact).
   */
  async writeInTx(
    tx: TransactionClient,
    input: FinalizeMemoryInput,
  ): Promise<FinalizeMemoryOutcome> {
    if (!this.env.MEMORY_FEATURE_ENABLED && input.sent.length === 0) return { ok: true, job: null };
    await tx.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
    try {
      await tx.$queryRaw`
        SELECT 1 FROM identity.users WHERE id = ${input.userId}::uuid FOR KEY SHARE`;
      await insertAccessEvents(
        tx,
        input.userId,
        input.replyMessageId,
        input.sent,
        this.env.MEMORY_ACCESS_EVENT_RETENTION_DAYS,
      );
      const job = await this.extraction.enqueueInTx(tx, {
        userId: input.userId,
        replyMessageId: input.replyMessageId,
        replyStatus: input.replyStatus,
      });
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return { ok: true, job };
    } catch (error) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      this.logger.warn(
        { reply_message_id: input.replyMessageId, err_class: errClass(error) },
        'Memory section of finalize rolled back; the reply still commits',
      );
      memoryCount('karen_memory_job_enqueue_failures_total', { stage: 'finalize' });
      return { ok: false, job: null };
    }
  }

  /** Post-commit: best-effort last_used_at, then the workflow start (failure → re-kick). */
  async afterCommit(
    userId: string,
    sent: readonly SentMemory[],
    outcome: FinalizeMemoryOutcome | null,
  ) {
    await this.touchLastUsed(userId, sent);
    if (outcome?.job) await this.extraction.startWorkflow(outcome.job);
  }

  /** Post-commit, best-effort (§9.4). Own short transaction; user row FOR SHARE first. */
  async touchLastUsed(userId: string, sent: readonly SentMemory[]): Promise<void> {
    if (sent.length === 0) return;
    try {
      await this.prisma.withUserScope(userId, async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM identity.users WHERE id = ${userId}::uuid FOR SHARE`;
        await touchLastUsed(
          tx,
          userId,
          sent.map((s) => s.itemId),
        );
      });
    } catch (error) {
      this.logger.warn({ err_class: errClass(error) }, 'last_used_at update failed');
      memoryCount('karen_memory_last_used_update_failures_total');
    }
  }
}
