import { randomUUID } from 'node:crypto';
import type {
  ClientKind,
  DeviceList,
  RefreshResponse,
  SessionList,
  SignedInResponse,
} from '@karen/api-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { securityEvent } from '../common/security-metrics.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import type { ClientKind as DbClientKind } from '../generated/prisma/client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';
import { ACCESS_TOKEN_SERVICE, type AccessTokenService } from '../security/access-token.js';
import { issueOpaqueToken, parseOpaqueToken } from '../security/opaque-token.js';
import { SealedBox } from '../security/sealed-box.js';

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const REFRESH_REPLAY_WINDOW_SECONDS = 10;
const LOCAL_REPLAY_SECRET = 'local-only-otp-hmac-key-not-a-secret-0000';

const TO_DB: Record<ClientKind, DbClientKind> = { web: 'WEB', ios: 'IOS', android: 'ANDROID' };
const FROM_DB: Record<DbClientKind, ClientKind> = { WEB: 'web', IOS: 'ios', ANDROID: 'android' };

export type RevokeReason =
  | 'logout'
  | 'logout_all'
  | 'user_revoked'
  | 'device_revoked'
  | 'password_reset'
  | 'password_changed'
  | 'email_changed'
  | 'account_status'
  | 'refresh_reuse'
  | 'device_mismatch';

export interface DeviceInput {
  installationId: string;
  name?: string | undefined;
}

export interface LiveSession {
  sessionId: string;
  userId: string;
  client: ClientKind;
  authTime: Date;
}

interface RefreshRow {
  id: string;
  session_id: string;
  generation: number;
  consumed_at: Date | null;
  successor_id: string | null;
  expires_at: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  revoked_at: Date | null;
  absolute_expires_at: Date;
  installation_id: string;
}

