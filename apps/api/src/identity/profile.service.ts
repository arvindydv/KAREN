import type {
  EmailChanged,
  PasswordChanged,
  Place,
  PlaceInput,
  PlaceList,
  Preferences,
  PreferencesPatch,
  Profile,
  ProfilePatch,
  AuthChallengeResponse,
} from '@karen/api-contracts';
import { MAX_SAVED_PLACES } from '@karen/api-contracts';
import { canonicalizeEmail } from '@karen/domain';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { isValidCurrency, isValidTimeZone } from '../common/locale.js';
import { Prisma } from '../generated/prisma/client.js';
import type { SavedPlace, User, UserPreferences } from '../generated/prisma/client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { MailService } from '../infrastructure/mail/mail.service.js';
import { evaluatePassword } from '../security/password/password-policy.js';
import { AccountService } from './account.service.js';
import {
  emailChangeCodeMail,
  emailChangeNoticeMail,
  maskEmail,
  passwordChangedMail,
} from './auth-emails.js';
import { ChallengeService, REFUSE } from './challenge.service.js';
import { EmailSendBudget } from './email-send-budget.js';
import { ReauthService } from './reauth.service.js';
import { SessionService } from './session.service.js';

const stale = () =>
  new ApiError(
    'PRECONDITION_FAILED',
    'This item changed since you loaded it. Reload and try again.',
  );

const DEFAULT_PREFERENCES: Omit<Preferences, 'version'> = {
  language: 'en',
  script: 'latin',
  date_format: 'dmy',
  time_format: '12h',
  theme: 'system',
  text_size: 'default',
  reduced_motion: false,
  high_contrast: false,
  notify_product_email: false,
  notify_push: false,
  quiet_hours: null,
  reply_language: 'auto',
};

