import { memoryContextItemSchema, type MemoryContextItem } from '@karen/ai-model-contracts';
import {
  MEMORY_LIMITS,
  effectiveMemoryStatus,
  rankMemories,
  tokenizeForSearch,
  type MemoryWireStatus,
  type RetrievalCandidate,
} from '@karen/domain/memory';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { MemoryConsentService } from './memory-consent.js';
import { memoryCount, memoryObserve } from './memory-metrics.js';
import { selectRetrievalCandidates } from './memory.repository.js';

export interface RetrievalInput {
  userId: string;
  threadId: string;
  /** The user message being answered. */
  latestUserText: string;
  /** The user message before it (used when the latest has < 3 tokens, e.g. "aur?"). */
  previousUserText: string | null;
}

export interface SentMemory {
  itemId: string;
  ref: string;
  rank: number;
  reason: 'pinned' | 'lexical' | 'always' | 'recent';
}

export interface RetrievalResult {
  /** Wire status; `undefined` = feature off → the API omits both memory fields (Phase 02). */
  status: MemoryWireStatus | undefined;
  context: MemoryContextItem[];
  /** What was sent, for access events (ids stay in the API; the wire carries opaque refs). */
  sent: SentMemory[];
}

const REASON_PRIORITY = ['pinned', 'lexical', 'always', 'recent'] as const;

/**
 * Read path (arch §6, §9.1): a SEPARATE short `withUserScope` transaction with
 * `statement_timeout`, which re-checks the thread switch and MEMORY_STORAGE eligibility, selects
 * bounded owner-filtered candidates, ranks them in TypeScript, applies the budget, and validates
 * EVERY item against the wire schema (invalid → dropped and counted, never sent, M-01).
 * Any failure → `unavailable` and an empty context: retrieval never fails a chat turn (§9.4).
 * Nothing is cached (§1.2): deletions are reflected on the next turn by construction.
 */
@Injectable()
export class MemoryRetrievalService {
  private readonly logger = new Logger(MemoryRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: MemoryConsentService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async retrieve(input: RetrievalInput, now = new Date()): Promise<RetrievalResult> {
    if (!this.env.MEMORY_FEATURE_ENABLED) return { status: undefined, context: [], sent: [] };
    const started = performance.now();
    let tokens = tokenizeForSearch(input.latestUserText);
    if (tokens.length < MEMORY_LIMITS.minQueryTokens && input.previousUserText) {
      tokens = [...new Set([...tokens, ...tokenizeForSearch(input.previousUserText)])];
    }
    let loaded: {
      status: MemoryWireStatus;
      rows: Awaited<ReturnType<typeof selectRetrievalCandidates>>;
    };
    try {
      loaded = await this.prisma.withUserScope(
        input.userId,
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${`${this.env.MEMORY_RETRIEVAL_TIMEOUT_MS}ms`}, true)`;
          const thread = await tx.conversationThread.findFirst({
            where: { id: input.threadId, userId: input.userId },
            select: { mode: true, memoryEnabled: true },
          });
          if (!thread) return { status: 'unavailable' as const, rows: [] };
          const status = effectiveMemoryStatus({
            featureEnabled: true,
            threadMode: thread.mode as 'standard' | 'ephemeral',
            threadMemoryEnabled: thread.memoryEnabled,
            consentEligible: await this.consent.isEligibleInTx(tx, input.userId),
          });
          if (status !== 'on') return { status: status as MemoryWireStatus, rows: [] };
          const rows = await selectRetrievalCandidates(tx, input.userId, tokens, {
            lexicalMax: MEMORY_LIMITS.candidateLexicalMax,
            pinnedMax: MEMORY_LIMITS.pinnedMax,
            preferenceMax: MEMORY_LIMITS.candidatePreferenceMax,
            recentMax: MEMORY_LIMITS.candidateRecentMax,
            recentWindowDays: MEMORY_LIMITS.recentWindowDays,
          });
          return { status: 'on' as const, rows };
        },
        { timeoutMs: Math.max(1_000, this.env.MEMORY_RETRIEVAL_TIMEOUT_MS * 4) },
      );
    } catch (error) {
      // Error CLASS only — never the query text or memory content.
      this.logger.warn(
        { err_class: error instanceof Error ? error.constructor.name : typeof error },
        'Memory retrieval failed; answering without memory',
      );
      memoryCount('karen_memory_retrieval_outcome_total', { memory_status: 'unavailable' });
      memoryObserve('karen_memory_retrieval_duration_ms', performance.now() - started, {
        status: 'unavailable',
      });
      return { status: 'unavailable', context: [], sent: [] };
    }
    if (loaded.status !== 'on') {
      memoryCount('karen_memory_retrieval_outcome_total', { memory_status: loaded.status });
      return { status: loaded.status, context: [], sent: [] };
    }

    const candidates: RetrievalCandidate[] = loaded.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      slot: r.slot,
      subject: r.subject,
      subjectLabel: r.subject_label,
      text: r.value_text,
      pinned: r.pinned,
      lexemes: r.lexemes,
      valueKey: r.value_key,
      reasons: r.reasons,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      expiresAt: r.expires_at,
      eventDate: null,
    }));
    const confirmed = new Map(loaded.rows.map((r) => [r.id, r.confirmed_at]));
    const ranked = rankMemories(candidates, tokens, now, {
      maxItems: this.env.MEMORY_CONTEXT_BUDGET_ITEMS,
      maxChars: this.env.MEMORY_CONTEXT_MAX_CHARS,
    });

    const context: MemoryContextItem[] = [];
    const sent: SentMemory[] = [];
    for (const r of ranked) {
      const ref = `m${context.length + 1}`;
      const parsed = memoryContextItemSchema.safeParse({
        ref,
        kind: r.kind,
        slot: r.slot,
        subject: r.subject,
        ...(r.subject === 'third_party' && r.subjectLabel ? { subject_label: r.subjectLabel } : {}),
        text: r.text,
        saved_on: (confirmed.get(r.id) ?? r.createdAt).toISOString().slice(0, 10),
      });
      if (!parsed.success) {
        // Backstop only: the write-time policy makes this unreachable for valid rows (M-01).
        memoryCount('karen_memory_retrieval_dropped_total', { reason: 'schema' });
        continue;
      }
      context.push(parsed.data);
      const reason = REASON_PRIORITY.find((p) => r.reasons.includes(p)) ?? 'recent';
      sent.push({ itemId: r.id, ref, rank: context.length, reason });
      memoryObserve('karen_memory_retrieval_items', 1, { reason });
    }
    memoryCount('karen_memory_retrieval_outcome_total', { memory_status: 'on' });
    memoryObserve('karen_memory_retrieval_duration_ms', performance.now() - started, {
      status: 'on',
    });
    return { status: 'on', context, sent };
  }
}
