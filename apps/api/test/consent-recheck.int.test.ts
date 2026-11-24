import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenerationService } from '../src/conversation/generation.service.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { startAiStub, type AiStub } from './ai-stub.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/**
 * Phase 03 / M4a — the generation runner re-checks AI_PROCESSING itself (S2, D11; T-STR-01) and,
 * per the owner instruction of 2026-11-24 (amends OD-03), stops an answer that is already
 * streaming when AI_PROCESSING is revoked: no further AI processing after revocation.
 */
describe('generation consent re-check (M4a, integration)', () => {
  let app: NestFastifyApplication;
  let stub: AiStub;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const h = harness(() => app);

  beforeAll(async () => {
    await ensureDraftNotices(owner);
    stub = await startAiStub();
    app = await startApp({
      AI_SERVICE_URL: stub.url,
      CHAT_MAINTENANCE_INTERVAL_SECONDS: '0',
      CHAT_GENERATION_TIMEOUT_SECONDS: '60',
      CHAT_CONSENT_RECHECK_SECONDS: '1',
      CHAT_MESSAGES_PER_MINUTE: '500',
      CHAT_DAILY_LIMIT_USD: '100',
      CHAT_MONTHLY_LIMIT_USD: '1000',
    });
  });
  afterAll(async () => {
    await app.close();
    await stub.close();
    await owner.$disconnect();
  });

  type S = Awaited<ReturnType<typeof h.signIn>>;
  const consent = async (s: S, purpose: string, decision: 'grant' | 'revoke') => {
    const g = await owner.consentGrant.findFirst({
      where: { userId: s.userId, purpose: purpose as never },
    });
    await h
      .http()
      .put(`/v1/me/consents/${purpose}`)
      .set('authorization', s.auth)
      .set('if-match', `"${g?.version ?? 0}"`)
      .send({ decision, notice_version: TEST_NOTICE_VERSION, source: 'settings' })
      .expect(200);
  };
  const account = async (tag: string) => {
    const s = await h.signIn(await h.activeAccount(tag));
    await consent(s, 'AI_PROCESSING', 'grant');
    return s;
  };
  const message = (s: S, threadId: string, id: string) =>
    h
      .http()
      .get(`/v1/conversations/${threadId}/messages/${id}`)
      .set('authorization', s.auth)
      .expect(200);
  const waitFor = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v)) return v;
      if (Date.now() > end) throw new Error('timed out waiting');
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const terminal = (b: { status: string }) =>
    ['completed', 'incomplete', 'failed', 'canceled'].includes(b.status);

  it('T-STR-01 consent revoked before the runner loads → CONSENT_REQUIRED and zero AI calls', async () => {
    const s = await account('m4a-before');
    const thread = await owner.conversationThread.create({
      data: { userId: s.userId, title: 's2', locale: 'en-IN', mode: 'standard', nextSeq: 3 },
    });
    const user = await owner.conversationMessage.create({
      data: {
        userId: s.userId,
        threadId: thread.id,
        seq: 1,
        role: 'user',
        status: 'completed',
        content: 'hello',
      },
    });
    const requestId = `req_${randomUUID()}`;
    const assistant = await owner.conversationMessage.create({
      data: {
        userId: s.userId,
        threadId: thread.id,
        seq: 2,
        role: 'assistant',
        status: 'accepted',
        content: '',
        replyToMessageId: user.id,
        requestId,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    // The send path checked consent; the user revokes before the runner starts.
    await consent(s, 'AI_PROCESSING', 'revoke');
    app.get(GenerationService, { strict: false }).start({
      userId: s.userId,
      userRef: `u_${s.userId.slice(0, 8)}`,
      messageId: assistant.id,
      reservationKey: `test:${randomUUID()}`,
    });
    const done = await waitFor(
      async () => (await message(s, thread.id, assistant.id)).body as { status: string },
      terminal,
    );
    expect(done).toMatchObject({
      status: 'failed',
      error: { code: 'CONSENT_REQUIRED', retryable: false },
    });
    expect(stub.requests.some((r) => r.request_id === requestId)).toBe(false);
  });

  it('revoked while the answer streams → stream stops, CONSENT_REQUIRED, no further AI processing', async () => {
    const s = await account('m4a-during');
    const t = await h.http().post('/v1/conversations').set('authorization', s.auth).send({});
    const threadId = t.body.id as string;
    const sent = await h
      .http()
      .post(`/v1/conversations/${threadId}/messages`)
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ content: 'tell me a long story [[stub:hang]]' })
      .expect(202);
    const aid = sent.body.assistant_message.id as string;
    await waitFor(
      async () => (await message(s, threadId, aid)).body as { status: string; content: string },
      (b) => b.status === 'streaming' && b.content.length > 0,
    );
    const callsBefore = stub.requests.length;
    const revokedAt = Date.now();
    await consent(s, 'AI_PROCESSING', 'revoke');
    const done = await waitFor(
      async () => (await message(s, threadId, aid)).body as { status: string },
      terminal,
    );
    // Residual window is bounded by CHAT_CONSENT_RECHECK_SECONDS (1 s here) + write latency.
    expect(Date.now() - revokedAt).toBeLessThan(5_000);
    expect(done).toMatchObject({
      status: 'incomplete',
      error: { code: 'CONSENT_REQUIRED', retryable: false },
    });
    // Retries and regeneration are refused; nothing else reached the AI service.
    await h
      .http()
      .post(`/v1/conversations/${threadId}/messages`)
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ content: 'again' })
      .expect(403);
    await h
      .http()
      .post(`/v1/conversations/${threadId}/messages/${aid}/regenerate`)
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .expect(403);
    expect(stub.requests.length).toBe(callsBefore);
  });

  it('revoking only MEMORY_STORAGE does not stop chat (purpose boundary, D5)', async () => {
    const s = await account('m4a-memory-only');
    await consent(s, 'MEMORY_STORAGE', 'grant');
    const t = await h.http().post('/v1/conversations').set('authorization', s.auth).send({});
    const sent = await h
      .http()
      .post(`/v1/conversations/${t.body.id as string}/messages`)
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ content: 'hi [[stub:slow]]' })
      .expect(202);
    await consent(s, 'MEMORY_STORAGE', 'revoke');
    const done = await waitFor(
      async () =>
        (await message(s, t.body.id as string, sent.body.assistant_message.id as string)).body as {
          status: string;
        },
      terminal,
    );
    expect(done.status).toBe('completed');
  });
});
