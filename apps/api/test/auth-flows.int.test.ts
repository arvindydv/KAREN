import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { AccountService } from '../src/identity/account.service.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { MemoryMailTransport } from '../src/infrastructure/mail/mail-transport.js';
import { MAIL_TRANSPORT, MailService } from '../src/infrastructure/mail/mail.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';

/**
 * Phase 01 / M2 auth flows over HTTP against real PostgreSQL + Redis. E-mail goes to the
 * in-memory transport (no real mail is sent by tests).
 */
const STRONG = 'mango monsoon bicycle lantern';
const NEW_PW = 'velvet harbour quietly folds paper';
const addr = (tag: string) =>
  `m2.${tag}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@example.test`;

async function start(overrides: Record<string, string> = {}) {
  const app = await createApp(testEnv({ EMAIL_SEND_LIMIT_PER_HOUR: '50', ...overrides }), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  // Like the load balancer: send traffic only once Redis (fail-closed limiter) is ready.
  await request(app.getHttpServer()).get('/health/ready').expect(200);
  return app;
}

describe('auth flows (integration)', () => {
  let app: NestFastifyApplication;
  let mailbox: MemoryMailTransport;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const http = () => request(app.getHttpServer());

  const lastCode = async (to: string, template: string): Promise<string> => {
    await app.get(MailService).drain();
    const mail = mailbox
      .to(to)
      .filter((m) => m.template === template)
      .at(-1);
    if (!mail) throw new Error(`no ${template} mail for ${to}`);
    const code = /\b(\d{6})\b/.exec(mail.text)?.[1];
    if (!code) throw new Error('no code in mail');
    return code;
  };
  const register = (email: string, password = STRONG) =>
    http().post('/v1/auth/register').send({ email, password });
  const userIdOf = async (email: string) =>
    (await owner.userEmail.findUniqueOrThrow({ where: { emailCanonical: email.toLowerCase() } }))
      .userId;
  const wrongCode = (code: string) => (code === '000000' ? '000001' : '000000');

  beforeAll(async () => {
    app = await start();
    mailbox = app.get<MemoryMailTransport>(MAIL_TRANSPORT);
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('registration + e-mail verification', () => {
    it('registers, e-mails a code, verifies once, and activates the account', async () => {
      const email = addr('reg');
      const res = await register(email).expect(202);
      expect(Object.keys(res.body as object).sort()).toEqual([
        'challenge_handle',
        'code_length',
        'delivery',
        'expires_at',
      ]);
      expect(res.body.challenge_handle).toMatch(/^kev_/);
      const code = await lastCode(email, 'auth.email_verification');
      const userId = await userIdOf(email);
      expect((await owner.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe(
        'PENDING_VERIFICATION',
      );

      const bad = await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: res.body.challenge_handle, code: wrongCode(code) })
        .expect(400);
      expect(bad.body.error.code).toBe('CHALLENGE_INVALID');

      const ok = await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: res.body.challenge_handle, code })
        .expect(200);
      expect(ok.body).toEqual({ status: 'email_verified', next: 'sign_in' });
      const user = await owner.user.findUniqueOrThrow({
        where: { id: userId },
        include: { email: true },
      });
      expect(user.status).toBe('ACTIVE');
      expect(user.email?.verifiedAt).toBeInstanceOf(Date);

      // Replay of a used code fails.
      await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: res.body.challenge_handle, code })
        .expect(400);
      // The code is never stored; only verifiers are.
      const rows = await owner.verificationChallenge.findMany({ where: { userId } });
      expect(JSON.stringify(rows)).not.toContain(code);
      expect(rows[0]?.codeMac).toMatch(/^hmac-sha256:/);
      const audit = await owner.auditEvent.findMany({ where: { subjectId: userId } });
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining(['identity.account.created', 'identity.email.verified']),
      );
      expect(JSON.stringify(audit)).not.toContain(code);
      expect(JSON.stringify(audit)).not.toContain(email.toLowerCase());
    });

    it('an existing address gets an identical response, a notice mail, and an unusable handle', async () => {
      const email = addr('dup');
      const first = await register(email).expect(202);
      const second = await register(email.toUpperCase(), 'another strong passphrase here').expect(
        202,
      );
      expect(Object.keys(second.body as object).sort()).toEqual(
        Object.keys(first.body as object).sort(),
      );
      expect(second.body.challenge_handle).toMatch(/^kev_[A-Za-z0-9_-]{43}$/);
      await app.get(MailService).drain();
      expect(mailbox.to(email).map((m) => m.template)).toEqual([
        'auth.email_verification',
        'auth.account_exists',
      ]);
      const code = await lastCode(email, 'auth.email_verification');
      // The real code does not work with the decoy handle.
      await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: second.body.challenge_handle, code })
        .expect(400);
      expect(await owner.userEmail.count({ where: { emailCanonical: email } })).toBe(1);
    });

    it('rejects weak passwords and malformed input without creating anything', async () => {
      const email = addr('weak');
      const weak = await register(email, 'Password@12345678').expect(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');
      expect(weak.body.error.details).toEqual(
        expect.arrayContaining([{ path: 'password', message: 'COMMONLY_USED' }]),
      );
      expect(JSON.stringify(weak.body)).not.toContain('Password@12345678');
      const badEmail = await register('not-an-email').expect(400);
      expect(badEmail.body.error.code).toBe('VALIDATION_FAILED');
      await http()
        .post('/v1/auth/register')
        .send({ email, password: STRONG, role: 'security_admin' })
        .expect(400); // strict schema: no mass assignment
      await http()
        .post('/v1/auth/register')
        .send({ email, password: STRONG, timezone: 'Mars/Olympus' })
        .expect(400);
      expect(await owner.userEmail.count({ where: { emailCanonical: email } })).toBe(0);
    });

    it('closes a challenge after 5 wrong codes, even for the right code afterwards', async () => {
      const email = addr('brute');
      const res = await register(email).expect(202);
      const code = await lastCode(email, 'auth.email_verification');
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/v1/auth/verify-email')
          .send({ challenge_handle: res.body.challenge_handle, code: wrongCode(code) })
          .expect(400);
      }
      await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: res.body.challenge_handle, code })
        .expect(400);
      const c = await owner.verificationChallenge.findFirstOrThrow({
        where: { userId: await userIdOf(email) },
      });
      expect(c.closeReason).toBe('attempts_exhausted');
    });

    it('expired codes fail', async () => {
      const email = addr('exp');
      const res = await register(email).expect(202);
      const code = await lastCode(email, 'auth.email_verification');
      await owner.verificationChallenge.updateMany({
        where: { userId: await userIdOf(email) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: res.body.challenge_handle, code })
        .expect(400);
    });

    it('resend rotates the code (old one dies) and stops after the send cap', async () => {
      const email = addr('resend');
      const res = await register(email).expect(202);
      const handle = res.body.challenge_handle as string;
      const oldCode = await lastCode(email, 'auth.email_verification');
      await http()
        .post('/v1/auth/challenges/resend')
        .send({ challenge_handle: handle })
        .expect(202);
      const newCode = await lastCode(email, 'auth.email_verification');
      await http()
        .post('/v1/auth/verify-email')
        .send({
          challenge_handle: handle,
          code: oldCode === newCode ? wrongCode(newCode) : oldCode,
        })
        .expect(400);
      for (let i = 0; i < 6; i++) {
        await http()
          .post('/v1/auth/challenges/resend')
          .send({ challenge_handle: handle })
          .expect(202);
      }
      await app.get(MailService).drain();
      // 1 initial + 4 resends = the per-challenge cap of 5.
      expect(
        mailbox.to(email).filter((m) => m.template === 'auth.email_verification'),
      ).toHaveLength(5);
      // Unknown handle: same response, nothing sent.
      const unknown = await http()
        .post('/v1/auth/challenges/resend')
        .send({ challenge_handle: `kev_${'A'.repeat(43)}` })
        .expect(202);
      expect(unknown.body.code_length).toBe(6);
    });
  });

  describe('forgot / reset password', () => {
    const activeAccount = async (tag: string) => {
      const email = addr(tag);
      const res = await register(email).expect(202);
      const code = await lastCode(email, 'auth.email_verification');
      await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: res.body.challenge_handle, code })
        .expect(200);
      return email;
    };
    const forgot = async (email: string) => {
      const res = await http().post('/v1/auth/password/forgot').send({ email }).expect(202);
      return res.body.challenge_handle as string;
    };

    it('unknown addresses get an identical response and no mail', async () => {
      const email = addr('ghost');
      const res = await http().post('/v1/auth/password/forgot').send({ email }).expect(202);
      expect(res.body).toMatchObject({ code_length: 6, delivery: 'email' });
      expect(res.body.challenge_handle).toMatch(/^kpr_[A-Za-z0-9_-]{43}$/);
      await app.get(MailService).drain();
      expect(mailbox.to(email)).toHaveLength(0);
    });

    it('resets the password with the code, rejects weak passwords without burning it, and notifies', async () => {
      const email = await activeAccount('reset');
      const handle = await forgot(email);
      const code = await lastCode(email, 'auth.password_reset');
      const weak = await http()
        .post('/v1/auth/password/reset')
        .send({ challenge_handle: handle, code, new_password: 'aaaaaaaaaaaaaaaaaaaa' })
        .expect(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');
      const ok = await http()
        .post('/v1/auth/password/reset')
        .send({ challenge_handle: handle, code, new_password: NEW_PW })
        .expect(200);
      expect(ok.body).toEqual({ status: 'password_reset', next: 'sign_in' });
      const accounts = app.get(AccountService);
      expect((await accounts.checkPasswordCredential(email, NEW_PW)).outcome).toBe('VALID');
      expect((await accounts.checkPasswordCredential(email, STRONG)).outcome).toBe('INVALID');
      await app.get(MailService).drain();
      expect(mailbox.to(email).at(-1)?.template).toBe('auth.password_changed');
      // Replay fails.
      await http()
        .post('/v1/auth/password/reset')
        .send({ challenge_handle: handle, code, new_password: 'yet another fine passphrase' })
        .expect(400);
    });

    it('a reset handle cannot be used to verify an e-mail (purpose separation)', async () => {
      const email = await activeAccount('xpurpose');
      const handle = await forgot(email);
      const code = await lastCode(email, 'auth.password_reset');
      await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: handle, code })
        .expect(400);
    });

    it('concurrent resets with the same code: exactly one succeeds', async () => {
      const email = await activeAccount('race');
      const handle = await forgot(email);
      const code = await lastCode(email, 'auth.password_reset');
      const results = await Promise.all(
        [
          'first fine passphrase one',
          'second fine passphrase two',
          'third fine passphrase three',
        ].map((pw) =>
          http()
            .post('/v1/auth/password/reset')
            .send({ challenge_handle: handle, code, new_password: pw }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    });

    it('pre-account takeover: the mailbox owner reclaims an address an attacker registered', async () => {
      const email = addr('prehijack');
      const attacker = await register(email, 'attacker chosen passphrase').expect(202);
      const attackerCode = await lastCode(email, 'auth.email_verification');
      // The real owner never got the attacker's handle; they use "forgot password".
      const handle = await forgot(email);
      const code = await lastCode(email, 'auth.password_reset');
      await http()
        .post('/v1/auth/password/reset')
        .send({ challenge_handle: handle, code, new_password: NEW_PW })
        .expect(200);
      const accounts = app.get(AccountService);
      expect(await accounts.checkPasswordCredential(email, 'attacker chosen passphrase')).toEqual({
        outcome: 'INVALID',
      });
      const user = await owner.user.findUniqueOrThrow({
        where: { id: await userIdOf(email) },
        include: { email: true },
      });
      expect(user.status).toBe('ACTIVE');
      expect(user.email?.verifiedAt).toBeInstanceOf(Date);
      // The attacker's pending verification is dead.
      await http()
        .post('/v1/auth/verify-email')
        .send({ challenge_handle: attacker.body.challenge_handle, code: attackerCode })
        .expect(400);
    });

    it('a LOCKED account is recovered to ACTIVE by a reset; SUSPENDED accounts get no code', async () => {
      const locked = await activeAccount('locked');
      await owner.user.update({
        where: { id: await userIdOf(locked) },
        data: { status: 'LOCKED' },
      });
      const handle = await forgot(locked);
      const code = await lastCode(locked, 'auth.password_reset');
      await http()
        .post('/v1/auth/password/reset')
        .send({ challenge_handle: handle, code, new_password: NEW_PW })
        .expect(200);
      expect(
        (await owner.user.findUniqueOrThrow({ where: { id: await userIdOf(locked) } })).status,
      ).toBe('ACTIVE');

      const suspended = await activeAccount('susp');
      await owner.user.update({
        where: { id: await userIdOf(suspended) },
        data: { status: 'SUSPENDED' },
      });
      await forgot(suspended);
      await app.get(MailService).drain();
      expect(mailbox.to(suspended).some((m) => m.template === 'auth.password_reset')).toBe(false);
    });
  });

  describe('per-address e-mail budget', () => {
    it('caps mails per address per hour but keeps the response identical', async () => {
      const limited = await start({ EMAIL_SEND_LIMIT_PER_HOUR: '2' });
      try {
        const box = limited.get<MemoryMailTransport>(MAIL_TRANSPORT);
        const email = addr('budget');
        await request(limited.getHttpServer())
          .post('/v1/auth/register')
          .send({ email, password: STRONG })
          .expect(202);
        for (let i = 0; i < 3; i++) {
          const res = await request(limited.getHttpServer())
            .post('/v1/auth/password/forgot')
            .send({ email })
            .expect(202);
          expect(res.body.code_length).toBe(6);
        }
        await limited.get(MailService).drain();
        expect(box.to(email)).toHaveLength(2);
      } finally {
        await limited.close();
      }
    });
  });
});
