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

// ── Retrieval (M4b; arch §6.2–§6.4) ─────────────────────────────────────────────────────────

export interface RetrievalRow {
  id: string;
  kind: MemoryKind;
  slot: string;
  subject: 'self' | 'third_party';
  subject_label: string | null;
  value_text: string;
  value_key: string;
  pinned: boolean;
  lexemes: string[];
  reasons: ('lexical' | 'pinned' | 'always' | 'recent')[];
  confirmed_at: Date;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
}

export interface RetrievalBounds {
  lexicalMax: number;
  pinnedMax: number;
  preferenceMax: number;
  recentMax: number;
  recentWindowDays: number;
}

/**
 * Bounded per-reason candidate selection in ONE statement (H2): every branch repeats the owner +
 * lifecycle filter, so ranking and limits only ever see rows that already passed it (§6.2).
 * Lexical matching uses the stored app-side lexemes (F2) with quoted lexemes cast straight to
 * tsquery (no parser, no locale). SQL does no ranking — the TypeScript scorer does.
 */
export async function selectRetrievalCandidates(
  tx: TransactionClient,
  userId: string,
  tokens: readonly string[],
  b: RetrievalBounds,
): Promise<RetrievalRow[]> {
  const toks = [...tokens];
  return tx.$queryRaw<RetrievalRow[]>`
    WITH base AS (
      SELECT i.id, i.kind, i.pinned, i.updated_at, i.search_lexemes FROM memory.items i
       WHERE i.user_id = ${userId}::uuid AND i.status = 'active'
         AND (i.expires_at IS NULL OR i.expires_at > now())
    ), q AS (
      SELECT CASE WHEN cardinality(${toks}::text[]) = 0 THEN NULL
             ELSE (SELECT string_agg(quote_literal(t), ' | ')::tsquery FROM unnest(${toks}::text[]) t)
             END AS query
    ), picked AS (
      (SELECT b.id, 'lexical'::text AS reason FROM base b, q
        WHERE q.query IS NOT NULL AND b.search_lexemes @@ q.query
        ORDER BY b.updated_at DESC, b.id LIMIT ${b.lexicalMax})
      UNION ALL
      (SELECT b.id, 'pinned' FROM base b WHERE b.pinned
        ORDER BY b.updated_at DESC, b.id LIMIT ${b.pinnedMax})
      UNION ALL
      (SELECT b.id, 'always' FROM base b WHERE b.kind = 'preference'
        ORDER BY b.updated_at DESC, b.id LIMIT ${b.preferenceMax})
      UNION ALL
      (SELECT b.id, 'recent' FROM base b
        WHERE b.updated_at > now() - make_interval(days => ${b.recentWindowDays}::int)
        ORDER BY b.updated_at DESC, b.id LIMIT ${b.recentMax})
    )
    SELECT i.id, i.kind, i.slot, i.subject, i.subject_label, i.value_text, i.value_key, i.pinned,
           tsvector_to_array(i.search_lexemes) AS lexemes,
           array_agg(DISTINCT p.reason) AS reasons,
           i.confirmed_at, i.created_at, i.updated_at, i.expires_at
      FROM picked p
      JOIN memory.items i ON i.id = p.id
     WHERE i.user_id = ${userId}::uuid AND i.status = 'active'
       AND (i.expires_at IS NULL OR i.expires_at > now())
     GROUP BY i.id`;
}

/**
 * Access events for the items that were SENT for this reply (H3): `INSERT … SELECT` from items
 * that are still active and owned, so anything deleted or suspended while the answer streamed is
 * simply skipped (no FK race can fail the insert). Returns rows written.
 */
export async function insertAccessEvents(
  tx: TransactionClient,
  userId: string,
  replyMessageId: string,
  sent: readonly { itemId: string; rank: number; reason: string }[],
  retentionDays: number,
): Promise<number> {
  if (sent.length === 0) return 0;
  return tx.$executeRaw`
    INSERT INTO memory.access_events (user_id, item_id, reply_message_id, rank, reason, expires_at)
    SELECT i.user_id, i.id, ${replyMessageId}::uuid, s.rank, s.reason,
           now() + make_interval(days => ${retentionDays}::int)
      FROM unnest(${sent.map((s) => s.itemId)}::uuid[], ${sent.map((s) => s.rank)}::int[],
                  ${sent.map((s) => s.reason)}::text[]) AS s(id, rank, reason)
      JOIN memory.items i ON i.id = s.id
     WHERE i.user_id = ${userId}::uuid AND i.status = 'active'`;
}

/**
 * Best-effort post-commit `last_used_at` (§9.4): no `version`/`updated_at` bump (not a content
 * change; must not cause If-Match conflicts or feed the "recent" branch); at most daily.
 */
