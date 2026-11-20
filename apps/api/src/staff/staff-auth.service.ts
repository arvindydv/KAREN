import { createHash } from 'node:crypto';
import {
  STAFF_ROLE_PERMISSIONS,
  type CeremonyOptions,
  type StaffMe,
  type StaffPermission,
  type StaffRole,
  type StaffSessionResponse,
} from '@karen/api-contracts';
import { canonicalizeEmail } from '@karen/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';
import { GateSaturatedError } from '../security/concurrency-gate.js';
import { issueOpaqueToken, parseOpaqueToken } from '../security/opaque-token.js';
import { PasswordHasher } from '../security/password/password-hasher.js';
import { evaluatePassword, normalizePassword } from '../security/password/password-policy.js';

export const STAFF_DB = Symbol('STAFF_DB');

const CEREMONY_TTL_SECONDS = 300;
const ENROLLMENT_TTL_MS = 24 * 3_600_000;

type CeremonyPurpose = 'enroll' | 'login' | 'step_up';
interface CeremonyState {
  purpose: CeremonyPurpose;
  staffId: string;
  challenge: string;
  sessionId?: string;
  enrollmentId?: string;
}

export interface StaffPrincipal {
  staffId: string;
  sessionId: string;
  email: string;
  displayName: string;
  roles: StaffRole[];
  elevatedRoles: StaffRole[];
  permissions: StaffPermission[];
  stepUpAt: Date;
  sessionExpiresAt: Date;
}

const invalid = () => new ApiError('UNAUTHENTICATED', 'Authentication is required.');

/**
 * First-party staff authentication (Phase 01 M8, ADR-0017).
 *
 * - Password AND a WebAuthn assertion with user verification on EVERY sign-in. No OTP or
 *   e-mail fallback exists for staff.
 * - Accounts are created only by the offline bootstrap (first admin) or an invitation from a
 *   security_admin; each gets a single-use enrollment link to register a security key.
 * - Ceremony state lives in Redis for 5 minutes and is consumed atomically (GETDEL): one
 *   challenge, one use.
 * - Sessions: opaque `kst_` token (SHA-256 verifier stored), 15 min idle / 8 h absolute;
 *   `step_up_at` records the last fresh assertion for sensitive actions.
 * - Everything runs on the staff DB role; consumer tables are unreachable from here.
 */
