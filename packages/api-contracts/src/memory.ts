import {
  MEMORY_ACCESS_REASONS,
  MEMORY_DTO_STATUSES,
  MEMORY_ITEM_STATUSES,
  MEMORY_JOB_STATUSES,
  MEMORY_KINDS,
  MEMORY_ORIGINS,
  MEMORY_REJECTION_CLASSES,
  MEMORY_REVISION_CAUSES,
  MEMORY_SUBJECTS,
  MEMORY_SUGGESTION_REASONS,
  MEMORY_TEXT_MAX_CHARS,
} from '@karen/domain/memory';
import { z } from 'zod';

/**
 * Phase 03 — personal memory (ADR-0036; docs/phase-03/PHASE_03_MEMORY_ARCHITECTURE.md §3.7).
 *
 * Every route acts only on the caller's own memories (user from the verified token). Viewing,
 * exporting, deleting and clearing never need consent; anything that stores or changes memory
 * content needs an eligible `MEMORY_STORAGE` consent. No response carries a purge date or a
 * retention duration (H6: not legally approved) — only statuses.
 */

export const memoryKindSchema = z.enum(MEMORY_KINDS);
export const memorySubjectSchema = z.enum(MEMORY_SUBJECTS);
export const memoryItemStatusSchema = z.enum(MEMORY_ITEM_STATUSES);
export const memoryOriginSchema = z.enum(MEMORY_ORIGINS);
/** Public (DTO) memory status of a conversation; includes `off_feature` (L-01). */
export const memoryStatusSchema = z.enum(MEMORY_DTO_STATUSES);
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

const slotSchema = z.string().regex(/^[a-z][a-z0-9_]{1,47}$/, 'Unknown category');
/** Character policy and harmful-content rules are enforced by the server (one definition). */
const memoryTextInput = z
  .string()
  .min(1)
  .max(MEMORY_TEXT_MAX_CHARS, `At most ${MEMORY_TEXT_MAX_CHARS} characters`);
const labelInput = z.string().trim().min(1).max(40);
const isoDate = z.iso.date();

export const memoryProvenanceSchema = z
  .object({
    /** Null when the conversation was deleted (the memory is kept, D10 / Q12). */
    source_conversation_id: z.uuid().nullable(),
    source_message_id: z.uuid().nullable(),
    /** The user's own words the memory came from. */
    source_excerpt: z.string().nullable(),
    /** When the user said it (or created it). */
    said_at: z.iso.datetime(),
    confirmed_at: z.iso.datetime(),
    edited_at: z.iso.datetime().nullable(),
  })
  .strict();

export const memoryItemSchema = z
  .object({
    id: z.uuid(),
    kind: memoryKindSchema,
    slot: z.string(),
    subject: memorySubjectSchema,
    /** Third-party memories only ("about: sister"). */
    subject_label: z.string().nullable(),
    text: z.string(),
    /** `suspended`: memory permission was turned off; kept (not used) until restored/deleted. */
    status: memoryItemStatusSchema,
    pinned: z.boolean(),
    origin: memoryOriginSchema,
    provenance: memoryProvenanceSchema,
    /** Context/event memories stop being used after this time; null = no expiry. */
    expires_at: z.iso.datetime().nullable(),
    last_used_at: z.iso.datetime().nullable(),
    /** Earlier values kept for undo/correction history. */
    revision_count: z.number().int().min(0),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    /** For `If-Match`. */
    version: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'MemoryItem' });
export type MemoryItem = z.infer<typeof memoryItemSchema>;

export const memoryItemListSchema = z
  .object({ items: z.array(memoryItemSchema), next_cursor: z.string().nullable() })
  .strict()
  .meta({ id: 'MemoryItemList' });
export type MemoryItemList = z.infer<typeof memoryItemListSchema>;

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const memoryListQuerySchema = z
  .object({
    cursor: z.string().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    kind: memoryKindSchema.optional(),
    status: z.enum(['active', 'suspended', 'all']).default('all'),
    pinned: booleanQuery.optional(),
    /** Search your own memories (same tokeniser as retrieval: English, Hindi, Hinglish). */
    q: z.string().trim().min(1).max(100).optional(),
    /** Memories saved from one conversation. */
    conversation_id: z.uuid().optional(),
  })
  .strict();
export type MemoryListQuery = z.infer<typeof memoryListQuerySchema>;

