import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsentService } from '../src/consent/consent.service.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/** Phase 01 / M6: notices, purpose consent, receipts, legal acknowledgement (integration). */
describe('consent (integration)', () => {
  let app: NestFastifyApplication;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const runtime = new PrismaService(testEnv());
  const h = harness(() => app);
  const body = (decision: 'grant' | 'deny' | 'revoke') => ({
    decision,
    notice_version: TEST_NOTICE_VERSION,
    source: 'settings',
  });

  beforeAll(async () => {
    await ensureDraftNotices(owner);
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
    await Promise.all([owner.$disconnect(), runtime.$disconnect()]);
  });

  const as = async (tag: string) => h.signIn(await h.activeAccount(tag));
  const decide = (auth: string, purpose: string, version: number, b: object, key?: string) => {
    const req = h
      .http()
      .put(`/v1/me/consents/${purpose}`)
      .set('authorization', auth)
      .set('if-match', `"${version}"`);
    return (key ? req.set('idempotency-key', key) : req).send(b);
  };

  describe('public catalog and notices', () => {
    it('lists every purpose; unbuilt features are marked not_yet_available', async () => {
      const res = await h.http().get('/v1/consent/purposes').expect(200);
      expect(res.body.items).toHaveLength(11);
      const unavailable = (res.body.items as { purpose: string; availability: string }[])
        .filter((p) => p.availability === 'not_yet_available')
        .map((p) => p.purpose)
        .sort();
      expect(unavailable).toEqual([
        'ACTION_EXECUTION',
        'AUDIO_RETENTION',
        'CONNECTOR_ACCESS',
        'FAMILY_SHARING',
        'PRECISE_LOCATION',
      ]);
    });

    it('serves notices with content hashes (drafts only because this is a test environment)', async () => {
      const list = await h.http().get('/v1/consent/notices').expect(200);
      const privacy = (list.body.items as { kind: string; locale: string; state: string }[]).find(
        (n) => n.kind === 'privacy_notice' && n.locale === 'hi-IN',
      );
      expect(privacy?.state).toBe('draft');
      const one = await h
        .http()
        .get(`/v1/consent/notices/privacy_notice/${TEST_NOTICE_VERSION}?locale=en-IN`)
        .expect(200);
      expect(one.body.content).toContain('NOT LEGALLY REVIEWED');
      expect(one.body.content_sha256).toMatch(/^sha256:/);
    });

    it('never serves drafts when drafts are disabled (as in every deployed environment)', async () => {
      const strict = await startApp({ ALLOW_DRAFT_NOTICES: 'false' });
      try {
        const res = await request(strict.getHttpServer()).get('/v1/consent/notices').expect(200);
        expect((res.body.items as { state: string }[]).every((n) => n.state === 'approved')).toBe(
          true,
        );
        await request(strict.getHttpServer())
          .get(`/v1/consent/notices/privacy_notice/${TEST_NOTICE_VERSION}`)
          .expect(404);
      } finally {
        await strict.close();
      }
    });

    it('approved notices are immutable in the database; hashes must match content', async () => {
      const version = `approved-${Date.now().toString(36)}`;
      const content = 'Approved test notice body';
      const sha = `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
      await expect(
        owner.notice.create({
          data: {
            kind: 'ai_disclosure',
            locale: 'en-IN',
            version: `${version}-bad`,
            content,
            contentSha256: `sha256:${'0'.repeat(64)}`,
          },
        }),
      ).rejects.toThrow(/does not match content/);
      const n = await owner.notice.create({
        data: {
          kind: 'ai_disclosure',
          locale: 'en-IN',
          version,
          content,
          contentSha256: sha,
          state: 'approved',
          approvedAt: new Date(),
          approvedBy: 'legal-review-test',
          effectiveFrom: new Date(),
        },
      });
      await expect(
        owner.notice.update({
          where: { id: n.id },
          data: { content: 'changed', contentSha256: sha },
        }),
      ).rejects.toThrow(/immutable|does not match/);
      await expect(owner.notice.delete({ where: { id: n.id } })).rejects.toThrow(
        /cannot be deleted/,
      );
      await owner.notice.update({ where: { id: n.id }, data: { state: 'retired' } });
    });
  });

  describe('decisions', () => {
    it('defaults to not_asked; dependencies are enforced; revoking cascades with receipts', async () => {
      const s = await as('consent');
      const start = await h.http().get('/v1/me/consents').set('authorization', s.auth).expect(200);
      expect(
        (start.body.items as { decision: string }[]).every((i) => i.decision === 'not_asked'),
      ).toBe(true);

      const blocked = await decide(s.auth, 'MEMORY_STORAGE', 0, body('grant')).expect(403);
      expect(blocked.body.error).toMatchObject({
        code: 'CONSENT_REQUIRED',
        next_options: ['GRANT_CONSENT:AI_PROCESSING'],
      });

      const ai = await decide(s.auth, 'AI_PROCESSING', 0, body('grant')).expect(200);
      expect(ai.body.state).toMatchObject({ decision: 'granted', version: 1 });
      expect(ai.body.receipts[0]).toMatchObject({ seq: 1, decision: 'granted', prev_hash: null });
      await decide(s.auth, 'MEMORY_STORAGE', 0, body('grant')).expect(200);

      const consent = app.get(ConsentService);
      expect(await consent.hasActiveConsent(s.userId, 'MEMORY_STORAGE')).toBe(true);

      const revoked = await decide(s.auth, 'AI_PROCESSING', 1, body('revoke')).expect(200);
      expect(
        (revoked.body.receipts as { purpose: string; method: string }[]).map((r) => [
          r.purpose,
          r.method,
        ]),
      ).toEqual([
        ['AI_PROCESSING', 'explicit'],
        ['MEMORY_STORAGE', 'cascade:AI_PROCESSING'],
      ]);
      expect(await consent.hasActiveConsent(s.userId, 'AI_PROCESSING')).toBe(false);
      expect(await consent.hasActiveConsent(s.userId, 'MEMORY_STORAGE')).toBe(false);
      const audit = await owner.auditEvent.findFirst({
        where: { actorRef: s.userId, action: 'consent.decision', reasonCode: 'revoked' },
      });
      expect(audit?.metadata).toMatchObject({ cascaded: 1 });
    });

    it('refuses unavailable purposes, unknown notice versions and invalid transitions', async () => {
      const s = await as('consent-bad');
      await decide(s.auth, 'ACTION_EXECUTION', 0, body('grant')).expect(400);
      await decide(s.auth, 'AI_PROCESSING', 0, { ...body('grant'), notice_version: 'nope' }).expect(
        400,
      );
      await decide(s.auth, 'AI_PROCESSING', 0, body('revoke')).expect(409);
      await decide(s.auth, 'NOT_A_PURPOSE', 0, body('grant')).expect(404);
      await decide(s.auth, 'AI_PROCESSING', 0, { ...body('grant'), extra: 1 }).expect(400);
      // Deny is a real, recorded decision (not the absence of one).
      const denied = await decide(s.auth, 'PRODUCT_ANALYTICS', 0, body('deny')).expect(200);
      expect(denied.body.state.decision).toBe('denied');
    });

    it('stale or missing If-Match is refused; concurrent out-of-order updates: exactly one wins', async () => {
      const s = await as('consent-race');
      await h
        .http()
        .put('/v1/me/consents/COMMUNICATIONS')
        .set('authorization', s.auth)
        .send(body('grant'))
        .expect(428);
      const results = await Promise.all([
        decide(s.auth, 'COMMUNICATIONS', 0, body('grant')),
        decide(s.auth, 'COMMUNICATIONS', 0, body('deny')),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
      await decide(s.auth, 'COMMUNICATIONS', 0, body('grant')).expect(412);
    });

    it('Idempotency-Key replays return the original receipt without a new one', async () => {
      const s = await as('consent-idem');
      const key = `idem-${Date.now().toString(36)}`;
      const a = await decide(s.auth, 'AI_PROCESSING', 0, body('grant'), key).expect(200);
      const b = await decide(s.auth, 'AI_PROCESSING', 0, body('grant'), key).expect(200);
      expect(b.body.receipts[0].id).toBe(a.body.receipts[0].id);
      expect(await owner.consentReceipt.count({ where: { userId: s.userId } })).toBe(1);
      await decide(s.auth, 'PRODUCT_ANALYTICS', 0, body('grant'), key).expect(409);
    });
  });

  describe('receipts', () => {
    it('form a verifiable chain; tampering is detected; the API role cannot alter them', async () => {
      const s = await as('receipts');
      await decide(s.auth, 'AI_PROCESSING', 0, body('grant')).expect(200);
      await decide(s.auth, 'PERSONALIZATION', 0, body('grant')).expect(200);
      await decide(s.auth, 'PERSONALIZATION', 1, body('revoke')).expect(200);
      const ok = await h
        .http()
        .get('/v1/me/consents/receipts/verify')
        .set('authorization', s.auth)
        .expect(200);
      expect(ok.body).toEqual({ valid: true, receipts_checked: 3, first_invalid_seq: null });

      const hist = await h
        .http()
        .get('/v1/me/consents/history')
        .set('authorization', s.auth)
        .expect(200);
      expect((hist.body.items as { seq: number }[]).map((r) => r.seq)).toEqual([3, 2, 1]);

      // The application role cannot UPDATE or DELETE receipts (no grant + trigger).
      await expect(
        runtime.withUserScope(s.userId, (tx) =>
          tx.consentReceipt.updateMany({
            where: { userId: s.userId },
            data: { decision: 'granted' },
          }),
        ),
      ).rejects.toThrow(/permission denied|append-only/);
      // Even the owner is blocked by the trigger…
      await expect(
        owner.consentReceipt.updateMany({
          where: { userId: s.userId, seq: 2 },
          data: { decision: 'denied' },
        }),
      ).rejects.toThrow(/append-only/);
      // …so simulate a privileged attacker who disables it, edits history, and re-enables it.
      await owner.$executeRawUnsafe(
        'ALTER TABLE consent.consent_receipts DISABLE TRIGGER consent_receipts_append_only',
      );
      try {
        await owner.consentReceipt.updateMany({
          where: { userId: s.userId, seq: 2 },
          data: { decision: 'denied' },
        });
      } finally {
        await owner.$executeRawUnsafe(
          'ALTER TABLE consent.consent_receipts ENABLE TRIGGER consent_receipts_append_only',
        );
      }
      const bad = await h
        .http()
        .get('/v1/me/consents/receipts/verify')
        .set('authorization', s.auth)
        .expect(200);
      expect(bad.body).toEqual({ valid: false, receipts_checked: 2, first_invalid_seq: 2 });
    });

    it('receipts are private to their owner (RLS)', async () => {
      const a = await as('rec-a');
      const b = await as('rec-b');
      await decide(a.auth, 'AI_PROCESSING', 0, body('grant')).expect(200);
      expect(await runtime.consentReceipt.count({ where: { userId: a.userId } })).toBe(0);
      const seenByB = await runtime.withUserScope(b.userId, (tx) =>
        tx.consentReceipt.count({ where: { userId: a.userId } }),
      );
      expect(seenByB).toBe(0);
    });
  });

  describe('legal acknowledgement (separate from optional consent)', () => {
    it('tracks acceptance of the current notice version idempotently with the notice hash', async () => {
      const s = await as('legal');
      const before = await h.http().get('/v1/me/legal').set('authorization', s.auth).expect(200);
      expect((before.body.items as { up_to_date: boolean }[]).every((i) => !i.up_to_date)).toBe(
        true,
      );
      const version = (before.body.items as { kind: string; current_version: string }[]).find(
        (i) => i.kind === 'terms_of_service',
      )?.current_version as string;
      for (let i = 0; i < 2; i++) {
        await h
          .http()
          .post('/v1/me/legal/acceptances')
          .set('authorization', s.auth)
          .send({ kind: 'terms_of_service', version, locale: 'hi-IN' })
          .expect(200);
      }
      const after = await h.http().get('/v1/me/legal').set('authorization', s.auth).expect(200);
      expect(
        (after.body.items as { kind: string; up_to_date: boolean }[]).find(
          (i) => i.kind === 'terms_of_service',
        )?.up_to_date,
      ).toBe(true);
      const rows = await owner.legalAcceptance.findMany({ where: { userId: s.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.noticeSha256).toMatch(/^sha256:/);
      await h
        .http()
        .post('/v1/me/legal/acceptances')
        .set('authorization', s.auth)
        .send({ kind: 'terms_of_service', version: 'does-not-exist', locale: 'en-IN' })
        .expect(404);
    });
  });
});
