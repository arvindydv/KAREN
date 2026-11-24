import type { createMemoryRequestSchema } from '@karen/api-contracts';
import type {
  ConfirmSuggestionRequest,
  MemoryActivity,
  MemoryItem,
  MemoryItemList,
  MemoryListQuery,
  MemorySettings,
  MemoryStatusResponse,
  MemorySuggestion,
  MemorySuggestionList,
  RestoreMemoryResponse,
  UndoMemoryResponse,
  UpdateMemoryRequest,
} from '@karen/api-contracts';
import {
  isSingleValuedSlot,
  validateUserAuthoredMemory,
  type MemoryKind,
  type UserAuthoredDecision,
} from '@karen/domain/memory';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  requestFingerprint,
} from '../infrastructure/database/idempotency.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { MemoryConsentService, lockUserForMemory } from './memory-consent.js';
import { decodeCursor, encodeCursor, toMemoryItem, toMemorySuggestion } from './memory.mappers.js';
import {
  countActiveItems,
  countPendingSuggestions,
  findActiveDuplicate,
  insertItem,
  insertSuggestion,
  listItemIds,
  lockActiveSingleSlot,
  lockItem,
  lockSuggestion,
  lockSuspendedItems,
  updateItemContent,
  type ItemContent,
} from './memory.repository.js';

const DAY_MS = 86_400_000;
export const memoryNotFound = () => new ApiError('NOT_FOUND', 'Memory not found.');
/** Write routes while MEMORY_FEATURE_ENABLED=false (arch §3.7): indistinguishable from absent. */
const featureOff = () => new ApiError('NOT_FOUND', 'Not found.');

/** Refusal without echoing content; the class lets the app pick (legal-gated) copy. */
function rejected(d: Extract<UserAuthoredDecision, { accepted: false }>): ApiError {
  return new ApiError('VALIDATION_FAILED', 'This can’t be saved as a memory.', {
    details: [{ path: d.field, message: d.class }],
  });
}

/** `valid_until` (a date) → the instant it stops applying: the end of that day (UTC). */
const endOfDay = (date: string): Date => new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS);

/**
 * Memory CRUD and controls (arch §3.3–§3.7). Every query: `withUserScope` + explicit user filter.
 * Every write: one transaction that first locks `identity.users` FOR SHARE (lock order, §5.4),
 * then re-checks the feature flag and — for content writes — MEMORY_STORAGE eligibility inside
 * that transaction. Unique races are resolved with ON CONFLICT / pre-checks under row locks,
 * never by catching a unique violation (M-02).
 */
