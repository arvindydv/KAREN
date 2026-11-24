import type { MemoryItem, MemorySuggestion } from '@karen/api-contracts';
import type {
  MemoryItem as ItemRow,
  MemorySuggestion as SuggestionRow,
} from '../generated/prisma/client.js';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * DTO mapping. Deliberately omits `suspended_at`, `value_key` and anything a client could use to
 * compute a purge date (H6: no retention date or duration before legal review).
 */
export function toMemoryItem(row: ItemRow, revisionCount: number): MemoryItem {
  return {
    id: row.id,
    kind: row.kind as MemoryItem['kind'],
    slot: row.slot,
    subject: row.subject as MemoryItem['subject'],
    subject_label: row.subjectLabel,
    text: row.valueText,
    status: row.status as MemoryItem['status'],
    pinned: row.pinned,
    origin: row.origin as MemoryItem['origin'],
    provenance: {
      source_conversation_id: row.sourceThreadId,
      source_message_id: row.sourceMessageId,
      source_excerpt: row.sourceExcerpt,
      said_at: row.sourceRecordedAt.toISOString(),
      confirmed_at: row.confirmedAt.toISOString(),
      edited_at: iso(row.editedAt),
    },
    expires_at: iso(row.expiresAt),
    last_used_at: iso(row.lastUsedAt),
    revision_count: revisionCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export function toMemorySuggestion(row: SuggestionRow): MemorySuggestion {
  return {
    id: row.id,
    kind: row.kind as MemorySuggestion['kind'],
    slot: row.slot,
    subject: row.subject as MemorySuggestion['subject'],
    subject_label: row.subjectLabel,
    text: row.valueText,
    reason: row.reason as MemorySuggestion['reason'],
    conflicts_with_item_id: row.conflictsWithItemId,
    source_conversation_id: row.sourceThreadId,
    source_message_id: row.sourceMessageId,
    source_excerpt: row.sourceExcerpt,
    said_at: row.sourceRecordedAt.toISOString(),
    valid_until: iso(row.validUntil),
    created_at: row.createdAt.toISOString(),
  };
}

/** Opaque keyset cursor `(updated_at|created_at, id)`. */
export const encodeCursor = (at: Date, id: string): string =>
  Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');

export function decodeCursor(raw: string): { at: Date; id: string } | null {
  const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at: date, id };
}