/**
 * Profile, preferences, saved places, e-mail change and password change (Phase 01 M4).
 *
 * Every read/write is scoped to the authenticated user (RLS + explicit `userId` filter).
 * Versioned resources use optimistic concurrency: the write's WHERE includes the version the
 * client read (`If-Match`), so a stale write changes nothing and returns 412.
 * Security-sensitive changes (e-mail, password) require the current password, are throttled
 * like sign-in, revoke the user's OTHER sessions, are audited, and notify the user by e-mail.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
    private readonly challenges: ChallengeService,
    private readonly sessions: SessionService,
    private readonly reauth: ReauthService,
    private readonly mail: MailService,
    private readonly budget: EmailSendBudget,
    private readonly audit: AuditService,
  ) {}

  // ── Profile ─────────────────────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<Profile> {
    const user = await this.prisma.withUserScope(userId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId }, include: { email: true } }),
    );
    return toProfile(user);
  }

  async patchProfile(
    userId: string,
    expectedVersion: number,
    patch: ProfilePatch,
  ): Promise<Profile> {
    if (patch.timezone !== undefined) assertTimezone(patch.timezone);
    if (patch.currency) assertCurrency(patch.currency);
    const data: Prisma.UserUpdateManyMutationInput = {
      ...(patch.display_name !== undefined ? { displayName: patch.display_name } : {}),
      ...(patch.preferred_name !== undefined ? { preferredName: patch.preferred_name } : {}),
      ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.country !== undefined ? { country: patch.country } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
    };
    const user = await this.prisma.withUserScope(userId, async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (count !== 1) throw stale();
      await this.audit.record(
        {
          actorType: 'USER',
          actorRef: userId,
          action: 'identity.profile.updated',
          subjectType: 'user',
          subjectId: userId,
          outcome: 'SUCCESS',
          // Field names only — never values (they may be personal data).
          metadata: { fields: Object.keys(patch).sort().join(',') },
        },
        tx,
      );
      return tx.user.findUniqueOrThrow({ where: { id: userId }, include: { email: true } });
    });
    return toProfile(user);
  }

  // ── Preferences ─────────────────────────────────────────────────────────────────────────

  async getPreferences(userId: string): Promise<Preferences> {
    const row = await this.prisma.withUserScope(userId, (tx) =>
      tx.userPreferences.findUnique({ where: { userId } }),
    );
    // Not yet saved: conservative defaults at version 0 (GET never writes).
    return row ? toPreferences(row) : { ...DEFAULT_PREFERENCES, version: 0 };
  }

  async patchPreferences(
    userId: string,
    expectedVersion: number,
    patch: PreferencesPatch,
  ): Promise<Preferences> {
    const data = {
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.script !== undefined ? { script: patch.script } : {}),
      ...(patch.date_format !== undefined ? { dateFormat: patch.date_format } : {}),
      ...(patch.time_format !== undefined ? { timeFormat: patch.time_format } : {}),
      ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
      ...(patch.text_size !== undefined ? { textSize: patch.text_size } : {}),
      ...(patch.reduced_motion !== undefined ? { reducedMotion: patch.reduced_motion } : {}),
      ...(patch.high_contrast !== undefined ? { highContrast: patch.high_contrast } : {}),
      ...(patch.notify_product_email !== undefined
        ? { notifyProductEmail: patch.notify_product_email }
        : {}),
      ...(patch.notify_push !== undefined ? { notifyPush: patch.notify_push } : {}),
      ...(patch.quiet_hours !== undefined
        ? {
            quietHoursStart: patch.quiet_hours?.start ?? null,
            quietHoursEnd: patch.quiet_hours?.end ?? null,
          }
        : {}),
      ...(patch.reply_language !== undefined ? { replyLanguage: patch.reply_language } : {}),
    };
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      const existing = await tx.userPreferences.findUnique({
        where: { userId },
        select: { version: true },
      });
      if (!existing) {
        // First save: only valid against the default version 0; concurrent first saves race
        // on the primary key and the loser gets 412.
        if (expectedVersion !== 0) throw stale();
        try {
          await tx.userPreferences.create({ data: { userId, ...data, version: 1 } });
        } catch (error) {
          if (isUniqueViolation(error)) throw stale();
          throw error;
        }
      } else {
        const { count } = await tx.userPreferences.updateMany({
          where: { userId, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (count !== 1) throw stale();
      }
      await this.audit.record(
        {
          actorType: 'USER',
          actorRef: userId,
          action: 'identity.preferences.updated',
          subjectType: 'user',
          subjectId: userId,
          outcome: 'SUCCESS',
          metadata: { fields: Object.keys(patch).sort().join(',') },
        },
        tx,
      );
      return tx.userPreferences.findUniqueOrThrow({ where: { userId } });
    });
    return toPreferences(row);
  }

  // ── Saved places ────────────────────────────────────────────────────────────────────────

  async listPlaces(userId: string): Promise<PlaceList> {
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.savedPlace.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    );
    return { items: rows.map(toPlace) };
  }

  async createPlace(userId: string, input: PlaceInput): Promise<Place> {
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      // Serialize per user so two concurrent creates cannot both pass the limit check.
      await tx.$queryRaw`SELECT id FROM identity.users WHERE id = ${userId}::uuid FOR UPDATE`;
      const count = await tx.savedPlace.count({ where: { userId } });
      if (count >= MAX_SAVED_PLACES) {
        throw new ApiError('CONFLICT', `You can save up to ${MAX_SAVED_PLACES} places.`);
      }
      const place = await tx.savedPlace.create({ data: { userId, ...placeData(input) } });
      await this.auditPlace(tx, userId, 'identity.place.created', place.id);
      return place;
    });
    return toPlace(row);
  }

  async updatePlace(
    userId: string,
    placeId: string,
    expectedVersion: number,
    input: PlaceInput,
  ): Promise<Place> {
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      const { count } = await tx.savedPlace.updateMany({
        where: { id: placeId, userId, version: expectedVersion },
        data: { ...placeData(input), version: { increment: 1 } },
      });
      if (count !== 1) throw await this.missingOrStale(tx, userId, placeId);
      await this.auditPlace(tx, userId, 'identity.place.updated', placeId);
      return tx.savedPlace.findUniqueOrThrow({ where: { id: placeId } });
    });
    return toPlace(row);
  }

  async deletePlace(userId: string, placeId: string, expectedVersion: number): Promise<void> {
    await this.prisma.withUserScope(userId, async (tx) => {
      const { count } = await tx.savedPlace.deleteMany({
        where: { id: placeId, userId, version: expectedVersion },
      });
      if (count !== 1) throw await this.missingOrStale(tx, userId, placeId);
      await this.auditPlace(tx, userId, 'identity.place.deleted', placeId);
    });
  }

  // ── E-mail change ───────────────────────────────────────────────────────────────────────

  async startEmailChange(
    userId: string,
    newEmailRaw: string,
    currentPassword: string,
  ): Promise<AuthChallengeResponse> {
    const next = canonicalizeEmail(newEmailRaw);
    if (!next.ok) {
      throw new ApiError('VALIDATION_FAILED', 'Enter a valid e-mail address.', {
        details: [{ path: 'new_email', message: next.reason }],
      });
    }
    const current = await this.accounts.emailOf(userId);
    if (next.canonical === current.canonical) {
      throw new ApiError('VALIDATION_FAILED', 'That is already your e-mail address.', {
        details: [{ path: 'new_email', message: 'unchanged' }],
      });
    }
    await this.reauth.verify(userId, currentPassword);

    // An address owned by another account gets an indistinguishable decoy (no oracle).
    const taken = await this.accounts.findAccountByEmail(next.canonical);
    if (taken || !(await this.budget.take(next.canonical))) {
      const decoy = this.challenges.decoy('EMAIL_CHANGE');
      return challengeResponse(decoy.handle, decoy.expiresAt);
    }
    const issued = await this.prisma.withUserScope(userId, async (tx) => {
      const c = await this.challenges.issue(tx, userId, 'EMAIL_CHANGE', {
        display: next.display,
        canonical: next.canonical,
      });
      await this.audit.record(
        {
          actorType: 'USER',
          actorRef: userId,
          action: 'identity.email_change.requested',
          subjectType: 'user',
          subjectId: userId,
          outcome: 'SUCCESS',
          reasonCode: 'reauthenticated',
        },
        tx,
      );
      return c;
    });
    this.mail.dispatch(emailChangeCodeMail(next.display, issued.code, issued.expiresAt));
    this.mail.dispatch(
      emailChangeNoticeMail(current.display, 'requested', maskEmail(next.display)),
    );
    return challengeResponse(issued.handle, issued.expiresAt);
  }

  async confirmEmailChange(
    userId: string,
    sessionId: string,
    handle: string,
    code: string,
  ): Promise<EmailChanged> {
    const previous = await this.accounts.emailOf(userId);
    let result;
    try {
      result = await this.challenges.check(handle, code, 'EMAIL_CHANGE', async (tx, ctx) => {
        // A code is only valid for the account that requested it.
        if (ctx.userId !== userId || !ctx.targetEmail) return REFUSE;
        await this.challenges.consume(tx, ctx.challengeId);
        await tx.userEmail.update({
          where: { userId },
          data: {
            email: ctx.targetEmail.display,
            emailCanonical: ctx.targetEmail.canonical,
            verifiedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await this.sessions.revokeInTx(tx, userId, { exceptSessionId: sessionId }, 'email_changed');
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: userId,
            action: 'identity.email_change.completed',
            subjectType: 'user',
            subjectId: userId,
            outcome: 'SUCCESS',
            reasonCode: 'otp_new_address',
          },
          tx,
        );
        return ctx.targetEmail;
      });
    } catch (error) {
      // Someone registered the address between request and confirmation.
      if (isUniqueViolation(error)) {
        throw new ApiError('CONFLICT', 'That e-mail address can no longer be used.');
      }
      throw error;
    }
    if (!result.ok) {
      throw new ApiError(
        'CHALLENGE_INVALID',
        'That code is invalid or has expired. Request a new code.',
      );
    }
    this.mail.dispatch(
      emailChangeNoticeMail(previous.display, 'completed', maskEmail(result.value.display)),
    );
    return { status: 'email_changed', email: result.value.display };
  }

  // ── Password change ─────────────────────────────────────────────────────────────────────

  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<PasswordChanged> {
    const email = await this.reauth.verify(userId, currentPassword);
    const policy = evaluatePassword(newPassword, { email: email.canonical });
    if (!policy.ok) {
      throw new ApiError('WEAK_PASSWORD', 'Choose a longer or less common password.', {
        details: policy.reasons.map((message) => ({ path: 'new_password', message })),
      });
    }
    const credential = await this.accounts.hashNormalizedPassword(policy.normalized);
    const revoked = await this.prisma.withUserScope(userId, async (tx) => {
      await tx.passwordCredential.update({
        where: { userId },
        data: {
          passwordHash: credential.hash,
          pepperId: credential.pepperId,
          scheme: credential.scheme,
          passwordChangedAt: new Date(),
          version: { increment: 1 },
        },
      });
      const n = await this.sessions.revokeInTx(
        tx,
        userId,
        { exceptSessionId: sessionId },
        'password_changed',
      );
      await this.audit.record(
        {
          actorType: 'USER',
          actorRef: userId,
          action: 'identity.password.changed',
          subjectType: 'user',
          subjectId: userId,
          outcome: 'SUCCESS',
          reasonCode: 'reauthenticated',
          metadata: { revoked_sessions: n },
        },
        tx,
      );
      return n;
    });
    this.mail.dispatch(passwordChangedMail(email.display));
    return { status: 'password_changed', revoked_sessions: revoked };
  }

  private async missingOrStale(tx: TransactionClient, userId: string, placeId: string) {
    const exists = await tx.savedPlace.findFirst({
      where: { id: placeId, userId },
      select: { id: true },
    });
    return exists ? stale() : new ApiError('NOT_FOUND', 'Not found.');
  }

  private auditPlace(tx: TransactionClient, userId: string, action: string, placeId: string) {
    return this.audit.record(
      {
        actorType: 'USER',
        actorRef: userId,
        action,
        subjectType: 'saved_place',
        subjectId: placeId,
        outcome: 'SUCCESS',
      },
      tx,
    );
  }
}

function toProfile(
  user: User & { email: { email: string; verifiedAt: Date | null } | null },
): Profile {
  return {
    id: user.id,
    email: user.email?.email ?? '',
    email_verified: (user.email?.verifiedAt ?? null) !== null,
    display_name: user.displayName,
    preferred_name: user.preferredName,
    locale: user.locale as Profile['locale'],
    timezone: user.timezone,
    country: user.country,
    currency: user.currency,
    account_status: user.status,
    created_at: user.createdAt.toISOString(),
    version: user.version,
  };
}

function toPreferences(row: UserPreferences): Preferences {
  return {
    language: row.language as Preferences['language'],
    script: row.script as Preferences['script'],
    date_format: row.dateFormat as Preferences['date_format'],
    time_format: row.timeFormat as Preferences['time_format'],
    theme: row.theme as Preferences['theme'],
    text_size: row.textSize as Preferences['text_size'],
    reduced_motion: row.reducedMotion,
    high_contrast: row.highContrast,
    notify_product_email: row.notifyProductEmail,
    notify_push: row.notifyPush,
    quiet_hours:
      row.quietHoursStart && row.quietHoursEnd
        ? { start: row.quietHoursStart, end: row.quietHoursEnd }
        : null,
    reply_language: row.replyLanguage as Preferences['reply_language'],
    version: row.version,
  };
}

function toPlace(row: SavedPlace): Place {
  return {
    id: row.id,
    kind: row.kind as Place['kind'],
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postal_code: row.postalCode,
    country: row.country,
    created_at: row.createdAt.toISOString(),
    version: row.version,
  };
}

function placeData(input: PlaceInput) {
  return {
    kind: input.kind,
    label: input.label,
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city,
    region: input.region ?? null,
    postalCode: input.postal_code ?? null,
    country: input.country,
  };
}

function challengeResponse(handle: string, expiresAt: Date): AuthChallengeResponse {
  return {
    challenge_handle: handle,
    expires_at: expiresAt.toISOString(),
    code_length: 6,
    delivery: 'email',
  };
}

function assertTimezone(tz: string): void {
  if (!isValidTimeZone(tz)) {
    throw new ApiError('VALIDATION_FAILED', 'Unknown time zone.', {
      details: [{ path: 'timezone', message: 'unknown_time_zone' }],
    });
  }
}

function assertCurrency(code: string): void {
  if (!isValidCurrency(code)) {
    throw new ApiError('VALIDATION_FAILED', 'Unknown currency.', {
      details: [{ path: 'currency', message: 'unknown_currency' }],
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
