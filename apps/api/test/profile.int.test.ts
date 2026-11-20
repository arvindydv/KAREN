import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { PW, harness, startApp, uniqueEmail } from './support.js';

/** Phase 01 / M4: profile, preferences, places, e-mail and password change (integration). */
describe('profile & account settings (integration)', () => {
  let app: NestFastifyApplication;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const h = harness(() => app);
  const NEW_PW = 'velvet harbour quietly folds paper';

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('profile', () => {
    it('reads with an ETag and updates only with a matching If-Match', async () => {
      const s = await h.signIn(await h.activeAccount('profile'));
      const got = await h.http().get('/v1/me/profile').set('authorization', s.auth).expect(200);
      expect(got.headers.etag).toBe(`"${got.body.version as number}"`);
      expect(got.body).toMatchObject({ email_verified: true, account_status: 'ACTIVE' });

      const patch = {
        preferred_name: 'Asha',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        country: 'IN',
      };
      const none = await h
        .http()
        .patch('/v1/me/profile')
        .set('authorization', s.auth)
        .send(patch)
        .expect(428);
      expect(none.body.error.code).toBe('PRECONDITION_REQUIRED');
      const ok = await h
        .http()
        .patch('/v1/me/profile')
        .set('authorization', s.auth)
        .set('if-match', got.headers.etag as string)
        .send(patch)
        .expect(200);
      expect(ok.body).toMatchObject({
        preferred_name: 'Asha',
        currency: 'INR',
        version: (got.body.version as number) + 1,
      });
      // The version they read is now stale.
      const stale = await h
        .http()
        .patch('/v1/me/profile')
        .set('authorization', s.auth)
        .set('if-match', got.headers.etag as string)
        .send({ preferred_name: 'Overwrite' })
        .expect(412);
      expect(stale.body.error.code).toBe('PRECONDITION_FAILED');
      const audit = await owner.auditEvent.findFirst({
        where: { subjectId: s.userId, action: 'identity.profile.updated' },
      });
      expect(audit?.metadata).toEqual({ fields: 'country,currency,preferred_name,timezone' });
      expect(JSON.stringify(audit)).not.toContain('Asha');
    });

    it('concurrent writes with the same version: exactly one wins', async () => {
      const s = await h.signIn(await h.activeAccount('race'));
      const v = (await h.http().get('/v1/me/profile').set('authorization', s.auth)).headers
        .etag as string;
      const results = await Promise.all(
        ['One', 'Two', 'Three'].map((n) =>
          h
            .http()
            .patch('/v1/me/profile')
            .set('authorization', s.auth)
            .set('if-match', v)
            .send({ preferred_name: n }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 412, 412]);
    });

    it('refuses mass assignment, control characters and unknown zones/currencies', async () => {
      const s = await h.signIn(await h.activeAccount('mass'));
      const v = (await h.http().get('/v1/me/profile').set('authorization', s.auth)).headers
        .etag as string;
      const send = (body: object) =>
        h.http().patch('/v1/me/profile').set('authorization', s.auth).set('if-match', v).send(body);
      await send({ account_status: 'ACTIVE' }).expect(400);
      await send({ email: 'x@example.test' }).expect(400);
      await send({ id: s.userId }).expect(400);
      await send({ display_name: 'Bad\u0007Name' }).expect(400);
      await send({ timezone: 'Mars/Olympus' }).expect(400);
      await send({ currency: 'ZZZ' }).expect(400);
      await send({}).expect(400);
    });
  });

  describe('preferences', () => {
    it('defaults are conservative and saved with optimistic concurrency', async () => {
      const s = await h.signIn(await h.activeAccount('prefs'));
      const d = await h.http().get('/v1/me/preferences').set('authorization', s.auth).expect(200);
      expect(d.body).toMatchObject({ notify_product_email: false, notify_push: false, version: 0 });
      const first = await Promise.all(
        ['dark', 'light'].map((theme) =>
          h
            .http()
            .patch('/v1/me/preferences')
            .set('authorization', s.auth)
            .set('if-match', '"0"')
            .send({ theme }),
        ),
      );
      expect(first.map((r) => r.status).sort()).toEqual([200, 412]);
      const saved = await h
        .http()
        .patch('/v1/me/preferences')
        .set('authorization', s.auth)
        .set('if-match', '"1"')
        .send({ language: 'hinglish', quiet_hours: { start: '22:00', end: '07:00' } })
        .expect(200);
      expect(saved.body).toMatchObject({
        language: 'hinglish',
        quiet_hours: { start: '22:00', end: '07:00' },
        version: 2,
      });
      await h
        .http()
        .patch('/v1/me/preferences')
        .set('authorization', s.auth)
        .set('if-match', '"2"')
        .send({ quiet_hours: { start: '25:00', end: '07:00' } })
        .expect(400);
    });
  });

  describe('saved places', () => {
    const place = {
      kind: 'home',
      label: 'Home',
      line1: '12 MG Road',
      city: 'Bengaluru',
      country: 'IN',
    };

    it('create / list / update / delete with ownership and If-Match', async () => {
      const a = await h.signIn(await h.activeAccount('places'));
      const created = await h
        .http()
        .post('/v1/me/places')
        .set('authorization', a.auth)
        .send(place)
        .expect(201);
      const id = created.body.id as string;
      const list = await h.http().get('/v1/me/places').set('authorization', a.auth).expect(200);
      expect(list.body.items).toHaveLength(1);
      const updated = await h
        .http()
        .put(`/v1/me/places/${id}`)
        .set('authorization', a.auth)
        .set('if-match', '"0"')
        .send({ ...place, label: 'Home (new)' })
        .expect(200);
      expect(updated.body).toMatchObject({ label: 'Home (new)', version: 1 });

      // Another user cannot see, update or delete it — indistinguishable from not found.
      const b = await h.signIn(await h.activeAccount('places-b'));
      expect(
        (await h.http().get('/v1/me/places').set('authorization', b.auth)).body.items,
      ).toHaveLength(0);
      await h
        .http()
        .put(`/v1/me/places/${id}`)
        .set('authorization', b.auth)
        .set('if-match', '"1"')
        .send(place)
        .expect(404);
      await h
        .http()
        .delete(`/v1/me/places/${id}`)
        .set('authorization', b.auth)
        .set('if-match', '"1"')
        .expect(404);

      await h
        .http()
        .delete(`/v1/me/places/${id}`)
        .set('authorization', a.auth)
        .set('if-match', '"0"')
        .expect(412);
      await h
        .http()
        .delete(`/v1/me/places/${id}`)
        .set('authorization', a.auth)
        .set('if-match', '"1"')
        .expect(204);
      expect(await owner.savedPlace.count({ where: { id } })).toBe(0);
    });

    it('enforces the 20-place limit even under concurrent creates', async () => {
      const s = await h.signIn(await h.activeAccount('limit'));
      for (let i = 0; i < 19; i++) {
        await h
          .http()
          .post('/v1/me/places')
          .set('authorization', s.auth)
          .send({ ...place, label: `P${i}` })
          .expect(201);
      }
      const results = await Promise.all(
        [0, 1, 2].map((i) =>
          h
            .http()
            .post('/v1/me/places')
            .set('authorization', s.auth)
            .send({ ...place, label: `R${i}` }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await owner.savedPlace.count({ where: { userId: s.userId } })).toBe(20);
    });
  });

  describe('e-mail change', () => {
    it('needs the current password, verifies the NEW address, notifies the old one and signs out other sessions', async () => {
      const oldEmail = await h.activeAccount('emailchg');
      const s = await h.signIn(oldEmail);
      const other = await h.signIn(oldEmail);
      const newEmail = uniqueEmail('emailchg-new');

      const wrong = await h
        .http()
        .post('/v1/me/email-change')
        .set('authorization', s.auth)
        .send({ new_email: newEmail, current_password: 'not the right passphrase' })
        .expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

      const start = await h
        .http()
        .post('/v1/me/email-change')
        .set('authorization', s.auth)
        .send({ new_email: newEmail, current_password: PW })
        .expect(202);
      expect(start.body.challenge_handle).toMatch(/^kec_/);
      const code = await h.lastCode(newEmail, 'auth.email_change_code');
      expect(
        h
          .mailbox()
          .to(oldEmail)
          .some((m) => m.template === 'auth.email_change_requested'),
      ).toBe(true);

      // Another user cannot redeem this user's code.
      const intruder = await h.signIn(await h.activeAccount('intruder'));
      await h
        .http()
        .post('/v1/me/email-change/confirm')
        .set('authorization', intruder.auth)
        .send({ challenge_handle: start.body.challenge_handle, code })
        .expect(400);

      const done = await h
        .http()
        .post('/v1/me/email-change/confirm')
        .set('authorization', s.auth)
        .send({ challenge_handle: start.body.challenge_handle, code })
        .expect(200);
      expect(done.body).toEqual({ status: 'email_changed', email: newEmail });
      await h.http().get('/v1/me').set('authorization', s.auth).expect(200);
      await h.http().get('/v1/me').set('authorization', other.auth).expect(401);
      await h.drain();
      expect(
        h
          .mailbox()
          .to(oldEmail)
          .some((m) => m.template === 'auth.email_change_completed'),
      ).toBe(true);
      await h.signIn(newEmail);
      await h
        .http()
        .post('/v1/auth/login')
        .send({
          email: oldEmail,
          password: PW,
          client: 'web',
          device: { installation_id: crypto.randomUUID() },
        })
        .expect(401);
    });

    it('an address owned by another account gets a decoy (no oracle, no mail to it)', async () => {
      const taken = await h.activeAccount('taken');
      const s = await h.signIn(await h.activeAccount('wants-taken'));
      const before = h.mailbox().to(taken).length;
      const res = await h
        .http()
        .post('/v1/me/email-change')
        .set('authorization', s.auth)
        .send({ new_email: taken, current_password: PW })
        .expect(202);
      expect(res.body.challenge_handle).toMatch(/^kec_/);
      await h.drain();
      expect(h.mailbox().to(taken)).toHaveLength(before);
      await h
        .http()
        .post('/v1/me/email-change/confirm')
        .set('authorization', s.auth)
        .send({ challenge_handle: res.body.challenge_handle, code: '123456' })
        .expect(400);
    });
  });

  describe('password change', () => {
    it('needs the current password, applies the policy, and signs out only OTHER sessions', async () => {
      const email = await h.activeAccount('pwchg');
      const s = await h.signIn(email);
      const other = await h.signIn(email);
      await h
        .http()
        .post('/v1/me/password')
        .set('authorization', s.auth)
        .send({ current_password: 'not the right passphrase', new_password: NEW_PW })
        .expect(401);
      const weak = await h
        .http()
        .post('/v1/me/password')
        .set('authorization', s.auth)
        .send({ current_password: PW, new_password: 'Password@12345678' })
        .expect(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');
      const ok = await h
        .http()
        .post('/v1/me/password')
        .set('authorization', s.auth)
        .send({ current_password: PW, new_password: NEW_PW })
        .expect(200);
      expect(ok.body).toEqual({ status: 'password_changed', revoked_sessions: 1 });
      await h.http().get('/v1/me').set('authorization', s.auth).expect(200);
      await h.http().get('/v1/me').set('authorization', other.auth).expect(401);
      await h.signIn(email, NEW_PW);
      await h.drain();
      expect(
        h
          .mailbox()
          .to(email)
          .some((m) => m.template === 'auth.password_changed'),
      ).toBe(true);
    });
  });
});
