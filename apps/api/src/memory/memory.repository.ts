import { createHash } from 'node:crypto';
import {
  isSingleValuedSlot,
  memoryValueKeyMaterial,
  tokenizeForSearch,
  type MemoryKind,
} from '@karen/domain/memory';
import { Prisma } from '../generated/prisma/client.js';
import type { TransactionClient } from '../infrastructure/database/prisma.service.js';

/**
 * Raw SQL on `memory.*` lives only here (arch §5.4). Every statement carries an explicit
 * `user_id = $user` predicate in addition to RLS (two independent layers), runs on the caller's
 * `withUserScope` transaction, and never catches a unique violation: writes that could collide
 * use `INSERT … ON CONFLICT DO NOTHING` (M-02) and the caller decides from the returned rows.
 */

export interface ItemContent {
  kind: MemoryKind;
  slot: string;
  subject: 'self' | 'third_party';
  subjectLabel: string | null;
  text: string;
}

export const valueKeyOf = (c: ItemContent): string =>
  createHash('sha256')
    .update(
      memoryValueKeyMaterial({
        kind: c.kind,
        slot: c.slot,
        subject: c.subject,
        subjectLabel: c.subjectLabel,
        text: c.text,
      }),
    )
    .digest('hex');

export interface NewItem extends ItemContent {
  userId: string;
  origin: 'explicit_request' | 'confirmed_suggestion' | 'user_created';
  pinned: boolean;
  sourceMessageId: string | null;
  sourceThreadId: string | null;
  sourceExcerpt: string | null;
  sourceRecordedAt: Date;
  expiresAt: Date | null;
  editedAt: Date | null;
}

/** Inserts an active item; returns its id, or null when an identical active item exists. */
export async function insertItem(tx: TransactionClient, i: NewItem): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO memory.items (user_id, kind, slot, single_valued, subject, subject_label, value_text,
      value_key, search_lexemes, origin, pinned, source_message_id, source_thread_id,
      source_excerpt, source_recorded_at, confirmed_at, expires_at, edited_at)
    VALUES (${i.userId}::uuid, ${i.kind}, ${i.slot}, ${isSingleValuedSlot(i.slot)}, ${i.subject},
      ${i.subjectLabel}, ${i.text}, ${valueKeyOf(i)},
      array_to_tsvector(${tokenizeForSearch(i.text)}::text[]), ${i.origin}, ${i.pinned},
      ${i.sourceMessageId}::uuid, ${i.sourceThreadId}::uuid, ${i.sourceExcerpt},
      ${i.sourceRecordedAt}, now(), ${i.expiresAt}, ${i.editedAt})
    ON CONFLICT (user_id, kind, slot, value_key) WHERE status = 'active' DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** Locks one owned, unexpired item. Returns false when it does not exist for this user. */
export async function lockItem(
  tx: TransactionClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM memory.items
     WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
       AND (expires_at IS NULL OR expires_at > now())
     FOR UPDATE`;
  return rows.length === 1;
}

/** The active self value of a single-valued slot, locked (supersede/conflict decision, §4.6). */
export async function lockActiveSingleSlot(
  tx: TransactionClient,
  userId: string,
  slot: string,
  excludeId: string | null = null,
): Promise<{ id: string; pinned: boolean; edited: boolean } | null> {
  if (!isSingleValuedSlot(slot)) return null;
  const rows = await tx.$queryRaw<{ id: string; pinned: boolean; edited: boolean }[]>`
    SELECT id, pinned, edited_at IS NOT NULL AS edited FROM memory.items
     WHERE user_id = ${userId}::uuid AND slot = ${slot} AND status = 'active'
       AND single_valued AND subject = 'self'
       AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
     FOR UPDATE`;
  return rows[0] ?? null;
}

/** An active item with the same dedupe key (other than `excludeId`). */
export async function findActiveDuplicate(
  tx: TransactionClient,
  userId: string,
  c: ItemContent,
  excludeId: string | null = null,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM memory.items
     WHERE user_id = ${userId}::uuid AND kind = ${c.kind} AND slot = ${c.slot}
       AND value_key = ${valueKeyOf(c)} AND status = 'active'
       AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)`;
  return rows[0]?.id ?? null;
}

/** Rewrites an item's content (edit / revert / supersede). Bumps version; caller holds the lock. */
export async function updateItemContent(
  tx: TransactionClient,
  userId: string,
  id: string,
  c: ItemContent & { expiresAt: Date | null; pinned: boolean; editedAt: Date | null },
): Promise<void> {
  await tx.$executeRaw`
    UPDATE memory.items
       SET kind = ${c.kind}, slot = ${c.slot}, single_valued = ${isSingleValuedSlot(c.slot)},
           subject_label = ${c.subjectLabel}, value_text = ${c.text}, value_key = ${valueKeyOf(c)},
           search_lexemes = array_to_tsvector(${tokenizeForSearch(c.text)}::text[]),
           expires_at = ${c.expiresAt}, pinned = ${c.pinned}, edited_at = ${c.editedAt},
           version = version + 1, updated_at = now()
     WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`;
}

export interface ListFilter {
  kind?: string | undefined;
  status: 'active' | 'suspended' | 'all';
  pinned?: boolean | undefined;
  conversationId?: string | undefined;
  q?: string | undefined;
  cursor: { at: Date; id: string } | null;
  limit: number;
}