@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: MemoryConsentService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get featureEnabled(): boolean {
    return this.env.MEMORY_FEATURE_ENABLED;
  }

  private requireFeature(): void {
    if (!this.env.MEMORY_FEATURE_ENABLED) throw featureOff();
  }

  private audited(
    tx: TransactionClient,
    userId: string,
    action: string,
    subjectId: string | undefined,
    metadata: Record<string, string | number | boolean | null> = {},
  ) {
    return this.audit.record(
      {
        actorType: 'USER',
        actorRef: userId,
        action,
        subjectType: 'memory',
        ...(subjectId ? { subjectId } : {}),
        outcome: 'SUCCESS',
        metadata,
      },
      tx,
    );
  }

  private expiryFor(
    kind: MemoryKind,
    pinned: boolean,
    validUntil: string | undefined,
    now = new Date(),
  ): Date | null {
    if (validUntil !== undefined) {
      if (kind !== 'context' && kind !== 'event') {
        throw new ApiError('VALIDATION_FAILED', 'Only plans and events can have an end date.', {
          details: [{ path: 'valid_until', message: 'not allowed for this kind' }],
        });
      }
      const at = endOfDay(validUntil);
      if (at.getTime() <= now.getTime()) {
        throw new ApiError('VALIDATION_FAILED', 'The end date is in the past.', {
          details: [{ path: 'valid_until', message: 'in the past' }],
        });
      }
      return kind === 'event' && pinned ? null : at;
    }
    if (kind === 'context') {
      return new Date(now.getTime() + this.env.MEMORY_CONTEXT_TTL_DAYS * DAY_MS);
    }
    if (kind === 'event') {
      return pinned ? null : new Date(now.getTime() + this.env.MEMORY_EVENT_TTL_DAYS * DAY_MS);
    }
    return null;
  }

  private async loadItem(tx: TransactionClient, userId: string, id: string): Promise<MemoryItem> {
    const row = await tx.memoryItem.findFirst({
      where: { id, userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (!row) throw memoryNotFound();
    const revisions = await tx.memoryItemRevision.count({
      where: { itemId: id, userId, expiresAt: { gt: new Date() } },
    });
    return toMemoryItem(row, revisions);
  }

  // ── Reads (no consent; work with the feature off — there is simply nothing to show) ──────

  async list(userId: string, query: MemoryListQuery): Promise<MemoryItemList> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) {
      throw new ApiError('VALIDATION_FAILED', 'Invalid cursor.', {
        details: [{ path: 'cursor', message: 'invalid' }],
      });
    }
    return this.prisma.withUserScope(userId, async (tx) => {
      const ids = await listItemIds(tx, userId, {
        kind: query.kind,
        status: query.status,
        pinned: query.pinned,
        conversationId: query.conversation_id,
        q: query.q,
        cursor,
        limit: query.limit,
      });
      const page = ids.slice(0, query.limit);
      if (page.length === 0) return { items: [], next_cursor: null };
      const [rows, counts] = await Promise.all([
        tx.memoryItem.findMany({ where: { id: { in: page }, userId } }),
        tx.memoryItemRevision.groupBy({
          by: ['itemId'],
          where: { userId, itemId: { in: page }, expiresAt: { gt: new Date() } },
          _count: { _all: true },
        }),
      ]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const revs = new Map(counts.map((c) => [c.itemId, c._count._all]));
      const items = page
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => toMemoryItem(r, revs.get(r.id) ?? 0));
      const last = rows.find((r) => r.id === page.at(-1));
      return {
        items,
        next_cursor:
          ids.length > query.limit && last ? encodeCursor(last.updatedAt, last.id) : null,
      };
    });
  }

  get(userId: string, id: string): Promise<MemoryItem> {
    return this.prisma.withUserScope(userId, (tx) => this.loadItem(tx, userId, id));
  }

  async status(userId: string): Promise<MemoryStatusResponse> {
    return this.prisma.withUserScope(userId, async (tx) => {
      const [consent, settings, active, suspended, pending] = await Promise.all([
        this.consent.stateInTx(tx, userId),
        tx.memoryUserSettings.findUnique({ where: { userId } }),
        countActiveItems(tx, userId),
        tx.memoryItem.count({
          where: {
            userId,
            status: 'suspended',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        }),
        countPendingSuggestions(tx, userId),
      ]);
      return {
        feature_enabled: this.env.MEMORY_FEATURE_ENABLED,
        consent,
        ask_before_saving: settings?.askBeforeSaving ?? false,
        counts: { active, suspended, pending_suggestions: pending },
        limits: {
          max_active_items: this.env.MEMORY_MAX_ACTIVE_ITEMS,
          max_pending_suggestions: this.env.MEMORY_MAX_PENDING_SUGGESTIONS,
        },
      };
    });
  }

  async settings(userId: string): Promise<MemorySettings> {
    const row = await this.prisma.withUserScope(userId, (tx) =>
      tx.memoryUserSettings.findUnique({ where: { userId } }),
    );
    return { ask_before_saving: row?.askBeforeSaving ?? false, version: row?.version ?? 0 };
  }

  async listSuggestions(
    userId: string,
    q: { cursor?: string | undefined; limit: number },
  ): Promise<MemorySuggestionList> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor) {
      throw new ApiError('VALIDATION_FAILED', 'Invalid cursor.', {
        details: [{ path: 'cursor', message: 'invalid' }],
      });
    }
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.memorySuggestion.findMany({
        where: {
          userId,
          expiresAt: { gt: new Date() },
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.at } },
                  { createdAt: cursor.at, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      }),
    );
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(toMemorySuggestion),
      next_cursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** Extraction outcomes for a conversation's chips (§3.6, L-08): ids and codes only. */
  async activity(userId: string, conversationId: string, since?: string): Promise<MemoryActivity> {
    const sinceAt = since ? new Date(since) : null;
    return this.prisma.withUserScope(userId, async (tx) => {
      const jobs = await tx.memoryExtractionJob.findMany({
        where: { userId, threadId: conversationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const changedAt = (j: (typeof jobs)[number]) => j.completedAt ?? j.startedAt ?? j.createdAt;
      const recent = sinceAt ? jobs.filter((j) => changedAt(j) > sinceAt) : jobs;
      if (recent.length === 0) return { items: [] };
      const sources = recent.map((j) => j.sourceMessageId);
      const [items, suggestions] = await Promise.all([
        tx.memoryItem.findMany({
          where: { userId, sourceMessageId: { in: sources } },
          select: { id: true, version: true, sourceMessageId: true },
        }),
        tx.memorySuggestion.findMany({
          where: { userId, sourceMessageId: { in: sources } },
          select: { id: true, sourceMessageId: true },
        }),
      ]);
      return {
        items: recent.map((j) => ({
          job_id: j.id,
          source_message_id: j.sourceMessageId,
          status: j.status as MemoryActivity['items'][number]['status'],
          outcome_code: j.outcomeCode,
          stored_count: j.storedCount,
          suggested_count: j.suggestedCount,
          rejected_count: j.rejectedCount,
          rejected_class: j.rejectedClass as MemoryActivity['items'][number]['rejected_class'],
          items: items
            .filter((i) => i.sourceMessageId === j.sourceMessageId)
            .map((i) => ({ id: i.id, version: i.version })),
          suggestion_ids: suggestions
            .filter((s) => s.sourceMessageId === j.sourceMessageId)
            .map((s) => s.id),
          updated_at: changedAt(j).toISOString(),
        })),
      };
    });
  }

  // ── Content writes (feature on + eligible MEMORY_STORAGE) ───────────────────────────────

  /** Manual create (`origin = user_created`). Returns `created=false` for an identical existing memory. */
  async create(
    userId: string,
    body: z.infer<typeof createMemoryRequestSchema>,
    idempotencyKey: string,
  ): Promise<{ item: MemoryItem; created: boolean }> {
    this.requireFeature();
    const scope = 'memory.create';
    const fingerprint = requestFingerprint(scope, body);
    return this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      const claim = await claimIdempotencyKey(tx, {
        userId,
        scope,
        key: idempotencyKey,
        fingerprint,
      });
      if (!claim.fresh) {
        return {
          item: await this.loadItem(tx, userId, String(claim.result.item_id)),
          created: false,
        };
      }
      await this.consent.requireEligibleInTx(tx, userId);
      const d = validateUserAuthoredMemory({
        kind: body.kind,
        slot: body.slot ?? 'other',
        subject: body.subject ?? 'self',
        subjectLabel: body.subject_label ?? null,
        text: body.text,
      });
      if (!d.accepted) throw rejected(d);
      const pinned = body.pinned ?? false;
      const content: ItemContent = {
        kind: d.kind,
        slot: d.slot,
        subject: d.subject,
        subjectLabel: d.subjectLabel,
        text: d.text,
      };
      let id = await findActiveDuplicate(tx, userId, content);
      let created = false;
      if (!id) {
        if (d.subject === 'self') {
          const holder = await lockActiveSingleSlot(tx, userId, d.slot);
          if (holder) {
            throw new ApiError(
              'CONFLICT',
              'You already have a memory for this. Edit that one instead.',
              {
                nextOptions: [`EDIT_MEMORY:${holder.id}`],
              },
            );
          }
        }
        if ((await countActiveItems(tx, userId)) >= this.env.MEMORY_MAX_ACTIVE_ITEMS) {
          throw new ApiError(
            'CONFLICT',
            'You’ve reached the memory limit. Delete some memories first.',
          );
        }
        const now = new Date();
        id = await insertItem(tx, {
          userId,
          ...content,
          origin: 'user_created',
          pinned,
          sourceMessageId: null,
          sourceThreadId: null,
          sourceExcerpt: null,
          sourceRecordedAt: now,
          expiresAt: this.expiryFor(d.kind, pinned, body.valid_until, now),
          editedAt: null,
        });
        // ON CONFLICT lost a race to an identical concurrent insert → return that one.
        id ??= await findActiveDuplicate(tx, userId, content);
        if (!id) throw new ApiError('CONFLICT', 'This memory changed while saving. Try again.');
        created = true;
        await this.audited(tx, userId, 'memory.item.created', id, { origin: 'user_created' });
      }
      await completeIdempotencyKey(tx, {
        userId,
        scope,
        key: idempotencyKey,
        status: created ? 201 : 200,
        result: { item_id: id },
      });
      return { item: await this.loadItem(tx, userId, id), created };
    });
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: UpdateMemoryRequest,
  ): Promise<MemoryItem> {
    this.requireFeature();
    return this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      if (!(await lockItem(tx, userId, id))) throw memoryNotFound();
      const row = await tx.memoryItem.findFirstOrThrow({ where: { id, userId } });
      if (row.version !== expectedVersion) {
        throw new ApiError('PRECONDITION_FAILED', 'This memory was changed elsewhere. Reload it.');
      }
      if (row.status === 'suspended') {
        throw new ApiError('CONFLICT', 'Restore this memory before changing it.', {
          nextOptions: ['RESTORE_MEMORY'],
        });
      }
      await this.consent.requireEligibleInTx(tx, userId);
      const kind = (patch.kind ?? row.kind) as MemoryKind;
      const d = validateUserAuthoredMemory({
        kind,
        slot: patch.slot ?? (patch.kind ? 'other' : row.slot),
        subject: row.subject,
        subjectLabel: patch.subject_label ?? row.subjectLabel,
        text: patch.text ?? row.valueText,
      });
      if (!d.accepted) throw rejected(d);
      const content: ItemContent = {
        kind: d.kind,
        slot: d.slot,
        subject: d.subject,
        subjectLabel: d.subjectLabel,
        text: d.text,
      };
      const contentChanged =
        content.kind !== row.kind ||
        content.slot !== row.slot ||
        content.text !== row.valueText ||
        content.subjectLabel !== row.subjectLabel;
      if (contentChanged) {
        if (await findActiveDuplicate(tx, userId, content, id)) {
          throw new ApiError('CONFLICT', 'You already have this memory.');
        }
        if (d.subject === 'self' && isSingleValuedSlot(d.slot)) {
          const holder = await lockActiveSingleSlot(tx, userId, d.slot, id);
          if (holder) {
            throw new ApiError(
              'CONFLICT',
              'You already have a memory for this. Edit that one instead.',
              {
                nextOptions: [`EDIT_MEMORY:${holder.id}`],
              },
            );
          }
        }
        // Prior value kept for the revision window (undo/correction history, §11).
        await tx.memoryItemRevision.create({
          data: {
            userId,
            itemId: id,
            itemVersion: row.version,
            kind: row.kind,
            slot: row.slot,
            valueText: row.valueText,
            changedBy: 'user_edit',
            expiresAt: new Date(Date.now() + this.env.MEMORY_REVISION_RETENTION_DAYS * DAY_MS),
          },
        });
      }
      const pinned = patch.pinned ?? row.pinned;
      let expiresAt = row.expiresAt;
      if (patch.valid_until !== undefined || kind !== row.kind) {
        expiresAt = this.expiryFor(kind, pinned, patch.valid_until);
      } else if (kind === 'event' && pinned !== row.pinned) {
        // Pinned events never expire; unpinning restarts the provisional event TTL (§11).
        expiresAt = this.expiryFor(kind, pinned, undefined);
      }
      await updateItemContent(tx, userId, id, {
        ...content,
        expiresAt,
        pinned,
        editedAt: contentChanged ? new Date() : row.editedAt,
      });
      await this.audited(tx, userId, 'memory.item.updated', id, {
        content_changed: contentChanged,
        pinned,
      });
      return this.loadItem(tx, userId, id);
    });
  }

  /** Hard delete (cascades revisions, access events, conflict suggestions). Never needs consent. */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      const { count } = await tx.memoryItem.deleteMany({ where: { id, userId } });
      if (count !== 1) throw memoryNotFound();
      await this.audited(tx, userId, 'memory.item.deleted', id);
    });
  }

  /**
   * Undo (arch §3.6, L-05). `If-Match` carries the version the chip was shown (activity):
   *  - a supersession chip (version n ≥ 1) whose item is still at n and whose `explicit_supersede`
   *    revision (n − 1) is unexpired → previous value restored; needs eligible consent (it writes
   *    content back);
   *  - a new-save chip (version 0) whose content was never changed since (no revision, never
   *    edited) → the memory is deleted. Suspension and pinning bump `version` without changing
   *    content, so they do not block this; it is a deletion, so no consent is needed (T-RACE-17);
   *  - anything else (changed since, revision expired) → 409; the app offers delete instead.
   */
  async undo(userId: string, id: string, chipVersion: number): Promise<UndoMemoryResponse> {
    this.requireFeature();
    return this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      if (!(await lockItem(tx, userId, id))) throw memoryNotFound();
      const row = await tx.memoryItem.findFirstOrThrow({ where: { id, userId } });
      const cannotUndo = () =>
        new ApiError('CONFLICT', 'This can no longer be undone. Delete it instead.', {
          nextOptions: ['DELETE_MEMORY'],
        });
      if (chipVersion === 0) {
        const revisions = await tx.memoryItemRevision.count({ where: { userId, itemId: id } });
        if (revisions > 0 || row.editedAt !== null) throw cannotUndo();
        await tx.memoryItem.deleteMany({ where: { id, userId } });
        await this.audited(tx, userId, 'memory.item.deleted', id, { cause: 'undo_new' });
        return { outcome: 'deleted', item: null };
      }
      if (row.version !== chipVersion) throw cannotUndo();
      const superseded = await tx.memoryItemRevision.findFirst({
        where: {
          userId,
          itemId: id,
          itemVersion: chipVersion - 1,
          changedBy: 'explicit_supersede',
          expiresAt: { gt: new Date() },
        },
      });
      if (!superseded) throw cannotUndo();
      await this.consent.requireEligibleInTx(tx, userId);
      if (row.status !== 'active') {
        throw new ApiError('CONFLICT', 'Restore this memory before changing it.');
      }
      const prior: ItemContent = {
        kind: superseded.kind as MemoryKind,
        slot: superseded.slot,
        subject: row.subject as ItemContent['subject'],
        subjectLabel: row.subjectLabel,
        text: superseded.valueText,
      };
      if (await findActiveDuplicate(tx, userId, prior, id)) {
        throw new ApiError(
          'CONFLICT',
          'The earlier value is already saved. Delete this one instead.',
        );
      }
      await updateItemContent(tx, userId, id, {
        ...prior,
        expiresAt: row.expiresAt,
        pinned: row.pinned,
        editedAt: row.editedAt,
      });
      await tx.memoryItemRevision.deleteMany({ where: { id: superseded.id, userId } });
      await this.audited(tx, userId, 'memory.item.updated', id, { cause: 'undo_supersede' });
      return { outcome: 'reverted', item: await this.loadItem(tx, userId, id) };
    });
  }

  async updateSettings(
    userId: string,
    expectedVersion: number,
    askBeforeSaving: boolean,
  ): Promise<MemorySettings> {
    this.requireFeature();
    return this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      const current = await tx.memoryUserSettings.findUnique({ where: { userId } });
      if ((current?.version ?? 0) !== expectedVersion) {
        throw new ApiError('PRECONDITION_FAILED', 'Your settings changed elsewhere. Reload them.');
      }
      const row = current
        ? await tx.memoryUserSettings.update({
            where: { userId },
            data: { askBeforeSaving, version: { increment: 1 }, updatedAt: new Date() },
          })
        : await tx.memoryUserSettings.create({
            data: { userId, askBeforeSaving, version: 1 },
          });
      await this.audited(tx, userId, 'memory.settings.changed', undefined, {
        ask_before_saving: askBeforeSaving,
      });
      return { ask_before_saving: row.askBeforeSaving, version: row.version };
    });
  }

  // ── Suggestions ─────────────────────────────────────────────────────────────────────────

  async dismissSuggestion(userId: string, id: string): Promise<void> {
    await this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      const { count } = await tx.memorySuggestion.deleteMany({ where: { id, userId } });
      if (count !== 1) throw new ApiError('NOT_FOUND', 'Suggestion not found.');
      await this.audited(tx, userId, 'memory.suggestion.dismissed', id);
    });
  }

  /**
   * Confirm a suggestion (re-validated; optional user correction → `edited`). For a single-valued
   * slot that already holds a value, confirming means "replace it": the old value becomes a
   * revision of the same item.
   */
  async confirmSuggestion(
    userId: string,
    id: string,
    body: ConfirmSuggestionRequest,
  ): Promise<MemoryItem> {
    this.requireFeature();
    return this.prisma.withUserScope(userId, async (tx) => {
      await lockUserForMemory(tx, userId);
      if (!(await lockSuggestion(tx, userId, id))) {
        throw new ApiError('NOT_FOUND', 'Suggestion not found.');
      }
      await this.consent.requireEligibleInTx(tx, userId);
      const s = await tx.memorySuggestion.findFirstOrThrow({ where: { id, userId } });
      const edited = body.text !== undefined && body.text !== s.valueText;
      const d = validateUserAuthoredMemory({
        kind: s.kind,
        slot: s.slot,
        subject: s.subject,
        subjectLabel: s.subjectLabel,
        text: body.text ?? s.valueText,
      });
      if (!d.accepted) throw rejected(d);
      const content: ItemContent = {
        kind: d.kind,
        slot: d.slot,
        subject: d.subject,
        subjectLabel: d.subjectLabel,
        text: d.text,
      };
      const now = new Date();
      const expiresAt =
        d.kind === 'context' || d.kind === 'event'
          ? s.validUntil && s.validUntil > now
            ? s.validUntil
            : this.expiryFor(d.kind, false, undefined, now)
          : null;
      let itemId = await findActiveDuplicate(tx, userId, content);
      if (!itemId) {
        const holder = d.subject === 'self' ? await lockActiveSingleSlot(tx, userId, d.slot) : null;
        if (holder) {
          const old = await tx.memoryItem.findFirstOrThrow({ where: { id: holder.id, userId } });
          await tx.memoryItemRevision.create({
            data: {
              userId,
              itemId: holder.id,
              itemVersion: old.version,
              kind: old.kind,
              slot: old.slot,
              valueText: old.valueText,
              changedBy: 'user_edit',
              expiresAt: new Date(now.getTime() + this.env.MEMORY_REVISION_RETENTION_DAYS * DAY_MS),
            },
          });
          await updateItemContent(tx, userId, holder.id, {
            ...content,
            expiresAt,
            pinned: old.pinned,
            editedAt: now,
          });
          itemId = holder.id;
        } else {
          if ((await countActiveItems(tx, userId)) >= this.env.MEMORY_MAX_ACTIVE_ITEMS) {
            throw new ApiError(
              'CONFLICT',
              'You’ve reached the memory limit. Delete some memories first.',
            );
          }
          itemId = await insertItem(tx, {
            userId,
            ...content,
            origin: 'confirmed_suggestion',
            pinned: false,
            sourceMessageId: s.sourceMessageId,
            sourceThreadId: s.sourceThreadId,
            sourceExcerpt: s.sourceExcerpt,
            sourceRecordedAt: s.sourceRecordedAt,
            expiresAt,
            editedAt: edited ? now : null,
          });
          itemId ??= await findActiveDuplicate(tx, userId, content);
          if (!itemId)
            throw new ApiError('CONFLICT', 'This memory changed while saving. Try again.');
        }
      }
      await tx.memorySuggestion.deleteMany({ where: { id, userId } });
      await this.audited(tx, userId, 'memory.suggestion.confirmed', itemId, { edited });
      return this.loadItem(tx, userId, itemId);
    });
  }

  // ── Restore (§3.3): explicit, consent-gated, never automatic ─────────────────────────────

  async restore(
    userId: string,
    ids: string[] | undefined,
    idempotencyKey: string,
  ): Promise<RestoreMemoryResponse> {
    this.requireFeature();
    const scope = 'memory.restore';
    const fingerprint = requestFingerprint(scope, { ids: ids ? [...ids].sort() : null });
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
        if (!claim.fresh) return claim.result as unknown as RestoreMemoryResponse;
        await this.consent.requireEligibleInTx(tx, userId);
        const candidates = await lockSuspendedItems(tx, userId, ids ?? null);
        const out: RestoreMemoryResponse = {
          restored: 0,
          duplicates_removed: 0,
          moved_to_suggestions: 0,
          skipped: (ids?.length ?? candidates.length) - candidates.length,
        };
        let active = await countActiveItems(tx, userId);
        let pending = await countPendingSuggestions(tx, userId);
        for (const c of candidates) {
          if (c.expired) {
            out.skipped += 1;
            continue;
          }
          const row = await tx.memoryItem.findFirstOrThrow({ where: { id: c.id, userId } });
          const content: ItemContent = {
            kind: row.kind as MemoryKind,
            slot: row.slot,
            subject: row.subject as ItemContent['subject'],
            subjectLabel: row.subjectLabel,
            text: row.valueText,
          };
          if (await findActiveDuplicate(tx, userId, content)) {
            await tx.memoryItem.deleteMany({ where: { id: row.id, userId } });
            out.duplicates_removed += 1;
            continue;
          }
          const holder =
            row.subject === 'self' && row.singleValued
              ? await lockActiveSingleSlot(tx, userId, row.slot)
              : null;
          if (holder) {
            if (pending >= this.env.MEMORY_MAX_PENDING_SUGGESTIONS) {
              out.skipped += 1;
              continue;
            }
            const sid = await insertSuggestion(tx, {
              userId,
              ...content,
              reason: 'restore_conflict',
              conflictsWithItemId: holder.id,
              sourceMessageId: row.sourceMessageId,
              sourceThreadId: row.sourceThreadId,
              sourceExcerpt: row.sourceExcerpt,
              sourceRecordedAt: row.sourceRecordedAt,
              validUntil: row.expiresAt,
              expiresAt: new Date(Date.now() + this.env.MEMORY_SUGGESTION_TTL_DAYS * DAY_MS),
            });
            await tx.memoryItem.deleteMany({ where: { id: row.id, userId } });
            if (sid) pending += 1;
            out.moved_to_suggestions += 1;
            continue;
          }
          if (active >= this.env.MEMORY_MAX_ACTIVE_ITEMS) {
            out.skipped += 1;
            continue;
          }
          await tx.memoryItem.updateMany({
            where: { id: row.id, userId, status: 'suspended' },
            data: {
              status: 'active',
              suspendedAt: null,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          active += 1;
          out.restored += 1;
        }
        await this.audited(tx, userId, 'memory.restored', undefined, {
          restored: out.restored,
          duplicates_removed: out.duplicates_removed,
          moved_to_suggestions: out.moved_to_suggestions,
          skipped: out.skipped,
        });
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

  /** Used by the suggestion list's companion endpoints and tests. */
  async getSuggestion(userId: string, id: string): Promise<MemorySuggestion> {
    const row = await this.prisma.withUserScope(userId, (tx) =>
      tx.memorySuggestion.findFirst({ where: { id, userId, expiresAt: { gt: new Date() } } }),
    );
    if (!row) throw new ApiError('NOT_FOUND', 'Suggestion not found.');
    return toMemorySuggestion(row);
  }
}
