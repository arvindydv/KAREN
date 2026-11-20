import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { AccountService } from '../src/identity/account.service.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { MemoryMailTransport } from '../src/infrastructure/mail/mail-transport.js';
import { MAIL_TRANSPORT, MailService } from '../src/infrastructure/mail/mail.service.js';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';

/**
 * Phase 01 / M3: login, sessions, refresh rotation, revocation and devices — over HTTP against
 * real PostgreSQL + Redis (ADR-0016).
 */
const PW = 'mango monsoon bicycle lantern';
const NEW_PW = 'velvet harbour quietly folds paper';
const addr = (tag: string) =>
  `m3.${tag}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@example.test`;

async function start(overrides: Record<string, string> = {}) {
  const app = await createApp(testEnv({ EMAIL_SEND_LIMIT_PER_HOUR: '100', ...overrides }), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await request(app.getHttpServer()).get('/health/ready').expect(200);
  return app;
}

describe('sessions (integration)', () => {
  let app: NestFastifyApplication;
  let mailbox: MemoryMailTransport;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const http = () => request(app.getHttpServer());

  const lastCode = async (to: string, template: string) => {
    await app.get(MailService).drain();
    const mail = mailbox
      .to(to)
      .filter((m) => m.template === template)
      .at(-1);
    const code = mail ? /\b(\d{6})\b/.exec(mail.text)?.[1] : undefined;
    if (!code) throw new Error(`no ${template} code for ${to}`);
    return code;
  };
  const activeAccount = async (tag: string) => {
    const email = addr(tag);
    const res = await http().post('/v1/auth/register').send({ email, password: PW }).expect(202);
    const code = await lastCode(email, 'auth.email_verification');
    await http()
      .post('/v1/auth/verify-email')
      .send({ challenge_handle: res.body.challenge_handle, code })
      .expect(200);
    return email;
  };
  const login = (
    email: string,
    client: 'web' | 'ios' | 'android' = 'android',
    installation_id: string = randomUUID(),
    password = PW,
  ) =>
    http()
      .post('/v1/auth/login')
      .send({ email, password, client, device: { installation_id, name: 'Test phone' } });
  const me = (token: string) => http().get('/v1/me').set('authorization', `Bearer ${token}`);
  const refresh = (refresh_token: string, installation_id: string) =>
    http().post('/v1/auth/token/refresh').send({ refresh_token, installation_id });

  beforeAll(async () => {
    app = await start();
    mailbox = app.get<MemoryMailTransport>(MAIL_TRANSPORT);
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('login', () => {
    it('mobile: returns an access + refresh token pair that authenticates', async () => {
      const email = await activeAccount('mobile');
      const res = await login(email, 'android').expect(200);
      expect(res.body).toMatchObject({ result: 'signed_in' });
      expect(res.body.access_token).toMatch(/^eyJ/);
      expect(res.body.refresh_token).toMatch(/^krt_/);
      expect(res.body.session_token).toBeUndefined();
      const who = await me(res.body.access_token as string).expect(200);
      expect(who.body.id).toBe(res.body.user_id);
      // Only verifiers are stored.
      const rows = await owner.refreshCredential.findMany({
        where: { sessionId: res.body.session_id as string },
      });
      expect(JSON.stringify(rows)).not.toContain((res.body.refresh_token as string).slice(4));
    });

    it('web: returns an opaque session token (for the BFF cookie) that authenticates', async () => {
      const email = await activeAccount('web');
      const res = await login(email, 'web').expect(200);
      expect(res.body.session_token).toMatch(/^kss_/);
      expect(res.body.access_token).toBeUndefined();
      await me(res.body.session_token as string).expect(200);
      await me(`kss_${'A'.repeat(43)}`).expect(401);
    });

    it('wrong password and unknown e-mail get the identical 401', async () => {
      const email = await activeAccount('wrong');
      const a = await login(email, 'android', randomUUID(), 'not the right passphrase').expect(401);
      const b = await login(addr('nobody')).expect(401);
      expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
      expect({ ...a.body.error, correlation_id: '' }).toEqual({
        ...b.body.error,
        correlation_id: '',
      });
    });

    it('unverified account + correct password → a fresh verification challenge, no session', async () => {
      const email = addr('pending');
      await http().post('/v1/auth/register').send({ email, password: PW }).expect(202);
      const res = await login(email).expect(200);
      expect(res.body.result).toBe('verification_required');
      expect(res.body.challenge.challenge_handle).toMatch(/^kev_/);
      const code = await lastCode(email, 'auth.email_verification');
      await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: res.body.challenge.challenge_handle, code })
        .expect(200);
      expect((await login(email).expect(200)).body.result).toBe('signed_in');
    });

    it('locked accounts learn their status only after a correct password', async () => {
      const email = await activeAccount('locked');
      const userId = (await login(email).expect(200)).body.user_id as string;
      await owner.user.update({ where: { id: userId }, data: { status: 'LOCKED' } });
      await login(email, 'android', randomUUID(), 'not the right passphrase').expect(401);
      const res = await login(email).expect(403);
      expect(res.body.error).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        next_options: ['RESET_PASSWORD'],
      });
    });

    it('e-mails a new-sign-in notice for a new device, but not for the first one', async () => {
      const email = await activeAccount('notice');
      await login(email).expect(200);
      await app.get(MailService).drain();
      expect(mailbox.to(email).some((m) => m.template === 'auth.new_sign_in')).toBe(false);
      await login(email, 'ios').expect(200);
      await app.get(MailService).drain();
      expect(mailbox.to(email).filter((m) => m.template === 'auth.new_sign_in')).toHaveLength(1);
    });

    it('per-account throttle blocks before hashing, for existing and unknown e-mails alike', async () => {
      const limited = await start({ LOGIN_MAX_FAILURES: '3' });
      try {
        const post = (email: string, password: string) =>
          request(limited.getHttpServer())
            .post('/v1/auth/login')
            .send({ email, password, client: 'web', device: { installation_id: randomUUID() } });
        const email = await activeAccount('throttle');
        for (let i = 0; i < 3; i++) await post(email, 'not the right passphrase').expect(401);
        const blocked = await post(email, PW).expect(429);
        expect(blocked.body.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
        const ghost = addr('ghost');
        for (let i = 0; i < 3; i++) await post(ghost, 'whatever passphrase here').expect(401);
        await post(ghost, 'whatever passphrase here').expect(429);
      } finally {
        await limited.close();
      }
    });
  });

  describe('refresh rotation', () => {
    const mobileSession = async (tag: string) => {
      const email = await activeAccount(tag);
      const installation = randomUUID();
      const res = await login(email, 'android', installation).expect(200);
      return {
        email,
        installation,
        sessionId: res.body.session_id as string,
        access: res.body.access_token as string,
        refresh: res.body.refresh_token as string,
      };
    };

    it('rotates: new pair works; the successor is single-use too', async () => {
      const s = await mobileSession('rotate');
      const r1 = await refresh(s.refresh, s.installation).expect(200);
      expect(r1.body.refresh_token).not.toBe(s.refresh);
      await me(r1.body.access_token as string).expect(200);
      const r2 = await refresh(r1.body.refresh_token as string, s.installation).expect(200);
      expect(r2.body.refresh_token).not.toBe(r1.body.refresh_token);
    });

    it('an immediate retry of the same token (lost response) gets the SAME successor', async () => {
      const s = await mobileSession('retry');
      const first = await refresh(s.refresh, s.installation).expect(200);
      const retry = await refresh(s.refresh, s.installation).expect(200);
      expect(retry.body.refresh_token).toBe(first.body.refresh_token);
      await refresh(retry.body.refresh_token as string, s.installation).expect(200);
    });

    it('concurrent refreshes with one token create exactly one successor', async () => {
      const s = await mobileSession('concurrent');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => refresh(s.refresh, s.installation)),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(results.map((r) => r.body.refresh_token as string)).size).toBe(1);
      expect(
        await owner.refreshCredential.count({ where: { sessionId: s.sessionId, generation: 1 } }),
      ).toBe(1);
    });

    it('reuse of a consumed token after the retry window revokes the whole session', async () => {
      const s = await mobileSession('reuse');
      const r1 = await refresh(s.refresh, s.installation).expect(200);
      // Simulate the 10 s window passing.
      const redis = app.get(RedisService).client;
      const keys = await redis.keys('karen:refresh-replay:*');
      if (keys.length > 0) await redis.del(...keys);
      await refresh(s.refresh, s.installation).expect(401);
      // The thief's replay killed the session: the legitimate successor no longer works either.
      await me(r1.body.access_token as string).expect(401);
      await refresh(r1.body.refresh_token as string, s.installation).expect(401);
      const session = await owner.session.findUniqueOrThrow({ where: { id: s.sessionId } });
      expect(session.revokeReason).toBe('refresh_reuse');
      const audit = await owner.auditEvent.findFirst({
        where: { subjectId: s.sessionId, action: 'identity.refresh.reuse_detected' },
      });
      expect(audit?.outcome).toBe('DENIED');
    });

    it('a refresh token presented from another installation revokes the session', async () => {
      const s = await mobileSession('steal');
      await refresh(s.refresh, randomUUID()).expect(401);
      await refresh(s.refresh, s.installation).expect(401);
      await me(s.access).expect(401);
    });

    it('rejects malformed, foreign-kind and unknown refresh tokens', async () => {
      await refresh('nope', randomUUID()).expect(401);
      await refresh(`kss_${'A'.repeat(43)}`, randomUUID()).expect(401);
      await refresh(`krt_${'A'.repeat(43)}`, randomUUID()).expect(401);
    });
  });

  describe('logout and revocation', () => {
    it('logout revokes immediately: access and refresh stop working', async () => {
      const email = await activeAccount('logout');
      const installation = randomUUID();
      const res = await login(email, 'android', installation).expect(200);
      const access = res.body.access_token as string;
      await http().post('/v1/auth/logout').set('authorization', `Bearer ${access}`).expect(200);
      await me(access).expect(401);
      await refresh(res.body.refresh_token as string, installation).expect(401);
    });

    it('logout-all ends every session on every device', async () => {
      const email = await activeAccount('logoutall');
      const a = await login(email, 'android').expect(200);
      const b = await login(email, 'web').expect(200);
      const r = await http()
        .post('/v1/auth/logout-all')
        .set('authorization', `Bearer ${a.body.access_token as string}`)
        .expect(200);
      expect(r.body.revoked_sessions).toBe(2);
      await me(b.body.session_token as string).expect(401);
      await me(a.body.access_token as string).expect(401);
    });

    it('lists own sessions/devices and revokes them; another user’s ids are 404', async () => {
      const email = await activeAccount('list');
      const a = await login(email, 'android').expect(200);
      const b = await login(email, 'web').expect(200);
      const auth = `Bearer ${a.body.access_token as string}`;
      const list = await http().get('/v1/me/sessions').set('authorization', auth).expect(200);
      const sessions = list.body.items as { id: string; current: boolean }[];
      expect(sessions).toHaveLength(2);
      expect(sessions.find((x) => x.current)?.id).toBe(a.body.session_id);
      const devices = (await http().get('/v1/me/devices').set('authorization', auth).expect(200))
        .body.items as { id: string; platform: string }[];
      expect(devices).toHaveLength(2);

      const other = await login(await activeAccount('other'), 'android').expect(200);
      await http()
        .delete(`/v1/me/sessions/${other.body.session_id as string}`)
        .set('authorization', auth)
        .expect(404);
      await me(other.body.access_token as string).expect(200);

      await http()
        .delete(`/v1/me/sessions/${b.body.session_id as string}`)
        .set('authorization', auth)
        .expect(200);
      await me(b.body.session_token as string).expect(401);
      const webDevice = devices.find((d) => d.platform === 'web');
      const androidDevice = devices.find((d) => d.platform === 'android');
      await http()
        .delete(`/v1/me/devices/${androidDevice?.id ?? 'missing'}`)
        .set('authorization', auth)
        .expect(200);
      await me(a.body.access_token as string).expect(401);
      expect(webDevice).toBeDefined();
    });

    it('a password reset signs out every session', async () => {
      const email = await activeAccount('reset');
      const a = await login(email, 'android').expect(200);
      const forgot = await http().post('/v1/auth/password/forgot').send({ email }).expect(202);
      const code = await lastCode(email, 'auth.password_reset');
      await http()
        .post('/v1/auth/password/reset')
        .send({ challenge_handle: forgot.body.challenge_handle, code, new_password: NEW_PW })
        .expect(200);
      await me(a.body.access_token as string).expect(401);
      await login(email, 'android', randomUUID(), NEW_PW).expect(200);
    });

    it('locking or suspending an account revokes its sessions in the same transaction', async () => {
      const email = await activeAccount('suspend');
      const a = await login(email, 'web').expect(200);
      await app.get(AccountService).transitionStatus(a.body.user_id as string, 'SUSPENDED', {
        actorType: 'STAFF',
        actorRef: 'test-staff',
        reasonCode: 'abuse_report',
      });
      await me(a.body.session_token as string).expect(401);
      const s = await owner.session.findUniqueOrThrow({
        where: { id: a.body.session_id as string },
      });
      expect(s.revokeReason).toBe('account_status');
    });

    it('expired web sessions (idle or absolute) are rejected', async () => {
      const email = await activeAccount('idle');
      const a = await login(email, 'web').expect(200);
      await owner.session.update({
        where: { id: a.body.session_id as string },
        data: { idleExpiresAt: new Date(Date.now() - 1000) },
      });
      await me(a.body.session_token as string).expect(401);
    });

    it('rejects a valid token whose session belongs to a different user (no confusion)', async () => {
      const a = await login(await activeAccount('mixa'), 'android').expect(200);
      const b = await login(await activeAccount('mixb'), 'android').expect(200);
      // Forge nothing: just check a's token never resolves to b's data and vice versa.
      const meA = await me(a.body.access_token as string).expect(200);
      const meB = await me(b.body.access_token as string).expect(200);
      expect(meA.body.id).not.toBe(meB.body.id);
      await owner.session.update({
        where: { id: a.body.session_id as string },
        data: { revokedAt: new Date(), revokeReason: 'logout' },
      });
      await me(a.body.access_token as string).expect(401);
      await me(b.body.access_token as string).expect(200);
    });
  });
});
