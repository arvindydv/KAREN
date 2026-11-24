import type { ClearMemoryRequest, ClearMemoryResponse } from '@karen/api-contracts';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  requestFingerprint,
} from '../infrastructure/database/idempotency.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { lockUserForMemory } from './memory-consent.js';
import { cancelPendingJobs } from './memory.repository.js';

/**
 * Synchronous memory deletion (arch §8.6, D10): never depends on Temporal, never needs consent,
 * works with the feature flag off. `clear` cancels the in-scope pending/running extraction jobs
 * in the same transaction (Q16 / M-12), so a delayed job can never resurrect cleared memory:
 * the job's write step re-reads its row under the same user lock and finds it canceled.
 */
@Injectable()
export class MemoryDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async clear(
    userId: string,
    req: ClearMemoryRequest,
    idempotencyKey: string,
  ): Promise<ClearMemoryResponse> {
    const scope = 'memory.clear';
    const fingerprint = requestFingerprint(scope, req);
    return this.prisma.withUserScope(
      userId,
      async (tx) => {
        await lockUserForMemory(tx, userId);
        const claim = await claimIdempotencyKey(tx, {
          userId,
          scope,
          key: idempotencyKey,
          fingerprint,
        });
        if (!claim.fresh) return claim.result as unknown as ClearMemoryResponse;
        const out = await this.clearInTx(tx, userId, req);
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: userId,
            action: 'memory.cleared',
            subjectType: 'memory',
            outcome: 'SUCCESS',
            metadata: {
              scope: req.scope,
              ...(req.scope === 'kind' ? { kind: req.kind } : {}),
              items_deleted: out.items_deleted,
              suggestions_deleted: out.suggestions_deleted,
              pending_saves_canceled: out.pending_saves_canceled,
            },
          },
          tx,
        );
        await completeIdempotencyKey(tx, {
          userId,
          scope,
          key: idempotencyKey,
          status: 200,
          result: { ...out },
        });
        return out;
      },
      { timeoutMs: 30_000 },
    );
  }

  /**
   * For `DELETE /v1/conversations/{id}?delete_memories=true` (M-05): called by the conversation
   * module inside ITS transaction, BEFORE the thread row is deleted (afterwards `source_thread_id`
   * would already be NULL and nothing would match). The caller holds the thread lock; the user
   * row is locked here first, preserving the lock order for memory rows.
   */
  async clearThreadInTx(
    tx: TransactionClient,
    userId: string,
    threadId: string,
  ): Promise<ClearMemoryResponse> {
    await lockUserForMemory(tx, userId);
    return this.clearInTx(tx, userId, { scope: 'conversation', conversation_id: threadId });
  }

  private async clearInTx(
    tx: TransactionClient,
    userId: string,
    req: ClearMemoryRequest,
  ): Promise<ClearMemoryResponse> {
    const where =
      req.scope === 'all'
        ? { userId }
        : req.scope === 'kind'
          ? { userId, kind: req.kind }
          : { userId, sourceThreadId: req.conversation_id };
    const items = await tx.memoryItem.deleteMany({ where });
    const suggestions = await tx.memorySuggestion.deleteMany({ where });
    // `kind` cannot cancel jobs: a job's kinds are unknown until it runs (documented, M-12).
    const canceled =
      req.scope === 'kind'
        ? 0
        : await cancelPendingJobs(
            tx,
            userId,
            req.scope === 'conversation' ? req.conversation_id : null,
            'cleared',
          );
    return {
      items_deleted: items.count,
      suggestions_deleted: suggestions.count,
      pending_saves_canceled: canceled,
    };
  }
}
