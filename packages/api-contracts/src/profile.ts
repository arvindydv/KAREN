import { z } from 'zod';
import {
  authChallengeResponseSchema,
  emailInputSchema,
  otpCodeSchema,
  passwordInputSchema,
  challengeHandleSchema,
} from './auth.js';

/**
 * Phase 01 M4 — profile, preferences, saved places, e-mail and password change.
 * Concurrency: GET returns `version` (and an ETag); PATCH/PUT/DELETE on versioned resources
 * require `If-Match: "<version>"` → 428 if missing, 412 if stale. No mass assignment: every
 * request schema is strict and lists only user-editable fields.
 */

/** Plain text: no control characters; trimmed. */
const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, 'Control characters are not allowed.');

export const LOCALES = ['en-IN', 'hi-IN', 'en-US', 'en-GB'] as const;
export const localeSchema = z.enum(LOCALES);
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 code');
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code');

export const ACCOUNT_STATUS_VALUES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'LOCKED',
  'SUSPENDED',
  'DELETION_REQUESTED',
  'DELETED',
] as const;

export const profileSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    email_verified: z.boolean(),
    display_name: z.string().nullable(),
    /** How KAREN addresses the user. */
    preferred_name: z.string().nullable(),
    locale: localeSchema,
    timezone: z.string(),
    country: countryCodeSchema.nullable(),
    currency: currencyCodeSchema.nullable(),
    account_status: z.enum(ACCOUNT_STATUS_VALUES),
    created_at: z.iso.datetime(),
    version: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'Profile' });
export type Profile = z.infer<typeof profileSchema>;

export const profilePatchSchema = z
  .object({
    display_name: plainText(1, 120).nullable().optional(),
    preferred_name: plainText(1, 60).nullable().optional(),
    locale: localeSchema.optional(),
    timezone: z.string().min(1).max(64).optional(),
    country: countryCodeSchema.nullable().optional(),
    currency: currencyCodeSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.')
  .meta({ id: 'ProfilePatch' });
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export const preferencesSchema = z
  .object({
    language: z.enum(['en', 'hi', 'hinglish']),
    script: z.enum(['latin', 'devanagari']),
    date_format: z.enum(['dmy', 'mdy', 'ymd']),
    time_format: z.enum(['12h', '24h']),
    theme: z.enum(['system', 'light', 'dark']),
    text_size: z.enum(['default', 'large', 'larger']),
    reduced_motion: z.boolean(),
    high_contrast: z.boolean(),
    /** Optional product e-mail (security notices are always sent and are not a preference). */
    notify_product_email: z.boolean(),
    notify_push: z.boolean(),
    quiet_hours: z
      .object({
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict()
      .nullable(),
    version: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'Preferences' });
export type Preferences = z.infer<typeof preferencesSchema>;

export const preferencesPatchSchema = preferencesSchema
  .omit({ version: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.')
  .meta({ id: 'PreferencesPatch' });
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

export const placeInputSchema = z
  .object({
    kind: z.enum(['home', 'work', 'other']),
    label: plainText(1, 40),
    line1: plainText(1, 200),
    line2: plainText(1, 200).nullable().optional(),
    city: plainText(1, 100),
    region: plainText(1, 100).nullable().optional(),
    postal_code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 -]{2,12}$/)
      .nullable()
      .optional(),
    country: countryCodeSchema,
  })
  .strict()
  .meta({ id: 'PlaceInput' });
export type PlaceInput = z.infer<typeof placeInputSchema>;

export const placeSchema = placeInputSchema
  .extend({
    id: z.uuid(),
    line2: z.string().nullable(),
    region: z.string().nullable(),
    postal_code: z.string().nullable(),
    created_at: z.iso.datetime(),
    version: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'Place' });
export type Place = z.infer<typeof placeSchema>;
export const placeListSchema = z
  .object({ items: z.array(placeSchema) })
  .strict()
  .meta({ id: 'PlaceList' });
export type PlaceList = z.infer<typeof placeListSchema>;
export const MAX_SAVED_PLACES = 20;

export const emailChangeRequestSchema = z
  .object({ new_email: emailInputSchema, current_password: passwordInputSchema })
  .strict()
  .meta({ id: 'EmailChangeRequest' });
export const emailChangeConfirmSchema = z
  .object({ challenge_handle: challengeHandleSchema, code: otpCodeSchema })
  .strict()
  .meta({ id: 'EmailChangeConfirm' });
export const emailChangeStartedSchema = authChallengeResponseSchema;
export const emailChangedSchema = z
  .object({ status: z.literal('email_changed'), email: z.string() })
  .strict()
  .meta({ id: 'EmailChanged' });
export type EmailChanged = z.infer<typeof emailChangedSchema>;

export const passwordChangeRequestSchema = z
  .object({ current_password: passwordInputSchema, new_password: passwordInputSchema })
  .strict()
  .meta({ id: 'PasswordChangeRequest' });
export const passwordChangedSchema = z
  .object({
    status: z.literal('password_changed'),
    /** Other sessions signed out; the current one stays. */
    revoked_sessions: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'PasswordChanged' });
export type PasswordChanged = z.infer<typeof passwordChangedSchema>;
