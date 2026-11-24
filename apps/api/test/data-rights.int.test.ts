import { randomUUID } from 'node:crypto';
import { INTERNAL_SIGNATURE_HEADER } from '@karen/ai-model-contracts';
import { INTERNAL_DATA_RIGHTS_PATHS } from '@karen/domain';
import { internalRequestSigningString, signTimestamped } from '@karen/domain/node';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import {
  type ManualWorkflowStarter,
  WORKFLOW_STARTER,
} from '../src/infrastructure/temporal/workflow-starter.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { PW, harness, startApp } from './support.js';

/**
 * Phase 01 / M7: data export and account deletion (integration). Workflows run in `manual`
 * dispatch here; the test plays the Temporal worker by calling the signed internal endpoints.
 * The workflows themselves are tested in apps/temporal-worker with Temporal's test server.
 */
const SECRET = testEnv().INTERNAL_SERVICE_HMAC_SECRET as string;

describe('data rights (integration)', () => {
  let app: NestFastifyApplication;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const h = harness(() => app);

  // Each call gets a distinct timestamp: identical signatures are rejected as replays.
  // Every signed call needs a distinct timestamp: the guard rejects a repeated signature header
  // as a replay. `now - ++skew` could repeat when two calls straddle a second boundary
  // (t1 = n - 1, t2 = (n + 1) - 2), so take a strictly decreasing value instead.
  let lastT = Number.POSITIVE_INFINITY;
  const nextT = (): number => {
    lastT = Math.min(Math.floor(Date.now() / 1000) - 1, lastT - 1);
    return lastT;
  };
  const internal = (path: string, secret = SECRET, t = nextT()) =>
    h
      .http()
      .post(path)
      .set(
        INTERNAL_SIGNATURE_HEADER,
        signTimestamped(secret, internalRequestSigningString('POST', path, ''), t),
      );

  beforeAll(async () => {
    await ensureDraftNotices(owner);
    app = await startApp({ DATA_DELETION_GRACE_SECONDS: '2', DATA_EXPORT_TTL_HOURS: '1' });
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('internal step endpoints', () => {
    it('reject unsigned, wrongly signed, stale and replayed calls', async () => {
      const path = INTERNAL_DATA_RIGHTS_PATHS.executeErasure(randomUUID());
      await h.http().post(path).expect(401);
      await internal(path, 'wrong-secret-wrong-secret-wrong-secret').expect(401);
      await internal(path, SECRET, Math.floor(Date.now() / 1000) - 3600).expect(401);
      const header = signTimestamped(
        SECRET,
        internalRequestSigningString('POST', path, ''),
        Math.floor(Date.now() / 1000),
      );
      await h.http().post(path).set(INTERNAL_SIGNATURE_HEADER, header).expect(404); // valid; unknown id
      await h.http().post(path).set(INTERNAL_SIGNATURE_HEADER, header).expect(401); // replay
      // A user session is not an internal credential.
      const s = await h.signIn(await h.activeAccount('internal-user'));
      await h.http().post(path).set('authorization', s.auth).expect(401);
    });

    it('are not part of the public API contract', async () => {
      const { readFile } = await import('node:fs/promises');
      const doc = JSON.parse(
        await readFile(
          new URL('../../../packages/api-contracts/openapi/karen-api.v1.json', import.meta.url),
          'utf8',
        ),
      ) as { paths: Record<string, unknown> };
      expect(Object.keys(doc.paths).some((p) => p.startsWith('/internal'))).toBe(false);
    });
  });

  describe('export', () => {
    it('is durable and idempotent, builds a complete copy without secrets, and expires', async () => {
      const email = await h.activeAccount('export');
      const s = await h.signIn(email);
      await h
        .http()
        .put('/v1/me/consents/AI_PROCESSING')
        .set('authorization', s.auth)
        .set('if-match', '"0"')
        .send({ decision: 'grant', notice_version: TEST_NOTICE_VERSION, source: 'settings' })
        .expect(200);
      const a = await h
        .http()
        .post('/v1/me/data-rights/export')
        .set('authorization', s.auth)
        .expect(202);
      const b = await h
        .http()
        .post('/v1/me/data-rights/export')
        .set('authorization', s.auth)
        .expect(202);
      expect(b.body.id).toBe(a.body.id);
      expect(a.body).toMatchObject({
        kind: 'export',
        status: 'requested',
        download_available: false,
      });
      const starter = app.get<ManualWorkflowStarter>(WORKFLOW_STARTER);
      expect(
        starter.started.filter((w) => w.workflowId === `karen-data-export-${a.body.id as string}`),
      ).toHaveLength(1);

      const step = await internal(
        INTERNAL_DATA_RIGHTS_PATHS.buildExport(a.body.id as string),
      ).expect(200);
      expect(step.body.outcome).toBe('ready');
      // Retried step (e.g. worker restart) is a no-op.
      const again = await internal(
        INTERNAL_DATA_RIGHTS_PATHS.buildExport(a.body.id as string),
      ).expect(200);
      expect(again.body.outcome).toBe('already_done');

      const dl = await h
        .http()
        .get(`/v1/me/data-rights/${a.body.id as string}/download`)
        .set('authorization', s.auth)
        .expect(200);
      expect(dl.headers['content-disposition']).toContain('attachment');
      expect(dl.headers['cache-control']).toBe('no-store');
      expect(dl.body.account.email).toBe(email);
      expect(dl.body.consent_receipts).toHaveLength(1);
      const text = JSON.stringify(dl.body);
      expect(text).not.toMatch(/argon2id|sha256:[0-9a-f]{64}"?\s*,\s*"?token|krt_|kss_|kev_/);
      expect(text).not.toContain('passwordHash');
      expect(dl.body.not_included.length).toBeGreaterThan(0);
      await h.drain();
      expect(
        h
          .mailbox()
          .to(email)
          .some((m) => m.template === 'privacy.export_ready'),
      ).toBe(true);

      // Another user cannot download it.
      const other = await h.signIn(await h.activeAccount('export-other'));
      await h
        .http()
        .get(`/v1/me/data-rights/${a.body.id as string}/download`)
        .set('authorization', other.auth)
        .expect(404);

      // Not yet due → kept; once expired → payload purged.
      expect(
        (await internal(INTERNAL_DATA_RIGHTS_PATHS.expireExport(a.body.id as string)).expect(200))
          .body.outcome,
      ).toBe('not_due');
      await owner.dataRightsRequest.update({
        where: { id: a.body.id as string },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        (await internal(INTERNAL_DATA_RIGHTS_PATHS.expireExport(a.body.id as string)).expect(200))
          .body.outcome,
      ).toBe('expired');
      const row = await owner.dataRightsRequest.findUniqueOrThrow({
        where: { id: a.body.id as string },
      });
      expect(row).toMatchObject({ status: 'expired', exportPayload: null, exportSha256: null });
      await h
        .http()
        .get(`/v1/me/data-rights/${a.body.id as string}/download`)
        .set('authorization', s.auth)
        .expect(404);
    });
  });

  it('a notification problem never fails a committed step (regression: e2e run)', async () => {
    // Local-dev accounts have no e-mail address on file.
    const token = (
      await h
        .http()
        .post('/dev/auth/token')
        .send({ subject: `dev|noemail-${Date.now().toString(36)}` })
        .expect(200)
    ).body.access_token as string;
    const req = await h
      .http()
      .post('/v1/me/data-rights/export')
      .set('authorization', `Bearer ${token}`)
      .expect(202);
    const step = await internal(
      INTERNAL_DATA_RIGHTS_PATHS.buildExport(req.body.id as string),
    ).expect(200);
    expect(step.body.outcome).toBe('ready');
  });

  describe('deletion', () => {
    it('needs the password, signs out everywhere, allows only view/cancel during the window', async () => {
      const email = await h.activeAccount('del-cancel');
      const s = await h.signIn(email);
      await h
        .http()
        .post('/v1/me/data-rights/deletion')
        .set('authorization', s.auth)
        .send({ current_password: 'not the right passphrase', confirm: true })
        .expect(401);
      await h
        .http()
        .post('/v1/me/data-rights/deletion')
        .set('authorization', s.auth)
        .send({ current_password: PW })
        .expect(400);
      const req = await h
        .http()
        .post('/v1/me/data-rights/deletion')
        .set('authorization', s.auth)
        .send({ current_password: PW, confirm: true })
        .expect(202);
      expect(req.body).toMatchObject({ kind: 'deletion', status: 'scheduled' });
      await h.http().get('/v1/me').set('authorization', s.auth).expect(401); // all sessions revoked

      // Signing in gives a restricted session.
      const restricted = await h.signIn(email);
      const me = await h.http().get('/v1/me').set('authorization', restricted.auth).expect(403);
      expect(me.body.error).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        next_options: ['CANCEL_DELETION'],
      });
      await h.http().get('/v1/me/profile').set('authorization', restricted.auth).expect(403);
      await h
        .http()
        .post('/v1/me/data-rights/export')
        .set('authorization', restricted.auth)
        .expect(403);
      const list = await h
        .http()
        .get('/v1/me/data-rights')
        .set('authorization', restricted.auth)
        .expect(200);
      expect(list.body.items[0].id).toBe(req.body.id);

      const cancelled = await h
        .http()
        .post(`/v1/me/data-rights/${req.body.id as string}/cancel`)
        .set('authorization', restricted.auth)
        .expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      await h.http().get('/v1/me').set('authorization', restricted.auth).expect(200); // full access again
      // The workflow's later erasure step finds the request cancelled and does nothing.
      expect(
        (
          await internal(INTERNAL_DATA_RIGHTS_PATHS.executeErasure(req.body.id as string)).expect(
            200,
          )
        ).body.outcome,
      ).toBe('cancelled');
      expect((await owner.user.findUniqueOrThrow({ where: { id: s.userId } })).status).toBe(
        'ACTIVE',
      );
      await h.drain();
      const templates = h
        .mailbox()
        .to(email)
        .map((m) => m.template);
      expect(templates).toEqual(
        expect.arrayContaining(['privacy.deletion_scheduled', 'privacy.deletion_cancelled']),
      );
    });

    it('erases the account after the window: personal data gone, proofs kept, address reusable', async () => {
      const email = await h.activeAccount('del-run');
      const s = await h.signIn(email);
      await h
        .http()
        .put('/v1/me/consents/AI_PROCESSING')
        .set('authorization', s.auth)
        .set('if-match', '"0"')
        .send({ decision: 'grant', notice_version: TEST_NOTICE_VERSION, source: 'settings' })
        .expect(200);
      await h
        .http()
        .post('/v1/me/places')
        .set('authorization', s.auth)
        .send({ kind: 'home', label: 'Home', line1: '1 Test Street', city: 'Pune', country: 'IN' })
        .expect(201);
      const req = await h
        .http()
        .post('/v1/me/data-rights/deletion')
        .set('authorization', s.auth)
        .send({ current_password: PW, confirm: true })
        .expect(202);
      const id = req.body.id as string;

      // Inside the window the erasure step refuses to run.
      await owner.dataRightsRequest.update({
        where: { id },
        data: { scheduledFor: new Date(Date.now() + 60_000) },
      });
      expect(
        (await internal(INTERNAL_DATA_RIGHTS_PATHS.executeErasure(id)).expect(200)).body.outcome,
      ).toBe('not_due');
      expect(await owner.userEmail.count({ where: { userId: s.userId } })).toBe(1);

      await owner.dataRightsRequest.update({
        where: { id },
        data: { scheduledFor: new Date(Date.now() - 1000) },
      });
      expect(
        (await internal(INTERNAL_DATA_RIGHTS_PATHS.executeErasure(id)).expect(200)).body.outcome,
      ).toBe('completed');
      // Retried step (worker restart) is idempotent.
      expect(
        (await internal(INTERNAL_DATA_RIGHTS_PATHS.executeErasure(id)).expect(200)).body.outcome,
      ).toBe('completed');

      const user = await owner.user.findUniqueOrThrow({ where: { id: s.userId } });
      expect(user).toMatchObject({ status: 'DELETED', displayName: null, preferredName: null });
      const where = { where: { userId: s.userId } };
      expect(await owner.userEmail.count(where)).toBe(0);
      expect(await owner.passwordCredential.count(where)).toBe(0);
      expect(await owner.session.count(where)).toBe(0);
      expect(await owner.device.count(where)).toBe(0);
      expect(await owner.savedPlace.count(where)).toBe(0);
      expect(await owner.consentGrant.count(where)).toBe(0);
      // Retention exceptions: proof of consent and of the request itself.
      expect(await owner.consentReceipt.count(where)).toBe(1);
      const done = await owner.dataRightsRequest.findUniqueOrThrow({ where: { id } });
      expect(done.status).toBe('completed');
      expect((done.retentionExceptions as { category: string }[]).map((r) => r.category)).toEqual(
        expect.arrayContaining(['consent_receipts', 'audit_events', 'backups']),
      );
      await h.drain();
      expect(h.mailbox().to(email).at(-1)?.template).toBe('privacy.account_deleted');
      // The address can be used again; the old password no longer works.
      await h
        .http()
        .post('/v1/auth/login')
        .send({ email, password: PW, client: 'web', device: { installation_id: randomUUID() } })
        .expect(401);
      await h.http().post('/v1/auth/register').send({ email, password: PW }).expect(202);
      expect(await owner.userEmail.count({ where: { emailCanonical: email } })).toBe(1);
    });

    it('the erasure routine refuses accounts that never asked to be deleted, even if called directly', async () => {
      const s = await h.signIn(await h.activeAccount('del-guard'));
      const runtime = new PrismaService(testEnv());
      try {
        // A forged request row cannot even be inserted for another user (RLS)…
        await expect(
          runtime.withUserScope(randomUUID(), (tx) =>
            tx.dataRightsRequest.create({
              data: {
                userId: s.userId,
                kind: 'deletion',
                status: 'scheduled',
                activeKind: 'deletion',
                scheduledFor: new Date(0),
              },
            }),
          ),
        ).rejects.toThrow(/row-level security/);
        // …and a due request for an ACTIVE account is refused by the function itself.
        const forged = await owner.dataRightsRequest.create({
          data: {
            userId: s.userId,
            kind: 'deletion',
            status: 'scheduled',
            activeKind: 'deletion',
            scheduledFor: new Date(0),
          },
        });
        await expect(
          runtime.$queryRaw`SELECT identity.erase_user(${forged.id}::uuid)`,
        ).rejects.toThrow(/account is ACTIVE/);
        expect(await owner.userEmail.count({ where: { userId: s.userId } })).toBe(1);
      } finally {
        await runtime.$disconnect();
      }
    });
  });
});