/**
 * Sessions, refresh rotation and devices (ADR-0016, Phase 01 M3).
 *
 * The session row in PostgreSQL is authoritative and is checked on every request
 * (`resolveLive`), so revocation is effective immediately for every API instance — no cache
 * that could serve a revoked session.
 *
 * Refresh rotation: each refresh token is single-use. The consuming transaction locks the
 * credential row (`FOR UPDATE`), marks it consumed and inserts exactly one successor, so
 * concurrent refreshes can never create two valid descendants. A retry of the SAME token
 * within 10 s from the SAME installation (lost response, app killed mid-refresh) receives the
 * SAME successor, re-delivered from an encrypted, 10-second Redis entry written inside the
 * transaction. Any other reuse of a consumed token revokes the session (stolen-token defence).
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly replayBox: SealedBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Inject(ACCESS_TOKEN_SERVICE) private readonly tokens: AccessTokenService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.replayBox = new SealedBox(env.OTP_HMAC_KEY ?? LOCAL_REPLAY_SECRET, 'refresh-replay');
  }

  /** Creates a session after successful authentication. Returns whether the device is new. */
  async create(
    userId: string,
    client: ClientKind,
    device: DeviceInput,
    authMethod: string,
    accountStatus: 'ACTIVE' | 'DELETION_REQUESTED' = 'ACTIVE',
  ): Promise<{ response: SignedInResponse; newDevice: boolean; hadOtherDevices: boolean }> {
    const now = Date.now();
    const sessionId = randomUUID();
    const web = client === 'web';
    const absolute = new Date(
      now +
        (web ? this.env.WEB_SESSION_ABSOLUTE_DAYS : this.env.REFRESH_TOKEN_TTL_DAYS) * 86_400_000,
    );
    const idle = web ? new Date(now + this.env.WEB_SESSION_IDLE_HOURS * 3_600_000) : absolute;
    const webToken = web ? issueOpaqueToken('session') : null;
    const refresh = web ? null : issueOpaqueToken('refresh');

    const { newDevice, hadOtherDevices } = await this.prisma.withUserScope(userId, async (tx) => {
      const deviceCount = await tx.device.count({ where: { userId } });
      const existing = await tx.device.findUnique({
        where: { userId_installationId: { userId, installationId: device.installationId } },
        select: { id: true },
      });
      const row = await tx.device.upsert({
        where: { userId_installationId: { userId, installationId: device.installationId } },
        create: {
          userId,
          installationId: device.installationId,
          platform: TO_DB[client],
          name: device.name ?? null,
        },
        update: {
          lastSeenAt: new Date(now),
          ...(device.name ? { name: device.name } : {}),
        },
      });
      await tx.session.create({
        data: {
          id: sessionId,
          userId,
          deviceId: row.id,
          client: TO_DB[client],
          tokenVerifier: webToken?.verifier ?? null,
          authMethod,
          idleExpiresAt: idle,
          absoluteExpiresAt: absolute,
        },
      });
      if (refresh) {
        await tx.refreshCredential.create({
          data: {
            sessionId,
            userId,
            verifier: refresh.verifier,
            generation: 0,
            expiresAt: absolute,
          },
        });
      }
      await this.audit.record(
        {
          actorType: 'USER',
          actorRef: userId,
          action: 'identity.session.created',
          subjectType: 'session',
          subjectId: sessionId,
          outcome: 'SUCCESS',
          reasonCode: authMethod,
          metadata: { client, new_device: existing === null },
        },
        tx,
      );
      return { newDevice: existing === null, hadOtherDevices: deviceCount > 0 };
    });

    const response: SignedInResponse = {
      result: 'signed_in',
      user_id: userId,
      session_id: sessionId,
      session_expires_at: absolute.toISOString(),
      account_status: accountStatus,
    };
    if (webToken) {
      response.session_token = webToken.token;
    } else if (refresh) {
      const access = await this.tokens.issue(userId, sessionId);
      response.access_token = access.token;
      response.access_token_expires_at = access.expiresAt.toISOString();
      response.refresh_token = refresh.token;
    }
    return { response, newDevice, hadOtherDevices };
  }

  /** Web: resolve an opaque session token to its owner, or null. */
  async locateWebSession(token: string): Promise<{ sessionId: string; userId: string } | null> {
    const verifier = parseOpaqueToken('session', token);
    if (!verifier) return null;
    const rows = await this.prisma.$queryRaw<{ session_id: string; user_id: string }[]>`
      SELECT session_id, user_id FROM identity.lookup_session_token(${verifier})`;
    const row = rows[0];
    return row ? { sessionId: row.session_id, userId: row.user_id } : null;
  }

  /**
   * Inside the caller's user-scoped transaction: returns the session if live (not revoked, not
   * idle- or absolute-expired), sliding web idle expiry and `last_seen` at most every 5 min.
   */
  async resolveLive(
    tx: TransactionClient,
    userId: string,
    sessionId: string,
  ): Promise<LiveSession | null> {
    const session = await tx.session.findFirst({
      where: { id: sessionId, userId },
      select: {
        id: true,
        client: true,
        revokedAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        lastSeenAt: true,
        authTime: true,
        deviceId: true,
      },
    });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt !== null ||
      session.idleExpiresAt.getTime() <= now ||
      session.absoluteExpiresAt.getTime() <= now
    ) {
      return null;
    }
    if (now - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      const idle =
        session.client === 'WEB'
          ? new Date(
              Math.min(
                now + this.env.WEB_SESSION_IDLE_HOURS * 3_600_000,
                session.absoluteExpiresAt.getTime(),
              ),
            )
          : session.idleExpiresAt;
      await tx.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now), idleExpiresAt: idle },
      });
      await tx.device.update({
        where: { id: session.deviceId },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return {
      sessionId: session.id,
      userId,
      client: FROM_DB[session.client],
      authTime: session.authTime,
    };
  }

  /** Mobile refresh with single-use rotation, reuse detection and an idempotent retry window. */
  async refresh(refreshToken: string, installationId: string): Promise<RefreshResponse> {
    const verifier = parseOpaqueToken('refresh', refreshToken);
    const invalid = () => new ApiError('UNAUTHENTICATED', 'Please sign in again.');
    if (!verifier) throw invalid();
    const located = await this.prisma.$queryRaw<
      { credential_id: string; session_id: string; user_id: string }[]
    >`SELECT credential_id, session_id, user_id FROM identity.lookup_refresh_credential(${verifier})`;
    const loc = located[0];
    if (!loc) throw invalid();
    const replayKey = `karen:refresh-replay:${verifier.slice(7, 47)}`;

    const outcome = await this.prisma.withUserScope(loc.user_id, async (tx) => {
      const [cred] = await tx.$queryRaw<RefreshRow[]>`
        SELECT id, session_id, generation, consumed_at, successor_id, expires_at
        FROM identity.refresh_credentials WHERE id = ${loc.credential_id}::uuid FOR UPDATE`;
      const [session] = await tx.$queryRaw<SessionRow[]>`
        SELECT s.id, s.user_id, s.revoked_at, s.absolute_expires_at, d.installation_id::text
        FROM identity.sessions s JOIN identity.devices d ON d.id = s.device_id
        WHERE s.id = ${loc.session_id}::uuid FOR UPDATE OF s`;
      if (!cred || !session || session.revoked_at !== null) return { kind: 'invalid' as const };
      const now = Date.now();
      if (cred.expires_at.getTime() <= now || session.absolute_expires_at.getTime() <= now) {
        return { kind: 'invalid' as const };
      }
      if (session.installation_id !== installationId) {
        await this.revokeInTx(tx, loc.user_id, { sessionId: session.id }, 'device_mismatch');
        return { kind: 'theft' as const, reason: 'device_mismatch' };
      }
      if (cred.consumed_at !== null) {
        const replay = await this.readReplay(replayKey, installationId);
        if (replay && cred.successor_id) {
          const [successor] = await tx.$queryRaw<{ consumed_at: Date | null }[]>`
            SELECT consumed_at FROM identity.refresh_credentials
            WHERE id = ${cred.successor_id}::uuid FOR UPDATE`;
          if (successor && successor.consumed_at === null) {
            return { kind: 'ok' as const, refreshToken: replay, session };
          }
        }
        await this.revokeInTx(tx, loc.user_id, { sessionId: session.id }, 'refresh_reuse');
        return { kind: 'theft' as const, reason: 'refresh_reuse' };
      }
      const next = issueOpaqueToken('refresh');
      const successor = await tx.refreshCredential.create({
        data: {
          sessionId: session.id,
          userId: loc.user_id,
          verifier: next.verifier,
          generation: cred.generation + 1,
          expiresAt: session.absolute_expires_at,
        },
        select: { id: true },
      });
      await tx.refreshCredential.update({
        where: { id: cred.id },
        data: { consumedAt: new Date(now), successorId: successor.id },
      });
      // Written BEFORE commit: a concurrent retry that waits on our row lock must find it.
      // Redis failure aborts the refresh (retryable 503) rather than risking a false theft alarm.
      await this.writeReplay(replayKey, installationId, next.token);
      await tx.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
      return { kind: 'ok' as const, refreshToken: next.token, session };
    });

    if (outcome.kind === 'invalid') {
      securityEvent('karen.auth.refresh', { outcome: 'invalid' });
      throw invalid();
    }
    if (outcome.kind === 'theft') {
      securityEvent('karen.auth.refresh', { outcome: outcome.reason });
      this.logger.warn({ reason: outcome.reason }, 'Refresh token reuse: session revoked');
      await this.audit.recordBestEffort({
        actorType: 'SYSTEM',
        actorRef: 'identity',
        action: 'identity.refresh.reuse_detected',
        subjectType: 'session',
        subjectId: loc.session_id,
        outcome: 'DENIED',
        policyDecision: 'refresh-rotation:v1',
        reasonCode: outcome.reason,
      });
      throw invalid();
    }
    securityEvent('karen.auth.refresh', { outcome: 'rotated' });
    const access = await this.tokens.issue(loc.user_id, outcome.session.id);
    return {
      access_token: access.token,
      access_token_expires_at: access.expiresAt.toISOString(),
      refresh_token: outcome.refreshToken,
      session_expires_at: outcome.session.absolute_expires_at.toISOString(),
    };
  }

  /** Revokes sessions of one user. Returns how many were active. */
  async revoke(
    userId: string,
    target: { sessionId?: string; deviceId?: string; exceptSessionId?: string },
    reason: RevokeReason,
  ): Promise<number> {
    return this.prisma.withUserScope(userId, (tx) => this.revokeInTx(tx, userId, target, reason));
  }

  /** Same as `revoke`, inside an existing user-scoped transaction (status changes, resets). */
  async revokeInTx(
    tx: TransactionClient,
    userId: string,
    target: { sessionId?: string; deviceId?: string; exceptSessionId?: string },
    reason: RevokeReason,
  ): Promise<number> {
    const { count } = await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(target.sessionId ? { id: target.sessionId } : {}),
        ...(target.deviceId ? { deviceId: target.deviceId } : {}),
        ...(target.exceptSessionId ? { NOT: { id: target.exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    if (count > 0) {
      securityEvent('karen.auth.session_revoked', { reason }, count);
      await this.audit.record(
        {
          actorType: 'USER',
          actorRef: userId,
          action: 'identity.session.revoked',
          subjectType: target.sessionId ? 'session' : 'user',
          subjectId: target.sessionId ?? userId,
          outcome: 'SUCCESS',
          reasonCode: reason,
          metadata: { count },
        },
        tx,
      );
    }
    return count;
  }

  async list(userId: string, currentSessionId: string): Promise<SessionList> {
    const now = new Date();
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.session.findMany({
        where: {
          userId,
          revokedAt: null,
          idleExpiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        include: { device: { select: { name: true } } },
        orderBy: { lastSeenAt: 'desc' },
        take: 100,
      }),
    );
    return {
      items: rows.map((s) => ({
        id: s.id,
        client: FROM_DB[s.client],
        device_id: s.deviceId,
        device_name: s.device.name,
        created_at: s.createdAt.toISOString(),
        last_seen_at: s.lastSeenAt.toISOString(),
        expires_at: s.absoluteExpiresAt.toISOString(),
        current: s.id === currentSessionId,
      })),
    };
  }

  async devices(userId: string, currentSessionId: string): Promise<DeviceList> {
    const now = new Date();
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.device.findMany({
        where: { userId },
        include: {
          sessions: {
            where: { revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
            select: { id: true },
          },
        },
        orderBy: { lastSeenAt: 'desc' },
        take: 100,
      }),
    );
    return {
      items: rows.map((d) => ({
        id: d.id,
        platform: FROM_DB[d.platform],
        name: d.name,
        first_seen_at: d.firstSeenAt.toISOString(),
        last_seen_at: d.lastSeenAt.toISOString(),
        active_sessions: d.sessions.length,
        current: d.sessions.some((s) => s.id === currentSessionId),
      })),
    };
  }

  /** Revoke one of the caller's own sessions/devices; another user's id is simply not found. */
  async revokeOwned(userId: string, kind: 'session' | 'device', id: string): Promise<number> {
    const exists = await this.prisma.withUserScope(userId, (tx) =>
      kind === 'session'
        ? tx.session.findFirst({ where: { id, userId }, select: { id: true } })
        : tx.device.findFirst({ where: { id, userId }, select: { id: true } }),
    );
    if (!exists) throw new ApiError('NOT_FOUND', 'Not found.');
    return this.revoke(
      userId,
      kind === 'session' ? { sessionId: id } : { deviceId: id },
      kind === 'session' ? 'user_revoked' : 'device_revoked',
    );
  }

  private async writeReplay(key: string, installationId: string, token: string): Promise<void> {
    try {
      await this.redis.client.set(
        key,
        this.replayBox.seal(token, installationId),
        'EX',
        REFRESH_REPLAY_WINDOW_SECONDS,
      );
    } catch (error) {
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Please retry in a moment.', {
        retryable: true,
        cause: error,
      });
    }
  }

  private async readReplay(key: string, installationId: string): Promise<string | null> {
    try {
      const sealed = await this.redis.client.get(key);
      return sealed ? this.replayBox.open(sealed, installationId) : null;
    } catch (error) {
      // Never turn a Redis blip into a false theft alarm (which would sign the user out):
      // refuse with a retryable 503 instead. Refresh already depends on Redis (writeReplay).
      this.logger.warn({ err: error }, 'Refresh replay cache unavailable');
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Please retry in a moment.', {
        retryable: true,
        cause: error,
      });
    }
  }
}