export const createMemoryRequestSchema = z
  .object({
    kind: memoryKindSchema,
    /** Category from the closed vocabulary; unknown values become `other`. */
    slot: slotSchema.default('other'),
    subject: memorySubjectSchema.default('self'),
    subject_label: labelInput.optional(),
    text: memoryTextInput,
    pinned: z.boolean().default(false),
    /** Context/event only: last day it applies (defaults server-side). */
    valid_until: isoDate.optional(),
  })
  .strict()
  .meta({ id: 'CreateMemoryRequest' });
export type CreateMemoryRequest = z.input<typeof createMemoryRequestSchema>;

export const updateMemoryRequestSchema = z
  .object({
    text: memoryTextInput.optional(),
    kind: memoryKindSchema.optional(),
    slot: slotSchema.optional(),
    subject_label: labelInput.optional(),
    pinned: z.boolean().optional(),
    /** Context/event only. */
    valid_until: isoDate.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field')
  .meta({ id: 'UpdateMemoryRequest' });
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>;

export const undoMemoryResponseSchema = z
  .object({
    /** `deleted`: a newly saved memory was removed. `reverted`: the previous value is back. */
    outcome: z.enum(['deleted', 'reverted']),
    item: memoryItemSchema.nullable(),
  })
  .strict()
  .meta({ id: 'UndoMemoryResponse' });
export type UndoMemoryResponse = z.infer<typeof undoMemoryResponseSchema>;

export const clearMemoryRequestSchema = z
  .discriminatedUnion('scope', [
    z.object({ scope: z.literal('all') }).strict(),
    z.object({ scope: z.literal('kind'), kind: memoryKindSchema }).strict(),
    z.object({ scope: z.literal('conversation'), conversation_id: z.uuid() }).strict(),
  ])
  .meta({ id: 'ClearMemoryRequest' });
export type ClearMemoryRequest = z.infer<typeof clearMemoryRequestSchema>;

export const clearMemoryResponseSchema = z
  .object({
    items_deleted: z.number().int().min(0),
    suggestions_deleted: z.number().int().min(0),
    /** Pending saves from the cleared scope that will no longer happen (`kind` scope: always 0). */
    pending_saves_canceled: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'ClearMemoryResponse' });
export type ClearMemoryResponse = z.infer<typeof clearMemoryResponseSchema>;

export const restoreMemoryRequestSchema = z
  .object({
    /** Omit to restore every suspended memory. */
    ids: z.array(z.uuid()).min(1).max(500).optional(),
  })
  .strict()
  .meta({ id: 'RestoreMemoryRequest' });
export type RestoreMemoryRequest = z.infer<typeof restoreMemoryRequestSchema>;

export const restoreMemoryResponseSchema = z
  .object({
    restored: z.number().int().min(0),
    /** Already saved again in the meantime: the suspended copy was removed. */
    duplicates_removed: z.number().int().min(0),
    /** Conflicts with a newer value: moved to Suggestions for you to decide. */
    moved_to_suggestions: z.number().int().min(0),
    /** Not restored (expired, limit reached, or not found). */
    skipped: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'RestoreMemoryResponse' });
export type RestoreMemoryResponse = z.infer<typeof restoreMemoryResponseSchema>;

export const memorySuggestionSchema = z
  .object({
    id: z.uuid(),
    kind: memoryKindSchema,
    slot: z.string(),
    subject: memorySubjectSchema,
    subject_label: z.string().nullable(),
    text: z.string(),
    reason: z.enum(MEMORY_SUGGESTION_REASONS),
    /** For `conflict` / `restore_conflict`: the saved memory it would replace. */
    conflicts_with_item_id: z.uuid().nullable(),
    source_conversation_id: z.uuid().nullable(),
    source_message_id: z.uuid().nullable(),
    source_excerpt: z.string().nullable(),
    said_at: z.iso.datetime(),
    valid_until: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'MemorySuggestion' });
export type MemorySuggestion = z.infer<typeof memorySuggestionSchema>;

export const memorySuggestionListSchema = z
  .object({ items: z.array(memorySuggestionSchema), next_cursor: z.string().nullable() })
  .strict()
  .meta({ id: 'MemorySuggestionList' });
export type MemorySuggestionList = z.infer<typeof memorySuggestionListSchema>;

export const memorySuggestionListQuerySchema = z
  .object({
    cursor: z.string().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const confirmSuggestionRequestSchema = z
  .object({
    /** Optional correction; the memory is then marked as edited by you. */
    text: memoryTextInput.optional(),
  })
  .strict()
  .meta({ id: 'ConfirmSuggestionRequest' });
export type ConfirmSuggestionRequest = z.infer<typeof confirmSuggestionRequestSchema>;

export const memorySettingsSchema = z
  .object({
    /** When on, even explicit "remember …" requests become suggestions you confirm. */
    ask_before_saving: z.boolean(),
    version: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'MemorySettings' });
export type MemorySettings = z.infer<typeof memorySettingsSchema>;

export const updateMemorySettingsRequestSchema = z
  .object({ ask_before_saving: z.boolean() })
  .strict()
  .meta({ id: 'UpdateMemorySettingsRequest' });

export const MEMORY_CONSENT_STATES = ['eligible', 'not_granted', 'reconfirm_required'] as const;

export const memoryStatusResponseSchema = z
  .object({
    /** False: memory is not available in this environment; nothing is stored or used. */
    feature_enabled: z.boolean(),
    /**
     * `reconfirm_required`: permission was given for an earlier notice; it must be confirmed
     * again before memory is used (D5).
     */
    consent: z.enum(MEMORY_CONSENT_STATES),
    ask_before_saving: z.boolean(),
    counts: z
      .object({
        active: z.number().int().min(0),
        suspended: z.number().int().min(0),
        pending_suggestions: z.number().int().min(0),
      })
      .strict(),
    limits: z
      .object({
        max_active_items: z.number().int().positive(),
        max_pending_suggestions: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'MemoryStatusResponse' });
export type MemoryStatusResponse = z.infer<typeof memoryStatusResponseSchema>;

export const memoryActivityQuerySchema = z
  .object({
    conversation_id: z.uuid(),
    /** Only outcomes that changed after this instant. */
    since: z.iso.datetime().optional(),
  })
  .strict();

export const memoryActivityEntrySchema = z
  .object({
    job_id: z.uuid(),
    source_message_id: z.uuid(),
    status: z.enum(MEMORY_JOB_STATUSES),
    outcome_code: z.string().nullable(),
    stored_count: z.number().int().min(0),
    suggested_count: z.number().int().min(0),
    rejected_count: z.number().int().min(0),
    /** Most restrictive refusal class, for the refusal chip copy; never any content. */
    rejected_class: z.enum(MEMORY_REJECTION_CLASSES).nullable(),
    /** Memories saved from that message (fetch them by id; version is for Undo's If-Match). */
    items: z.array(z.object({ id: z.uuid(), version: z.number().int().min(0) }).strict()),
    suggestion_ids: z.array(z.uuid()),
    updated_at: z.iso.datetime(),
  })
  .strict();

export const memoryActivitySchema = z
  .object({ items: z.array(memoryActivityEntrySchema) })
  .strict()
  .meta({ id: 'MemoryActivity' });
export type MemoryActivity = z.infer<typeof memoryActivitySchema>;

const exportItemSchema = z
  .object({
    id: z.uuid(),
    kind: memoryKindSchema,
    slot: z.string(),
    subject: memorySubjectSchema,
    subject_label: z.string().nullable(),
    text: z.string(),
    status: memoryItemStatusSchema,
    pinned: z.boolean(),
    origin: memoryOriginSchema,
    provenance: memoryProvenanceSchema,
    expires_at: z.iso.datetime().nullable(),
    last_used_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    version: z.number().int().min(0),
    revisions: z.array(
      z
        .object({
          version: z.number().int().min(0),
          kind: memoryKindSchema,
          slot: z.string(),
          text: z.string(),
          changed_by: z.enum(MEMORY_REVISION_CAUSES),
          at: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict();

/** The `memory` section of the account export and of `GET /v1/memory/export` (arch §10.2). */
export const memoryExportSchema = z
  .object({
    settings: z.object({ ask_before_saving: z.boolean() }).strict(),
    items: z.array(exportItemSchema),
    suggestions: z.array(memorySuggestionSchema),
    extraction_jobs: z.array(
      z
        .object({
          id: z.uuid(),
          source_message_id: z.uuid(),
          status: z.enum(MEMORY_JOB_STATUSES),
          outcome_code: z.string().nullable(),
          created_at: z.iso.datetime(),
        })
        .strict(),
    ),
    access_events: z.array(
      z
        .object({
          item_id: z.uuid(),
          reply_message_id: z.uuid(),
          reason: z.enum(MEMORY_ACCESS_REASONS),
          at: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict()
  .meta({ id: 'MemoryExport' });
export type MemoryExport = z.infer<typeof memoryExportSchema>;