export async function touchLastUsed(
  tx: TransactionClient,
  userId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  return tx.$executeRaw`
    UPDATE memory.items SET last_used_at = now()
     WHERE user_id = ${userId}::uuid AND id = ANY(${[...ids]}::uuid[]) AND status = 'active'
       AND (last_used_at IS NULL OR last_used_at < now() - interval '1 day')`;
}

// ── Extraction jobs (M5b; arch §8.2, §8.4) ─────────────────────────────────────────────────

/** One job per source message (UNIQUE); returns the new id or null when one already exists. */
export async function insertExtractionJob(
  tx: TransactionClient,
  j: { userId: string; sourceMessageId: string; threadId: string; replyMessageId: string },
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO memory.extraction_jobs (user_id, source_message_id, thread_id, reply_message_id)
    VALUES (${j.userId}::uuid, ${j.sourceMessageId}::uuid, ${j.threadId}::uuid,
            ${j.replyMessageId}::uuid)
    ON CONFLICT (source_message_id) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function countJobsToday(tx: TransactionClient, userId: string): Promise<number> {
  const [r] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM memory.extraction_jobs
     WHERE user_id = ${userId}::uuid AND created_at >= date_trunc('day', now())`;
  return r?.n ?? 0;
}

export interface JobRow {
  id: string;
  user_id: string;
  source_message_id: string;
  thread_id: string;
  status: string;
  outcome_code: string | null;
  attempts: number;
  version: number;
  started_at: Date | null;
}

/** The job row locked FOR UPDATE (owner + RLS). */
export async function lockJob(
  tx: TransactionClient,
  userId: string,
  jobId: string,
): Promise<JobRow | null> {
  const rows = await tx.$queryRaw<JobRow[]>`
    SELECT id, user_id, source_message_id, thread_id, status, outcome_code, attempts, version,
           started_at
      FROM memory.extraction_jobs
     WHERE id = ${jobId}::uuid AND user_id = ${userId}::uuid
     FOR UPDATE`;
  return rows[0] ?? null;
}

/** Compare-and-set terminal update; returns false when the job changed underneath (lost CAS). */
export async function finishJob(
  tx: TransactionClient,
  userId: string,
  jobId: string,
  expectedVersion: number,
  f: {
    status: 'completed' | 'skipped' | 'failed';
    outcome: string;
    stored?: number;
    suggested?: number;
    rejected?: number;
    rejectedClass?: string | null;
  },
): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE memory.extraction_jobs
       SET status = ${f.status}, outcome_code = ${f.outcome}, completed_at = now(),
           expires_at = now() + memory.job_retention(),
           stored_count = ${f.stored ?? 0}, suggested_count = ${f.suggested ?? 0},
           rejected_count = ${f.rejected ?? 0}, rejected_class = ${f.rejectedClass ?? null},
           version = version + 1
     WHERE id = ${jobId}::uuid AND user_id = ${userId}::uuid AND version = ${expectedVersion}
       AND status IN ('pending', 'running')`;
  return n === 1;
}

/**
 * Tier-1 supersession of a single-valued slot (§4.6): the prior value becomes an
 * `explicit_supersede` revision and the item takes the new verbatim words and provenance.
 */
export async function supersedeItem(
  tx: TransactionClient,
  userId: string,
  itemId: string,
  c: ItemContent & {
    sourceMessageId: string;
    sourceThreadId: string;
    sourceExcerpt: string;
    sourceRecordedAt: Date;
    expiresAt: Date | null;
    revisionExpiresAt: Date;
  },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO memory.item_revisions (user_id, item_id, item_version, kind, slot, value_text,
      changed_by, expires_at)
    SELECT user_id, id, version, kind, slot, value_text, 'explicit_supersede', ${c.revisionExpiresAt}
      FROM memory.items WHERE id = ${itemId}::uuid AND user_id = ${userId}::uuid`;
  await tx.$executeRaw`
    UPDATE memory.items
       SET kind = ${c.kind}, slot = ${c.slot}, value_text = ${c.text}, value_key = ${valueKeyOf(c)},
           search_lexemes = array_to_tsvector(${tokenizeForSearch(c.text)}::text[]),
           origin = 'explicit_request', source_message_id = ${c.sourceMessageId}::uuid,
           source_thread_id = ${c.sourceThreadId}::uuid, source_excerpt = ${c.sourceExcerpt},
           source_recorded_at = ${c.sourceRecordedAt}, confirmed_at = now(),
           expires_at = ${c.expiresAt}, version = version + 1, updated_at = now()
     WHERE id = ${itemId}::uuid AND user_id = ${userId}::uuid`;
}
