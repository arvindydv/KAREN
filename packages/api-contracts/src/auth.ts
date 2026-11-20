import { z } from 'zod';

/**
 * First-party authentication input bounds (ADR-0015). These are TRANSPORT guards only — they
 * cap size before any expensive work. The authoritative rules run server-side:
 * e-mail canonicalization (`canonicalizeEmail` in @karen/domain) and the NIST SP 800-63B
 * password policy (apps/api `evaluatePassword`). Clients may mirror them for UX, never rely on them.
 */

/** Raw e-mail as typed. Canonicalized and validated server-side. */
export const emailInputSchema = z.string().min(1).max(320);

/**
 * Raw password as typed. 1024 UTF-16 code units bounds hashing cost and request size; the
 * server enforces 15–256 code points after NFKC normalization. No composition rules (NIST).
 */
export const PASSWORD_MIN_CODE_POINTS = 15;
export const PASSWORD_MAX_CODE_POINTS = 256;
export const passwordInputSchema = z.string().min(1).max(1024);

/** Why a proposed password was refused. Safe to show; never echoes the password. */
export const PASSWORD_REJECTIONS = [
  'TOO_SHORT',
  'TOO_LONG',
  'INVALID_CHARACTERS',
  'COMMONLY_USED',
  'CONTEXT_SPECIFIC',
  'REPETITIVE_OR_SEQUENTIAL',
] as const;
export const passwordRejectionSchema = z.enum(PASSWORD_REJECTIONS);
export type PasswordRejection = z.infer<typeof passwordRejectionSchema>;