/**
 * Owner list/search, keyset over (updated_at DESC, id DESC). Search uses the same domain
 * tokeniser as retrieval and requires every query token (AND). Expired rows never appear.
 * Returns ids in order; the caller loads the rows.
 */
export async function listItemIds(
  tx: TransactionClient,
  userId: string,
  f: ListFilter,
): Promise<string[]> {
  const where: Prisma.Sql[] = [
    Prisma.sql`i.user_id = ${userId}::uuid`,
    Prisma.sql`(i.expires_at IS NULL OR i.expires_at > now())`,
  ];
  if (f.status !== 'all') where.push(Prisma.sql`i.status = ${f.status}`);
  if (f.kind) where.push(Prisma.sql`i.kind = ${f.kind}`);
  if (f.pinned !== undefined) where.push(Prisma.sql`i.pinned = ${f.pinned}`);
  if (f.conversationId) where.push(Prisma.sql`i.source_thread_id = ${f.conversationId}::uuid`);
  if (f.q !== undefined) {
    const tokens = tokenizeForSearch(f.q);
    if (tokens.length === 0) return [];
    // Quoted lexemes cast straight to tsquery: no parser/locale processing (arch §6.3 F2).
    where.push(Prisma.sql`i.search_lexemes @@ (
      SELECT string_agg(quote_literal(t), ' & ')::tsquery FROM unnest(${tokens}::text[]) t)`);
  }
  if (f.cursor) {
    where.push(Prisma.sql`(i.updated_at, i.id) < (${f.cursor.at}, ${f.cursor.id}::uuid)`);
  }
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT i.id FROM memory.items i
     WHERE ${Prisma.join(where, ' AND ')}
     ORDER BY i.updated_at DESC, i.id DESC
     LIMIT ${f.limit + 1}`;
  return rows.map((r) => r.id);
}

export interface NewSuggestion extends ItemContent {
  userId: string;
  reason: 'stated' | 'third_party' | 'conflict' | 'ask_before_saving' | 'restore_conflict';
  conflictsWithItemId: string | null;
  sourceMessageId: string | null;
  sourceThreadId: string | null;
  sourceExcerpt: string | null;
  sourceRecordedAt: Date;
  validUntil: Date | null;
  expiresAt: Date;
}

/** Returns the new suggestion id, or null when the same pending suggestion already exists. */
export async function insertSuggestion(
  tx: TransactionClient,
  s: NewSuggestion,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO memory.suggestions (user_id, kind, slot, single_valued, subject, subject_label,
      value_text, value_key, reason, conflicts_with_item_id, source_message_id, source_thread_id,
      source_excerpt, source_recorded_at, valid_until, expires_at)
    VALUES (${s.userId}::uuid, ${s.kind}, ${s.slot}, ${isSingleValuedSlot(s.slot)}, ${s.subject},
      ${s.subjectLabel}, ${s.text}, ${valueKeyOf(s)}, ${s.reason}, ${s.conflictsWithItemId}::uuid,
      ${s.sourceMessageId}::uuid, ${s.sourceThreadId}::uuid, ${s.sourceExcerpt},
      ${s.sourceRecordedAt}, ${s.validUntil}, ${s.expiresAt})
    ON CONFLICT (user_id, kind, slot, value_key) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function countActiveItems(tx: TransactionClient, userId: string): Promise<number> {
  const [r] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM memory.items
     WHERE user_id = ${userId}::uuid AND status = 'active'
       AND (expires_at IS NULL OR expires_at > now())`;
  return r?.n ?? 0;
}

export async function countPendingSuggestions(
  tx: TransactionClient,
  userId: string,
): Promise<number> {
  const [r] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM memory.suggestions
     WHERE user_id = ${userId}::uuid AND expires_at > now()`;
  return r?.n ?? 0;
}

/** Cancels the user's non-terminal extraction jobs (optionally one thread's). Returns the count. */
export async function cancelPendingJobs(
  tx: TransactionClient,
  userId: string,
  threadId: string | null,
  outcome: 'cleared',
): Promise<number> {
  return tx.$executeRaw`
    UPDATE memory.extraction_jobs
       SET status = 'canceled', outcome_code = ${outcome}, completed_at = now(),
           expires_at = now() + memory.job_retention(), version = version + 1
     WHERE user_id = ${userId}::uuid AND status IN ('pending', 'running')
       AND (${threadId}::uuid IS NULL OR thread_id = ${threadId}::uuid)`;
}

/** Locks one owned, unexpired suggestion. */
export async function lockSuggestion(
  tx: TransactionClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM memory.suggestions
     WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND expires_at > now() FOR UPDATE`;
  return rows.length === 1;
}

/** The user's suspended items (optionally only `ids`), locked, oldest suspension first. */
export async function lockSuspendedItems(
  tx: TransactionClient,
  userId: string,
  ids: string[] | null,
): Promise<{ id: string; expired: boolean }[]> {
  return tx.$queryRaw<{ id: string; expired: boolean }[]>`
    SELECT id, (expires_at IS NOT NULL AND expires_at <= now()) AS expired
      FROM memory.items
     WHERE user_id = ${userId}::uuid AND status = 'suspended'
       AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
     ORDER BY suspended_at, id
     FOR UPDATE`;
}
