import { z } from 'zod';
import { passwordInputSchema } from './auth.js';

/** Phase 01 M7 — data export and account deletion requests. */
export const DATA_RIGHTS_STATUSES = [
  'requested',
  'scheduled',
  'processing',
  'ready',
  'completed',
  'cancelled',
  'failed',
  'expired',
] as const;

export const dataRightsRequestSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['export', 'deletion']),
    status: z.enum(DATA_RIGHTS_STATUSES),
    requested_at: z.iso.datetime(),
    /** Deletion: end of the cancellation window. */
    scheduled_for: z.iso.datetime().nullable(),
    completed_at: z.iso.datetime().nullable(),
    cancelled_at: z.iso.datetime().nullable(),
    /** Export: download link stops working at this time. */
    expires_at: z.iso.datetime().nullable(),
    download_available: z.boolean(),
    /** Categories kept after deletion and why (legal/operational retention). */
    retention_exceptions: z.array(z.object({ category: z.string(), reason: z.string() }).strict()),
  })
  .strict()
  .meta({ id: 'DataRightsRequest' });
export type DataRightsRequest = z.infer<typeof dataRightsRequestSchema>;

export const dataRightsListSchema = z
  .object({ items: z.array(dataRightsRequestSchema) })
  .strict()
  .meta({ id: 'DataRightsList' });
export type DataRightsList = z.infer<typeof dataRightsListSchema>;

export const deletionRequestSchema = z
  .object({
    current_password: passwordInputSchema,
    /** Explicit confirmation; the UI shows what will and will not be deleted first. */
    confirm: z.literal(true),
  })
  .strict()
  .meta({ id: 'DeletionRequest' });
