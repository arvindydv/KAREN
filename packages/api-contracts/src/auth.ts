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

// ── Phase 01 M2: registration, e-mail verification, password reset ──────────────────────

/** Opaque handle binding a one-time code to the client that started the flow (ADR-0015). */
export const challengeHandleSchema = z.string().min(1).max(128);
/** 6-digit one-time code sent by e-mail. */
export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.');

const localeSchema = z.enum(['en-IN', 'hi-IN', 'en-US', 'en-GB']);
const timezoneSchema = z.string().min(1).max(64);

export const registerRequestSchema = z
  .object({
    email: emailInputSchema,
    password: passwordInputSchema,
    locale: localeSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .meta({ id: 'RegisterRequest' });
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/**
 * Returned by register / resend / forgot-password. IDENTICAL shape whether or not the e-mail
 * belongs to an account (enumeration resistance): the client always proceeds to "enter code".
 */
export const authChallengeResponseSchema = z
  .object({
    challenge_handle: challengeHandleSchema,
    expires_at: z.iso.datetime(),
    code_length: z.literal(6),
    delivery: z.literal('email'),
  })
  .strict()
  .meta({ id: 'AuthChallenge' });
export type AuthChallengeResponse = z.infer<typeof authChallengeResponseSchema>;

export const verifyEmailRequestSchema = z
  .object({ challenge_handle: challengeHandleSchema, code: otpCodeSchema })
  .strict()
  .meta({ id: 'VerifyEmailRequest' });
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const resendChallengeRequestSchema = z
  .object({ challenge_handle: challengeHandleSchema })
  .strict()
  .meta({ id: 'ResendChallengeRequest' });

export const forgotPasswordRequestSchema = z
  .object({ email: emailInputSchema })
  .strict()
  .meta({ id: 'ForgotPasswordRequest' });

export const resetPasswordRequestSchema = z
  .object({
    challenge_handle: challengeHandleSchema,
    code: otpCodeSchema,
    new_password: passwordInputSchema,
  })
  .strict()
  .meta({ id: 'ResetPasswordRequest' });
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const authActionResultSchema = z
  .object({
    status: z.enum(['email_verified', 'password_reset']),
    /** The client must now sign in; Phase 01 never signs a user in from a code alone. */
    next: z.literal('sign_in'),
  })
  .strict()
  .meta({ id: 'AuthActionResult' });
export type AuthActionResult = z.infer<typeof authActionResultSchema>;
