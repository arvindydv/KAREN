import { z } from 'zod';

/**
 * Phase 01 M6 — notices, purpose-specific consent, receipts, legal acknowledgement.
 * Consent ≠ authentication ≠ authorization: missing consent is `CONSENT_REQUIRED` (403).
 */
export const NOTICE_KINDS = ['privacy_notice', 'terms_of_service', 'ai_disclosure'] as const;
export const noticeKindSchema = z.enum(NOTICE_KINDS);
export type NoticeKind = z.infer<typeof noticeKindSchema>;
export const noticeLocaleSchema = z.enum(['en-IN', 'hi-IN']);

export const CONSENT_PURPOSE_VALUES = [
  'AI_PROCESSING',
  'MEMORY_STORAGE',
  'CONNECTOR_ACCESS',
  'PROACTIVE_SUGGESTIONS',
  'COMMUNICATIONS',
  'ACTION_EXECUTION',
  'PRODUCT_ANALYTICS',
  'PERSONALIZATION',
  'PRECISE_LOCATION',
  'AUDIO_RETENTION',
  'FAMILY_SHARING',
] as const;
export const consentPurposeSchema = z.enum(CONSENT_PURPOSE_VALUES);

export const noticeSummarySchema = z
  .object({
    kind: noticeKindSchema,
    locale: noticeLocaleSchema,
    version: z.string(),
    /** `draft` notices are NEVER served outside local/test; they are not legally reviewed. */
    state: z.enum(['draft', 'approved']),
    effective_from: z.iso.datetime().nullable(),
    content_sha256: z.string(),
  })
  .strict()
  .meta({ id: 'NoticeSummary' });
export const noticeListSchema = z
  .object({ items: z.array(noticeSummarySchema) })
  .strict()
  .meta({ id: 'NoticeList' });
export const noticeSchema = noticeSummarySchema
  .extend({ content: z.string() })
  .strict()
  .meta({ id: 'Notice' });
export type Notice = z.infer<typeof noticeSchema>;
export type NoticeList = z.infer<typeof noticeListSchema>;

export const purposeCatalogSchema = z
  .object({
    items: z.array(
      z
        .object({
          purpose: consentPurposeSchema,
          title: z.string(),
          description: z.string(),
          availability: z.enum(['available', 'not_yet_available']),
          depends_on: z.array(consentPurposeSchema),
          legal_basis_status: z.literal('pending_legal_review'),
        })
        .strict(),
    ),
  })
  .strict()
  .meta({ id: 'PurposeCatalog' });
export type PurposeCatalog = z.infer<typeof purposeCatalogSchema>;

export const consentStateSchema = z
  .object({
    purpose: consentPurposeSchema,
    decision: z.enum(['granted', 'denied', 'revoked', 'not_asked']),
    /** Per-purpose version for If-Match (0 when never decided). */
    version: z.number().int().min(0),
    decided_at: z.iso.datetime().nullable(),
    notice_version: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'ConsentState' });
export const consentStateListSchema = z
  .object({ items: z.array(consentStateSchema) })
  .strict()
  .meta({ id: 'ConsentStateList' });
export type ConsentState = z.infer<typeof consentStateSchema>;
export type ConsentStateList = z.infer<typeof consentStateListSchema>;

export const consentDecisionRequestSchema = z
  .object({
    decision: z.enum(['grant', 'deny', 'revoke']),
    /** The privacy-notice version the user was shown when deciding. */
    notice_version: z.string().min(1).max(32),
    source: z.enum(['onboarding', 'settings', 'in_context']),
  })
  .strict()
  .meta({ id: 'ConsentDecisionRequest' });
export type ConsentDecisionRequest = z.infer<typeof consentDecisionRequestSchema>;

export const consentReceiptSchema = z
  .object({
    id: z.uuid(),
    seq: z.number().int().min(1),
    purpose: consentPurposeSchema,
    decision: z.enum(['granted', 'denied', 'revoked']),
    notice_kind: noticeKindSchema,
    notice_version: z.string(),
    notice_sha256: z.string(),
    source: z.string(),
    /** `cascade:<purpose>` when revoked because a purpose it depends on was revoked. */
    method: z.string(),
    occurred_at: z.iso.datetime(),
    prev_hash: z.string().nullable(),
    receipt_hash: z.string(),
  })
  .strict()
  .meta({ id: 'ConsentReceipt' });
export type ConsentReceipt = z.infer<typeof consentReceiptSchema>;

export const consentDecisionResultSchema = z
  .object({
    state: consentStateSchema,
    /** One receipt for this decision plus one per cascaded revocation. */
    receipts: z.array(consentReceiptSchema),
  })
  .strict()
  .meta({ id: 'ConsentDecisionResult' });
export type ConsentDecisionResult = z.infer<typeof consentDecisionResultSchema>;

export const consentHistorySchema = z
  .object({ items: z.array(consentReceiptSchema), next_cursor: z.string().nullable() })
  .strict()
  .meta({ id: 'ConsentHistory' });
export type ConsentHistory = z.infer<typeof consentHistorySchema>;

export const receiptVerificationSchema = z
  .object({
    valid: z.boolean(),
    receipts_checked: z.number().int().min(0),
    /** First receipt sequence number that failed verification, if any. */
    first_invalid_seq: z.number().int().nullable(),
  })
  .strict()
  .meta({ id: 'ReceiptVerification' });
export type ReceiptVerification = z.infer<typeof receiptVerificationSchema>;

export const legalAcceptanceRequestSchema = z
  .object({
    kind: z.enum(['privacy_notice', 'terms_of_service']),
    version: z.string().min(1).max(32),
    locale: noticeLocaleSchema,
  })
  .strict()
  .meta({ id: 'LegalAcceptanceRequest' });
export const legalStatusSchema = z
  .object({
    items: z.array(
      z
        .object({
          kind: z.enum(['privacy_notice', 'terms_of_service']),
          current_version: z.string().nullable(),
          accepted_version: z.string().nullable(),
          accepted_at: z.iso.datetime().nullable(),
          up_to_date: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()
  .meta({ id: 'LegalStatus' });
export type LegalStatus = z.infer<typeof legalStatusSchema>;
