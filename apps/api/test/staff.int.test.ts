import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { StaffAuthService } from '../src/staff/staff-auth.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { harness, startApp, uniqueEmail } from './support.js';
import { SoftwareAuthenticator } from './webauthn-authenticator.js';

/**
 * Phase 01 / M8: first-party staff realm with mandatory WebAuthn (ADR-0017), exercised with a
 * byte-accurate software authenticator against the real verification code.
 */
const ORIGIN = 'http://localhost:3001';
const RP_ID = 'localhost';
const STAFF_PW = 'granite lighthouse quietly hums';

describe('staff realm (integration)', () => {
  let app: NestFastifyApplication;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const h = harness(() => app);
  const http = () => h.http();

  /** Enrolls a key with an enrollment token; returns the authenticator. */
  async function enroll(token: string) {
    const key = new SoftwareAuthenticator(RP_ID, ORIGIN);
    const opts = await http()
      .post('/v1/staff/auth/enroll/options')
      .send({ enrollment_token: token })
      .expect(200);
    await http()
      .post('/v1/staff/auth/enroll/verify')
      .send({
        ceremony_handle: opts.body.ceremony_handle,
        credential: key.register(opts.body.options),
        name: 'Test key',
        password: STAFF_PW,
      })
      .expect(204);
    return key;
  }

  async function login(email: string, key: SoftwareAuthenticator) {
    const opts = await http()
      .post('/v1/staff/auth/login/options')
      .send({ email, password: STAFF_PW })
      .expect(200);
    const res = await http()
      .post('/v1/staff/auth/login/verify')
      .send({
        ceremony_handle: opts.body.ceremony_handle,
        credential: key.authenticate(opts.body.options),
      })
      .expect(200);
    return {
      auth: `Bearer ${res.body.session_token as string}`,
      me: res.body.me as { id: string; permissions: string[] },
    };
  }

  let adminEmail: string;
  let adminKey: SoftwareAuthenticator;
  let admin: { auth: string; me: { id: string; permissions: string[] } };

  beforeAll(async () => {
    // A clean staff realm for this suite (test database only).
    await owner.$executeRawUnsafe('TRUNCATE staff.accounts CASCADE');
    app = await startApp();
    adminEmail = uniqueEmail('staff-admin');
    const boot = await app.get(StaffAuthService).bootstrapFirstAdmin(adminEmail, 'Test Admin');
    adminKey = await enroll(boot.enrollmentToken);
    admin = await login(adminEmail, adminKey);
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('bootstrap and enrollment', () => {
    it('bootstrap works once only; enrollment links are single-use', async () => {
      await expect(
        app.get(StaffAuthService).bootstrapFirstAdmin(uniqueEmail('second'), 'Second'),
      ).rejects.toThrow(/already exist/);
      expect(admin.me.permissions).toEqual(expect.arrayContaining(['staff:manage', 'audit:read']));
      const invite = await http()
        .post('/v1/staff/invitations')
        .set('authorization', admin.auth)
        .send({ email: uniqueEmail('once'), display_name: 'Once', roles: ['support_agent'] })
        .expect(201);
      await enroll(invite.body.enrollment_token as string);
      await http()
        .post('/v1/staff/auth/enroll/options')
        .send({ enrollment_token: invite.body.enrollment_token })
        .expect(400);
    });

    it('there is no public staff sign-up route', async () => {
      await http().post('/v1/staff/auth/register').send({ email: 'x@example.test' }).expect(404);
      await http().post('/v1/staff/accounts').send({ email: 'x@example.test' }).expect(404);
    });
  });

  describe('sign-in requires password AND a valid security-key assertion', () => {
    it('rejects wrong password, unknown e-mail, wrong origin, missing UV, replayed ceremonies and cloned keys', async () => {
      await http()
        .post('/v1/staff/auth/login/options')
        .send({ email: adminEmail, password: 'not the right passphrase' })
        .expect(401);
      await http()
        .post('/v1/staff/auth/login/options')
        .send({ email: uniqueEmail('ghost'), password: STAFF_PW })
        .expect(401);

      const attempt = async (tamper: Parameters<SoftwareAuthenticator['authenticate']>[1]) => {
        const o = await http()
          .post('/v1/staff/auth/login/options')
          .send({ email: adminEmail, password: STAFF_PW })
          .expect(200);
        return http()
          .post('/v1/staff/auth/login/verify')
          .send({
            ceremony_handle: o.body.ceremony_handle,
            credential: adminKey.authenticate(o.body.options, tamper),
          });
      };
      expect((await attempt({ origin: 'https://evil.example' })).status).toBe(401);
      expect((await attempt({ userVerified: false })).status).toBe(401);
      // A cloned authenticator presents a counter that does not move forward.
      expect((await attempt({ counter: 1 })).status).toBe(401);

      const o = await http()
        .post('/v1/staff/auth/login/options')
        .send({ email: adminEmail, password: STAFF_PW })
        .expect(200);
      const credential = adminKey.authenticate(o.body.options);
      await http()
        .post('/v1/staff/auth/login/verify')
        .send({ ceremony_handle: o.body.ceremony_handle, credential })
        .expect(200);
      // Same ceremony handle again → single use.
      await http()
        .post('/v1/staff/auth/login/verify')
        .send({ ceremony_handle: o.body.ceremony_handle, credential })
        .expect(401);

      // An attacker's own key cannot answer the admin's challenge.
      const o2 = await http()
        .post('/v1/staff/auth/login/options')
        .send({ email: adminEmail, password: STAFF_PW })
        .expect(200);
      const stranger = new SoftwareAuthenticator(RP_ID, ORIGIN);
      await http()
        .post('/v1/staff/auth/login/verify')
        .send({
          ceremony_handle: o2.body.ceremony_handle,
          credential: stranger.authenticate(o2.body.options),
        })
        .expect(401);
      const rejected = await owner.auditEvent.count({
        where: { actorRef: admin.me.id, action: 'staff.webauthn.rejected' },
      });
      expect(rejected).toBeGreaterThanOrEqual(3);
    });
  });

  describe('realm separation', () => {
    it('staff and consumer credentials are never interchangeable', async () => {
      const consumer = await h.signIn(await h.activeAccount('realm'));
      await http().get('/v1/staff/auth/me').set('authorization', consumer.auth).expect(401);
      await http().get('/v1/admin/system/status').set('authorization', consumer.auth).expect(401);
      await http().get('/v1/me').set('authorization', admin.auth).expect(401);
      await http().get('/v1/me/profile').set('authorization', admin.auth).expect(401);
    });

    it('the two DB roles cannot read each other’s tables', async () => {
      const consumerDb = new PrismaService(testEnv());
      const staffDb = new PrismaService(
        testEnv({
          STAFF_AUTH_ENABLED: 'false',
          DATABASE_URL: testEnv().STAFF_DATABASE_URL as string,
        }),
      );
      try {
        await expect(
          consumerDb.$queryRawUnsafe('SELECT count(*) FROM staff.accounts'),
        ).rejects.toThrow(/permission denied/);
        await expect(
          staffDb.$queryRawUnsafe('SELECT count(*) FROM identity.users'),
        ).rejects.toThrow(/permission denied/);
        await expect(
          staffDb.$queryRawUnsafe('SELECT count(*) FROM identity.password_credentials'),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await Promise.all([consumerDb.$disconnect(), staffDb.$disconnect()]);
      }
    });
  });

  describe('least privilege, step-up, JIT elevation and emergency disable', () => {
    let agentEmail: string;
    let agentKey: SoftwareAuthenticator;
    let agent: { auth: string; me: { id: string; permissions: string[] } };

    beforeAll(async () => {
      agentEmail = uniqueEmail('agent');
      const invite = await http()
        .post('/v1/staff/invitations')
        .set('authorization', admin.auth)
        .send({ email: agentEmail, display_name: 'Support Agent', roles: ['support_agent'] })
        .expect(201);
      agentKey = await enroll(invite.body.enrollment_token as string);
      agent = await login(agentEmail, agentKey);
    });

    it('a support agent can do support work but not administration', async () => {
      await http().get('/v1/admin/system/status').set('authorization', agent.auth).expect(200);
      const denied = await http()
        .post('/v1/staff/invitations')
        .set('authorization', agent.auth)
        .send({ email: uniqueEmail('nope'), display_name: 'Nope', roles: ['security_admin'] })
        .expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
    });

    it('user-status lookups need an access reason, reveal status only, and are audited', async () => {
      const consumer = await h.signIn(await h.activeAccount('looked-up'));
      await http()
        .get(`/v1/staff/users/${consumer.userId}/status`)
        .set('authorization', agent.auth)
        .expect(400);
      const ok = await http()
        .get(`/v1/staff/users/${consumer.userId}/status`)
        .set('authorization', agent.auth)
        .set('x-access-reason', 'Ticket SUP-1234: user cannot sign in')
        .expect(200);
      expect(Object.keys(ok.body as object).sort()).toEqual(['created_at', 'status', 'user_id']);
      const audit = await owner.auditEvent.findFirst({
        where: {
          actorRef: agent.me.id,
          action: 'staff.user_status.read',
          subjectId: consumer.userId,
        },
      });
      expect(audit).toMatchObject({ actorType: 'STAFF', reasonCode: 'support_access' });
      // An admin has no user-data permission at all.
      await http()
        .get(`/v1/staff/users/${consumer.userId}/status`)
        .set('authorization', admin.auth)
        .set('x-access-reason', 'Ticket SUP-1234: user cannot sign in')
        .expect(403);
    });

    it('sensitive actions need a fresh security-key assertion (step-up)', async () => {
      await owner.staffSession.updateMany({
        where: { staffId: admin.me.id },
        data: { stepUpAt: new Date(Date.now() - 3_600_000) },
      });
      const stale = await http()
        .post('/v1/staff/invitations')
        .set('authorization', admin.auth)
        .send({ email: uniqueEmail('stepup'), display_name: 'Step Up', roles: ['ops_admin'] })
        .expect(403);
      expect(stale.body.error).toMatchObject({
        code: 'STEP_UP_REQUIRED',
        next_options: ['STEP_UP'],
      });
      const o = await http()
        .post('/v1/staff/auth/step-up/options')
        .set('authorization', admin.auth)
        .expect(200);
      await http()
        .post('/v1/staff/auth/step-up/verify')
        .set('authorization', admin.auth)
        .send({
          ceremony_handle: o.body.ceremony_handle,
          credential: adminKey.authenticate(o.body.options),
        })
        .expect(200);
      await http()
        .post('/v1/staff/invitations')
        .set('authorization', admin.auth)
        .send({ email: uniqueEmail('stepup2'), display_name: 'Step Up', roles: ['ops_admin'] })
        .expect(201);
      // Another staff member's step-up ceremony cannot be redeemed on this session.
      const theirs = await http()
        .post('/v1/staff/auth/step-up/options')
        .set('authorization', agent.auth)
        .expect(200);
      await http()
        .post('/v1/staff/auth/step-up/verify')
        .set('authorization', admin.auth)
        .send({
          ceremony_handle: theirs.body.ceremony_handle,
          credential: adminKey.authenticate(theirs.body.options),
        })
        .expect(401);
    });

    it('JIT elevation: requested with reason + ticket, approved by someone else, expires', async () => {
      const req = await http()
        .post('/v1/staff/elevations')
        .set('authorization', agent.auth)
        .send({
          role: 'ops_admin',
          reason: 'Incident INC-42 needs a flag flip',
          ticket_ref: 'INC-42',
          duration_minutes: 30,
        })
        .expect(201);
      expect(req.body.status).toBe('pending');
      // Admin elevates self → cannot approve own request.
      const own = await http()
        .post('/v1/staff/elevations')
        .set('authorization', admin.auth)
        .send({
          role: 'support_agent',
          reason: 'Testing two-person rule',
          ticket_ref: 'SEC-1',
          duration_minutes: 5,
        })
        .expect(201);
      await http()
        .post(`/v1/staff/elevations/${own.body.id as string}/decision`)
        .set('authorization', admin.auth)
        .send({ decision: 'approve' })
        .expect(403);

      await http()
        .post(`/v1/staff/elevations/${req.body.id as string}/decision`)
        .set('authorization', admin.auth)
        .send({ decision: 'approve' })
        .expect(200);
      const elevated = await http()
        .get('/v1/staff/auth/me')
        .set('authorization', agent.auth)
        .expect(200);
      expect(elevated.body).toMatchObject({ elevated_roles: ['ops_admin'] });
      expect(elevated.body.permissions).toContain('flags:write');

      await owner.staffElevation.update({
        where: { id: req.body.id as string },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const after = await http()
        .get('/v1/staff/auth/me')
        .set('authorization', agent.auth)
        .expect(200);
      expect(after.body.elevated_roles).toEqual([]);
      expect(after.body.permissions).not.toContain('flags:write');
    });

    it('guards against self-service and lock-out, and disables accounts instantly', async () => {
      await http()
        .put(`/v1/staff/accounts/${admin.me.id}/roles/ops_admin`)
        .set('authorization', admin.auth)
        .expect(403);
      await http()
        .delete(`/v1/staff/accounts/${admin.me.id}/roles/security_admin`)
        .set('authorization', admin.auth)
        .expect(403);
      await http()
        .post(`/v1/staff/accounts/${agent.me.id}/disable`)
        .set('authorization', admin.auth)
        .send({ reason: 'Lost laptop reported in SEC-77' })
        .expect(204);
      await http().get('/v1/staff/auth/me').set('authorization', agent.auth).expect(401);
      await http()
        .post('/v1/staff/auth/login/options')
        .send({ email: agentEmail, password: STAFF_PW })
        .expect(401);
    });

    it('staff sessions expire when idle', async () => {
      const s = await login(adminEmail, adminKey);
      await owner.staffSession.updateMany({
        where: {
          staffId: admin.me.id,
          revokedAt: null,
          lastSeenAt: { gte: new Date(Date.now() - 60_000) },
        },
        data: { idleExpiresAt: new Date(Date.now() - 1000) },
      });
      await http().get('/v1/staff/auth/me').set('authorization', s.auth).expect(401);
      admin = await login(adminEmail, adminKey);
    });
  });

  it('with the staff realm disabled, no staff or admin route exists', async () => {
    const off = await startApp({ STAFF_AUTH_ENABLED: 'false' });
    try {
      await request(off.getHttpServer()).post('/v1/staff/auth/login/options').send({}).expect(404);
      await request(off.getHttpServer()).get('/v1/admin/system/status').expect(404);
    } finally {
      await off.close();
    }
  });
});