@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    @Inject(STAFF_DB) private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ── Bootstrap & enrollment ──────────────────────────────────────────────────────────────

  /**
   * OFFLINE ONLY (CLI): creates the first security_admin. Refused once any staff account exists
   * (serialized by an advisory lock, so two concurrent runs cannot both succeed).
   */
  async bootstrapFirstAdmin(
    emailRaw: string,
    displayName: string,
  ): Promise<{ staffId: string; enrollmentToken: string; expiresAt: Date }> {
    const email = this.canonical(emailRaw);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('karen.staff.bootstrap'))`;
      if ((await tx.staffAccount.count()) > 0) {
        throw new Error('staff bootstrap refused: staff accounts already exist (use invitations)');
      }
      const account = await tx.staffAccount.create({
        data: { email: email.display, emailCanonical: email.canonical, displayName },
      });
      await tx.staffRoleAssignment.create({
        data: { staffId: account.id, role: 'security_admin' },
      });
      const enrollment = issueOpaqueToken('staffEnrollment');
      const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
      await tx.staffEnrollment.create({
        data: { staffId: account.id, tokenVerifier: enrollment.verifier, expiresAt },
      });
      await this.audit.record(
        {
          actorType: 'SYSTEM',
          actorRef: 'staff-bootstrap-cli',
          action: 'staff.bootstrap',
          subjectType: 'staff_account',
          subjectId: account.id,
          outcome: 'SUCCESS',
          reasonCode: 'first_security_admin',
        },
        tx,
      );
      return { staffId: account.id, enrollmentToken: enrollment.token, expiresAt };
    });
  }

  async enrollmentOptions(enrollmentToken: string): Promise<CeremonyOptions> {
    const enrollment = await this.openEnrollment(enrollmentToken);
    const account = await this.db.staffAccount.findUniqueOrThrow({
      where: { id: enrollment.staffId },
      include: { webauthn: true },
    });
    const options = await generateRegistrationOptions({
      rpName: 'KAREN Admin',
      rpID: this.rpId(),
      userName: account.email,
      userDisplayName: account.displayName,
      userID: new TextEncoder().encode(account.id),
      attestationType: 'none',
      excludeCredentials: account.webauthn.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      supportedAlgorithmIDs: [-7, -257],
    });
    const handle = await this.saveCeremony({
      purpose: 'enroll',
      staffId: account.id,
      challenge: options.challenge,
      enrollmentId: enrollment.id,
    });
    return { ceremony_handle: handle, options: options as unknown as Record<string, unknown> };
  }

  async enrollmentFinish(
    handle: string,
    credential: Record<string, unknown>,
    name: string,
    password: string,
  ): Promise<void> {
    const state = await this.takeCeremony(handle, 'enroll');
    const account = await this.db.staffAccount.findUniqueOrThrow({ where: { id: state.staffId } });
    const policy = evaluatePassword(password, { email: account.emailCanonical });
    if (!policy.ok) {
      throw new ApiError('WEAK_PASSWORD', 'Choose a longer or less common password.', {
        details: policy.reasons.map((message) => ({ path: 'password', message })),
      });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: credential as unknown as RegistrationResponseJSON,
        expectedChallenge: state.challenge,
        expectedOrigin: this.env.STAFF_WEBAUTHN_ORIGINS,
        expectedRPID: this.rpId(),
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.warn({ reason: (error as Error).name }, 'Staff key registration rejected');
      throw invalid();
    }
    if (!verification.verified || !verification.registrationInfo) throw invalid();
    const info = verification.registrationInfo;
    const hash = await this.gated(() => this.hasher.hash(policy.normalized));
    await this.db.$transaction(async (tx) => {
      const enrollment = await tx.staffEnrollment.updateMany({
        where: { id: state.enrollmentId, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (enrollment.count !== 1) throw invalid(); // used or expired in the meantime
      await tx.staffWebauthnCredential.create({
        data: {
          staffId: account.id,
          credentialId: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: BigInt(info.credential.counter),
          transports: info.credential.transports ?? [],
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          name,
        },
      });
      await tx.staffPasswordCredential.upsert({
        where: { staffId: account.id },
        create: {
          staffId: account.id,
          passwordHash: hash.hash,
          pepperId: hash.pepperId,
          scheme: hash.scheme,
        },
        update: {
          passwordHash: hash.hash,
          pepperId: hash.pepperId,
          scheme: hash.scheme,
          passwordChangedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.staffAccount.updateMany({
        where: { id: account.id, status: 'invited' },
        data: { status: 'active', version: { increment: 1 } },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorRef: account.id,
          action: 'staff.webauthn.enrolled',
          subjectType: 'staff_account',
          subjectId: account.id,
          outcome: 'SUCCESS',
          metadata: { device_type: info.credentialDeviceType },
        },
        tx,
      );
    });
  }

  // ── Sign-in & step-up ───────────────────────────────────────────────────────────────────

  /** Step 1: password (uniform cost for unknown e-mails) → WebAuthn challenge for that account. */
  async loginStart(emailRaw: string, password: string): Promise<CeremonyOptions> {
    const email = canonicalizeEmail(emailRaw);
    const normalized = normalizePassword(password);
    const account = email.ok
      ? await this.db.staffAccount.findUnique({
          where: { emailCanonical: email.canonical },
          include: { password: true, webauthn: true },
        })
      : null;
    const fail = async (reason: string) => {
      await this.audit.recordBestEffort({
        actorType: 'STAFF',
        actorRef: account?.id ?? 'unknown',
        action: 'staff.login.failed',
        outcome: 'DENIED',
        policyDecision: 'staff-auth:v1',
        reasonCode: reason,
      });
      return new ApiError('INVALID_CREDENTIALS', 'The e-mail or password is incorrect.');
    };
    if (!account?.password || normalized === null) {
      await this.gated(() => this.hasher.verifyDummy(password));
      throw await fail('invalid_credentials');
    }
    const check = await this.gated(() =>
      this.hasher.verify(normalized, {
        hash: account.password!.passwordHash,
        pepperId: account.password!.pepperId,
        scheme: account.password!.scheme,
      }),
    );
    if (!check.valid) throw await fail('invalid_credentials');
    if (account.status !== 'active' || account.webauthn.length === 0) {
      throw await fail(`account_${account.status}`);
    }
    return this.assertionOptions(account.id, account.webauthn, 'login');
  }

  /** Step 2: verify the security-key assertion → staff session. */
  async loginFinish(
    handle: string,
    credential: Record<string, unknown>,
  ): Promise<StaffSessionResponse> {
    const state = await this.takeCeremony(handle, 'login');
    await this.verifyAssertion(state, credential);
    const token = issueOpaqueToken('staffSession');
    const now = Date.now();
    const absolute = new Date(now + this.env.STAFF_SESSION_ABSOLUTE_HOURS * 3_600_000);
    await this.db.$transaction(async (tx) => {
      const s = await tx.staffSession.create({
        data: {
          staffId: state.staffId,
          tokenVerifier: token.verifier,
          idleExpiresAt: new Date(
            Math.min(now + this.env.STAFF_SESSION_IDLE_MINUTES * 60_000, absolute.getTime()),
          ),
          absoluteExpiresAt: absolute,
          stepUpAt: new Date(now),
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorRef: state.staffId,
          action: 'staff.login.succeeded',
          subjectType: 'staff_session',
          subjectId: s.id,
          outcome: 'SUCCESS',
          reasonCode: 'password_webauthn',
        },
        tx,
      );
    });
    const principal = await this.resolve(token.token);
    if (!principal) throw new Error('freshly created staff session did not resolve');
    return { session_token: token.token, me: this.toMe(principal) };
  }

  async stepUpStart(principal: StaffPrincipal): Promise<CeremonyOptions> {
    const creds = await this.db.staffWebauthnCredential.findMany({
      where: { staffId: principal.staffId },
    });
    return this.assertionOptions(principal.staffId, creds, 'step_up', principal.sessionId);
  }

  async stepUpFinish(
    principal: StaffPrincipal,
    handle: string,
    credential: Record<string, unknown>,
  ): Promise<StaffMe> {
    const state = await this.takeCeremony(handle, 'step_up');
    if (state.staffId !== principal.staffId || state.sessionId !== principal.sessionId)
      throw invalid();
    await this.verifyAssertion(state, credential);
    await this.db.staffSession.update({
      where: { id: principal.sessionId },
      data: { stepUpAt: new Date() },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorRef: principal.staffId,
      action: 'staff.step_up',
      subjectType: 'staff_session',
      subjectId: principal.sessionId,
      outcome: 'SUCCESS',
    });
    const fresh = await this.resolveById(principal.sessionId);
    if (!fresh) throw invalid();
    return this.toMe(fresh);
  }

  async logout(principal: StaffPrincipal): Promise<void> {
    await this.db.staffSession.updateMany({
      where: { id: principal.sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'logout' },
    });
  }

  // ── Session resolution (every staff request) ────────────────────────────────────────────

  async resolve(token: string | undefined): Promise<StaffPrincipal | null> {
    const verifier = token ? parseOpaqueToken('staffSession', token) : null;
    if (!verifier) return null;
    const session = await this.db.staffSession.findUnique({ where: { tokenVerifier: verifier } });
    return session ? this.resolveById(session.id) : null;
  }

  toMe(p: StaffPrincipal): StaffMe {
    return {
      id: p.staffId,
      email: p.email,
      display_name: p.displayName,
      roles: p.roles,
      elevated_roles: p.elevatedRoles,
      permissions: p.permissions,
      session_expires_at: p.sessionExpiresAt.toISOString(),
      step_up_valid_until: new Date(
        p.stepUpAt.getTime() + this.env.STAFF_STEP_UP_MAX_AGE_SECONDS * 1000,
      ).toISOString(),
    };
  }

  private async resolveById(sessionId: string): Promise<StaffPrincipal | null> {
    const now = new Date();
    const session = await this.db.staffSession.findUnique({
      where: { id: sessionId },
      include: {
        account: {
          include: {
            roles: true,
            elevations: { where: { status: 'active', expiresAt: { gt: now } } },
          },
        },
      },
    });
    if (
      !session ||
      session.revokedAt !== null ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      session.account.status !== 'active'
    ) {
      return null;
    }
    // Sliding idle window, capped by the absolute lifetime.
    await this.db.staffSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        idleExpiresAt: new Date(
          Math.min(
            now.getTime() + this.env.STAFF_SESSION_IDLE_MINUTES * 60_000,
            session.absoluteExpiresAt.getTime(),
          ),
        ),
      },
    });
    const standing = session.account.roles.map((r) => r.role as StaffRole);
    const elevated = session.account.elevations.map((e) => e.role as StaffRole);
    const roles = [...new Set([...standing, ...elevated])];
    return {
      staffId: session.staffId,
      sessionId: session.id,
      email: session.account.email,
      displayName: session.account.displayName,
      roles,
      elevatedRoles: [...new Set(elevated.filter((r) => !standing.includes(r)))],
      permissions: [...new Set(roles.flatMap((r) => STAFF_ROLE_PERMISSIONS[r]))],
      stepUpAt: session.stepUpAt,
      sessionExpiresAt: session.absoluteExpiresAt,
    };
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────

  private async assertionOptions(
    staffId: string,
    creds: { credentialId: string; transports: string[] }[],
    purpose: 'login' | 'step_up',
    sessionId?: string,
  ): Promise<CeremonyOptions> {
    if (creds.length === 0) throw invalid();
    const options = await generateAuthenticationOptions({
      rpID: this.rpId(),
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransport[],
      })),
      userVerification: 'required',
    });
    const handle = await this.saveCeremony({
      purpose,
      staffId,
      challenge: options.challenge,
      ...(sessionId ? { sessionId } : {}),
    });
    return { ceremony_handle: handle, options: options as unknown as Record<string, unknown> };
  }

  private async verifyAssertion(
    state: CeremonyState,
    credential: Record<string, unknown>,
  ): Promise<void> {
    const response = credential as unknown as AuthenticationResponseJSON;
    const stored = await this.db.staffWebauthnCredential.findFirst({
      where: { credentialId: String(response.id ?? ''), staffId: state.staffId },
    });
    if (!stored) throw invalid();
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: state.challenge,
        expectedOrigin: this.env.STAFF_WEBAUTHN_ORIGINS,
        expectedRPID: this.rpId(),
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: Number(stored.counter),
          transports: stored.transports,
        },
      });
    } catch (error) {
      // Includes signature failure, wrong origin/RP, missing UV and counter regression (clone).
      this.logger.warn(
        { reason: (error as Error).message.slice(0, 120) },
        'Staff assertion rejected',
      );
      await this.audit.recordBestEffort({
        actorType: 'STAFF',
        actorRef: state.staffId,
        action: 'staff.webauthn.rejected',
        outcome: 'DENIED',
        policyDecision: 'staff-auth:v1',
        reasonCode: 'assertion_invalid',
      });
      throw invalid();
    }
    if (!result.verified) throw invalid();
    // Monotonic counter update guarded by the old value (concurrent assertions cannot both pass).
    const updated = await this.db.staffWebauthnCredential.updateMany({
      where: { id: stored.id, counter: stored.counter },
      data: { counter: BigInt(result.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    if (updated.count !== 1) throw invalid();
  }

  private async saveCeremony(state: CeremonyState): Promise<string> {
    const handle = issueOpaqueToken('webauthnCeremony');
    try {
      await this.redis.client.set(
        this.ceremonyKey(handle.verifier),
        JSON.stringify(state),
        'EX',
        CEREMONY_TTL_SECONDS,
      );
    } catch (error) {
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Sign-in is temporarily unavailable.', {
        retryable: true,
        cause: error,
      });
    }
    return handle.token;
  }

  /** Single use: GETDEL. Wrong purpose, expired or replayed → 401. */
  private async takeCeremony(handle: string, purpose: CeremonyPurpose): Promise<CeremonyState> {
    const verifier = parseOpaqueToken('webauthnCeremony', handle);
    if (!verifier) throw invalid();
    let raw: string | null;
    try {
      raw = await this.redis.client.getdel(this.ceremonyKey(verifier));
    } catch (error) {
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Sign-in is temporarily unavailable.', {
        retryable: true,
        cause: error,
      });
    }
    if (!raw) throw invalid();
    const state = JSON.parse(raw) as CeremonyState;
    if (state.purpose !== purpose) throw invalid();
    return state;
  }

  private ceremonyKey(verifier: string): string {
    return `karen:webauthn:${createHash('sha256').update(verifier).digest('hex').slice(0, 40)}`;
  }

  private async openEnrollment(token: string) {
    const verifier = parseOpaqueToken('staffEnrollment', token);
    const enrollment = verifier
      ? await this.db.staffEnrollment.findUnique({ where: { tokenVerifier: verifier } })
      : null;
    if (!enrollment || enrollment.consumedAt !== null || enrollment.expiresAt <= new Date()) {
      throw new ApiError('CHALLENGE_INVALID', 'This enrollment link is invalid or has expired.');
    }
    return enrollment;
  }

  private canonical(raw: string) {
    const email = canonicalizeEmail(raw);
    if (!email.ok) throw new ApiError('VALIDATION_FAILED', 'Enter a valid e-mail address.');
    return email;
  }

  private rpId(): string {
    return this.env.STAFF_WEBAUTHN_RP_ID ?? '';
  }

  private async gated<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GateSaturatedError) {
        throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Sign-in is busy. Please retry.', {
          retryable: true,
        });
      }
      throw error;
    }
  }
}
