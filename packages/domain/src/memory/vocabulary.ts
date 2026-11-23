/**
 * Phase 03 personal memory — closed vocabularies (ADR-0036; arch §2.4, §3.5, §4.2, §4.3).
 * Pure data. The wire contract (`@karen/ai-model-contracts`), public DTOs (`@karen/api-contracts`)
 * and the database CHECKs (M2a) are built from these lists, never re-typed.
 */

export const MEMORY_KINDS = ['fact', 'preference', 'context', 'event'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SUBJECTS = ['self', 'third_party'] as const;
export type MemorySubject = (typeof MEMORY_SUBJECTS)[number];

/** Stored item lifecycle (arch §4.2). Deletion is a hard delete, so there is no 'deleted'. */
export const MEMORY_ITEM_STATUSES = ['active', 'suspended'] as const;
export type MemoryItemStatus = (typeof MEMORY_ITEM_STATUSES)[number];

/** How an item came to exist (arch §4.3 `items_origin`; restore keeps the original origin). */
export const MEMORY_ORIGINS = ['explicit_request', 'confirmed_suggestion', 'user_created'] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

/** Why a suggestion exists (arch §4.3 `suggestions.reason`, §4.6, §3.3). */
export const MEMORY_SUGGESTION_REASONS = [
  'stated',
  'third_party',
  'conflict',
  'ask_before_saving',
  'restore_conflict',
] as const;

/** Why an item was retrieved (arch §4.3 `access_events.reason`, §6.4). */
export const MEMORY_ACCESS_REASONS = ['pinned', 'always', 'lexical', 'recent'] as const;

/** Who changed a revision's value (arch §4.3 `item_revisions.changed_by`). */
export const MEMORY_REVISION_CAUSES = ['user_edit', 'explicit_supersede'] as const;
export type MemorySuggestionReason = (typeof MEMORY_SUGGESTION_REASONS)[number];

/**
 * WIRE statuses sent to the ai-service (arch §2.4). 'off_feature' is deliberately absent: with the
 * feature flag off, the API omits the memory fields entirely (Phase 02 behaviour).
 */
export const MEMORY_WIRE_STATUSES = [
  'on',
  'off_thread',
  'off_ephemeral',
  'off_consent',
  'unavailable',
] as const;
export type MemoryWireStatus = (typeof MEMORY_WIRE_STATUSES)[number];

/** Public DTO status (`@karen/api-contracts`, arch §3.5): the wire set plus 'off_feature' (L-01). */
export const MEMORY_DTO_STATUSES = ['off_feature', ...MEMORY_WIRE_STATUSES] as const;
export type MemoryDtoStatus = (typeof MEMORY_DTO_STATUSES)[number];

/** Most restrictive rejection class recorded on a job (content-free; arch §4.7). */
export const MEMORY_REJECTION_CLASSES = ['secret', 'sensitive', 'minor', 'invalid'] as const;
export type MemoryRejectionClass = (typeof MEMORY_REJECTION_CLASSES)[number];

/** Advisory model sensitivity label (escalate-only, V8). */
export const MEMORY_MODEL_SENSITIVITY = ['none', 'secret', 'sensitive', 'minor'] as const;
export type MemoryModelSensitivity = (typeof MEMORY_MODEL_SENSITIVITY)[number];

/** Extraction job lifecycle (arch §4.3 `extraction_jobs_status`). */
export const MEMORY_JOB_STATUSES = [
  'pending',
  'running',
  'completed',
  'skipped',
  'failed',
  'canceled',
] as const;
export type MemoryJobStatus = (typeof MEMORY_JOB_STATUSES)[number];
export const MEMORY_JOB_TERMINAL_STATUSES: readonly MemoryJobStatus[] = [
  'completed',
  'skipped',
  'failed',
  'canceled',
];

/** Content-free job outcome codes (arch §8, §12; activity chips). */
export const MEMORY_JOB_OUTCOMES = [
  'stored',
  'suggested',
  'duplicate',
  'nothing_found',
  'rejected',
  'cap_reached',
  'too_long',
  'budget',
  'consent_revoked',
  'thread_off',
  'source_gone',
  'cleared',
  'abandoned_stale',
  'gateway_error',
] as const;
export type MemoryJobOutcome = (typeof MEMORY_JOB_OUTCOMES)[number];

export type SlotCardinality = 'single' | 'multi';

export interface MemorySlotDefinition {
  readonly slot: string;
  readonly cardinality: SlotCardinality;
  /** Kinds this slot may carry; V9 coerces a mismatch to slot 'other'. */
  readonly kinds: readonly MemoryKind[];
}

/**
 * Closed slot vocabulary (arch §4.2). Health-adjacent slots (allergies, medication, conditions)
 * are deliberately absent in Phase 03 (D9). Unknown slots coerce to 'other' (V9).
 * Adding a slot is a policy change: bump MEMORY_POLICY_VERSION.
 */
export const MEMORY_SLOTS = [
  { slot: 'home_city', cardinality: 'single', kinds: ['fact'] },
  { slot: 'diet', cardinality: 'single', kinds: ['preference', 'fact'] },
  { slot: 'preferred_language', cardinality: 'single', kinds: ['preference'] },
  { slot: 'seat_preference', cardinality: 'single', kinds: ['preference'] },
  { slot: 'airline_preference', cardinality: 'multi', kinds: ['preference'] },
  { slot: 'cuisine_like', cardinality: 'multi', kinds: ['preference'] },
  { slot: 'cuisine_dislike', cardinality: 'multi', kinds: ['preference'] },
  { slot: 'drink_preference', cardinality: 'multi', kinds: ['preference'] },
  { slot: 'music_like', cardinality: 'multi', kinds: ['preference'] },
  { slot: 'hobby', cardinality: 'multi', kinds: ['preference', 'fact'] },
  { slot: 'wake_time', cardinality: 'single', kinds: ['fact', 'preference'] },
  { slot: 'occupation', cardinality: 'single', kinds: ['fact'] },
  { slot: 'pet', cardinality: 'multi', kinds: ['fact'] },
  { slot: 'vehicle', cardinality: 'multi', kinds: ['fact'] },
  { slot: 'name_pronunciation', cardinality: 'single', kinds: ['fact'] },
  { slot: 'reply_style', cardinality: 'single', kinds: ['preference'] },
  { slot: 'current_trip', cardinality: 'single', kinds: ['context'] },
  { slot: 'family_event', cardinality: 'multi', kinds: ['event'] },
  { slot: 'contact_fact', cardinality: 'multi', kinds: ['fact', 'preference', 'event'] },
  { slot: 'other', cardinality: 'multi', kinds: ['fact', 'preference', 'context', 'event'] },
] as const satisfies readonly MemorySlotDefinition[];

export type MemorySlot = (typeof MEMORY_SLOTS)[number]['slot'];

const SLOT_INDEX: ReadonlyMap<string, MemorySlotDefinition> = new Map(
  MEMORY_SLOTS.map((s) => [s.slot, s]),
);

export function memorySlotDefinition(slot: string): MemorySlotDefinition | undefined {
  return SLOT_INDEX.get(slot);
}

export function isSingleValuedSlot(slot: string): boolean {
  return SLOT_INDEX.get(slot)?.cardinality === 'single';
}

/** V9: unknown slot or a kind the slot does not allow → 'other' (always allowed). */
export function coerceSlot(slot: string, kind: MemoryKind): MemorySlot {
  const def = SLOT_INDEX.get(slot);
  if (def && def.kinds.includes(kind)) return def.slot as MemorySlot;
  return 'other';
}

/** Kinds that carry an expiry (arch §4.2, §11). */
export function kindExpires(kind: MemoryKind): boolean {
  return kind === 'context' || kind === 'event';
}
