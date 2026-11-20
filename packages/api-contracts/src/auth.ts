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

// ── Phase 01 M3: login, sessions, refresh, devices (ADR-0016) ───────────────────────────

export const CLIENT_KINDS = ['web', 'ios', 'android'] as const;
export const clientKindSchema = z.enum(CLIENT_KINDS);
export type ClientKind = z.infer<typeof clientKindSchema>;

/** Client-generated, per-install identifier (UUID). Not a hardware fingerprint. */
export const installationIdSchema = z.uuid();

export const loginRequestSchema = z
  .object({
    email: emailInputSchema,
    password: passwordInputSchema,
    client: clientKindSchema,
    device: z
      .object({
        installation_id: installationIdSchema,
        /** User-visible label, e.g. "Asha's Pixel". Plain text; shown back only to the owner. */
        name: z.string().trim().min(1).max(64).optional(),
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'LoginRequest' });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const signedInResponseSchema = z
  .object({
    result: z.literal('signed_in'),
    user_id: z.uuid(),
    session_id: z.uuid(),
    /** Absolute session end; re-login required after it. */
    session_expires_at: z.iso.datetime(),
    /**
     * ACTIVE, or DELETION_REQUESTED: a restricted session that can only view or cancel the
     * pending deletion (M7).
     */
    account_status: z.enum(['ACTIVE', 'DELETION_REQUESTED']),
    /** Web (BFF) only: opaque session token for an HttpOnly cookie. Never expose to browser JS. */
    session_token: z.string().optional(),
    /** Mobile only: short-lived ES256 access token (Authorization: Bearer). */
    access_token: z.string().optional(),
    access_token_expires_at: z.iso.datetime().optional(),
    /** Mobile only: single-use rotating refresh token. Store in the OS keystore only. */
    refresh_token: z.string().optional(),
  })
  .strict();

export const loginResponseSchema = z
  .discriminatedUnion('result', [
    signedInResponseSchema,
    z
      .object({
        /** Correct password, e-mail not yet verified: a fresh code was sent. */
        result: z.literal('verification_required'),
        challenge: authChallengeResponseSchema,
      })
      .strict(),
  ])
  .meta({ id: 'LoginResponse' });
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type SignedInResponse = z.infer<typeof signedInResponseSchema>;

export const refreshRequestSchema = z
  .object({ refresh_token: z.string().min(1).max(128), installation_id: installationIdSchema })
  .strict()
  .meta({ id: 'RefreshRequest' });
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const refreshResponseSchema = z
  .object({
    access_token: z.string(),
    access_token_expires_at: z.iso.datetime(),
    refresh_token: z.string(),
    session_expires_at: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'RefreshResponse' });
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const sessionSummarySchema = z
  .object({
    id: z.uuid(),
    client: clientKindSchema,
    device_id: z.uuid(),
    device_name: z.string().nullable(),
    created_at: z.iso.datetime(),
    last_seen_at: z.iso.datetime(),
    expires_at: z.iso.datetime(),
    current: z.boolean(),
  })
  .strict()
  .meta({ id: 'SessionSummary' });
export const sessionListSchema = z
  .object({ items: z.array(sessionSummarySchema) })
  .strict()
  .meta({ id: 'SessionList' });
export type SessionList = z.infer<typeof sessionListSchema>;

export const deviceSummarySchema = z
  .object({
    id: z.uuid(),
    platform: clientKindSchema,
    name: z.string().nullable(),
    first_seen_at: z.iso.datetime(),
    last_seen_at: z.iso.datetime(),
    active_sessions: z.number().int().min(0),
    current: z.boolean(),
  })
  .strict()
  .meta({ id: 'DeviceSummary' });
export const deviceListSchema = z
  .object({ items: z.array(deviceSummarySchema) })
  .strict()
  .meta({ id: 'DeviceList' });
export type DeviceList = z.infer<typeof deviceListSchema>;

export const revokeResultSchema = z
  .object({ revoked_sessions: z.number().int().min(0) })
  .strict()
  .meta({ id: 'RevokeResult' });
export type RevokeResult = z.infer<typeof revokeResultSchema>;
