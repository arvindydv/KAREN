import { z } from 'zod';
import { emailInputSchema, passwordInputSchema } from './auth.js';

/**
 * Phase 01 M8 — first-party staff realm (ADR-0017). Staff identities, sessions and permissions
 * are SEPARATE from consumer ones. Permissions are enforced only by the API; the admin UI uses
 * this matrix for display only.
 */
export const STAFF_ROLES = ['support_agent', 'ops_admin', 'security_admin'] as const;
export const staffRoleSchema = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const STAFF_PERMISSIONS = [
  'ops:read',
  'ops:cases:write',
  'flags:write',
  'audit:read',
  'staff:manage',
  /** Read a consumer account's STATUS only — with an access reason, always audited. */
  'users:read_status',
] as const;
export const staffPermissionSchema = z.enum(STAFF_PERMISSIONS);
export type StaffPermission = z.infer<typeof staffPermissionSchema>;

/** Least privilege. No role reads user content; no role manages its own grants. */
export const STAFF_ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly StaffPermission[]>> = {
  support_agent: ['ops:read', 'ops:cases:write', 'users:read_status'],
  ops_admin: ['ops:read', 'flags:write'],
  security_admin: ['ops:read', 'audit:read', 'staff:manage'],
};

/** WebAuthn JSON (W3C Level 3 *JSON types) — validated in depth by the WebAuthn library. */
const webauthnJson = z.record(z.string(), z.unknown());

export const ceremonyOptionsSchema = z
  .object({
    /** Opaque, single-use, 5-minute handle binding the browser ceremony to this server state. */
    ceremony_handle: z.string(),
    /** PublicKeyCredential{Creation,Request}OptionsJSON for navigator.credentials. */
    options: webauthnJson,
  })
  .strict()
  .meta({ id: 'StaffCeremonyOptions' });
export type CeremonyOptions = z.infer<typeof ceremonyOptionsSchema>;

export const staffLoginStartSchema = z
  .object({ email: emailInputSchema, password: passwordInputSchema })
  .strict()
  .meta({ id: 'StaffLoginStart' });
export const ceremonyFinishSchema = z
  .object({ ceremony_handle: z.string().min(1).max(128), credential: webauthnJson })
  .strict()
  .meta({ id: 'StaffCeremonyFinish' });
export const enrollmentStartSchema = z
  .object({ enrollment_token: z.string().min(1).max(128) })
  .strict()
  .meta({ id: 'StaffEnrollmentStart' });
export const enrollmentFinishSchema = z
  .object({
    ceremony_handle: z.string().min(1).max(128),
    credential: webauthnJson,
    /** Label for this key, e.g. "YubiKey 5C". Plain text. */
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[^\p{Cc}]*$/u),
    /** Set the staff password at enrollment (invitations). Policy applies. */
    password: passwordInputSchema,
  })
  .strict()
  .meta({ id: 'StaffEnrollmentFinish' });

export const staffMeSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    display_name: z.string(),
    roles: z.array(staffRoleSchema),
    /** Time-boxed roles from approved elevations (subset of roles). */
    elevated_roles: z.array(staffRoleSchema),
    permissions: z.array(staffPermissionSchema),
    session_expires_at: z.iso.datetime(),
    step_up_valid_until: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'StaffMe' });
export type StaffMe = z.infer<typeof staffMeSchema>;

export const staffSessionSchema = z
  .object({
    /** Admin BFF only: opaque `kst_` token for an HttpOnly, SameSite=Strict cookie. */
    session_token: z.string(),
    me: staffMeSchema,
  })
  .strict()
  .meta({ id: 'StaffSession' });
export type StaffSessionResponse = z.infer<typeof staffSessionSchema>;

export const staffInvitationRequestSchema = z
  .object({
    email: emailInputSchema,
    display_name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\p{Cc}]*$/u),
    roles: z.array(staffRoleSchema).min(1).max(3),
  })
  .strict()
  .meta({ id: 'StaffInvitationRequest' });
export const staffInvitationSchema = z
  .object({
    staff_id: z.uuid(),
    /** Shown once; deliver out of band. Single use, 24 h. */
    enrollment_token: z.string(),
    expires_at: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'StaffInvitation' });
export type StaffInvitation = z.infer<typeof staffInvitationSchema>;

export const elevationRequestSchema = z
  .object({
    role: staffRoleSchema,
    reason: z
      .string()
      .trim()
      .min(10)
      .max(500)
      .regex(/^[^\p{Cc}]*$/u),
    ticket_ref: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._#-]{3,64}$/),
    duration_minutes: z.number().int().min(5).max(240),
  })
  .strict()
  .meta({ id: 'ElevationRequest' });
export const elevationSchema = z
  .object({
    id: z.uuid(),
    staff_id: z.uuid(),
    role: staffRoleSchema,
    reason: z.string(),
    ticket_ref: z.string(),
    status: z.enum(['pending', 'active', 'rejected', 'revoked', 'expired']),
    requested_at: z.iso.datetime(),
    decided_by: z.uuid().nullable(),
    expires_at: z.iso.datetime().nullable(),
  })
  .strict()
  .meta({ id: 'Elevation' });
export type Elevation = z.infer<typeof elevationSchema>;
export const elevationDecisionSchema = z
  .object({ decision: z.enum(['approve', 'reject']) })
  .strict()
  .meta({ id: 'ElevationDecision' });

export const userStatusLookupSchema = z
  .object({ user_id: z.uuid(), status: z.string(), created_at: z.iso.datetime() })
  .strict()
  .meta({ id: 'UserStatusLookup' });
export type UserStatusLookup = z.infer<typeof userStatusLookupSchema>;
