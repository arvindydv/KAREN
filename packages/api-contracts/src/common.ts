import { z } from 'zod';

/** Public API version prefix. Breaking changes require a new version (ADR-0006). */
export const API_VERSION = 'v1';

/** Machine-readable error codes (product spec §28 "Standard error shape"). */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  /** Authenticated, but the account's status forbids this (pending, locked, suspended…). */
  'ACCOUNT_INACTIVE',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'CONSENT_REQUIRED',
  'APPROVAL_REQUIRED',
  'PROVIDER_CAPABILITY_UNAVAILABLE',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: apiErrorCodeSchema,
        /** Safe, user-presentable message. Never contains internal details or secrets. */
        message: z.string(),
        correlation_id: z.string(),
        retryable: z.boolean(),
        next_options: z.array(z.string()).optional(),
        /** Field-level validation issues (VALIDATION_FAILED only). */
        details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'ApiError' });
export type ApiError = z.infer<typeof apiErrorSchema>;

export const cursorPageQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const cursorPage = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable() }).strict();
