import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { startAiStub, type AiStub } from './ai-stub.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';

/**
 * Phase 02 P2-M4: per-user usage limits, message rate limit, ledger reconciliation
 * (integration). Limits: daily $0.15, reserve $0.10 per answer, stub reports $0.08.
 */
describe('chat limits (integration)', () => {
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
      CHAT_DAILY_LIMIT_USD: '0.15',
      CHAT_MONTHLY_LIMIT_USD: '1',
      CHAT_REQUEST_RESERVE_USD: '0.1',
      CHAT_MESSAGES_PER_MINUTE: '4',
    });
  });
  afterAll(async () => {
    await app.close();
    await stub.close();
    await owner.$disconnect();
  });

  const account = async (tag: string) => {
    const s = await h.signIn(await h.activeAccount(tag));
    await h
      .http()
      .put('/v1/me/consents/AI_PROCESSING')
      .set('authorization', s.auth)
      .set('if-match', '"0"')
      .send({ decision: 'grant', notice_version: TEST_NOTICE_VERSION, source: 'settings' })
      .expect(200);
    const t = await h
      .http()
      .post('/v1/conversations')
      .set('authorization', s.auth)
      .send({})
      .expect(201);
    return { ...s, cid: t.body.id as string };
  };
  const send = (auth: string, cid: string, content: string) =>
    h
      .http()
      .post(`/v1/conversations/${cid}/messages`)
      .set('authorization', auth)
      .set('idempotency-key', randomUUID())
      .send({ content });
  const finish = async (auth: string, cid: string, mid: string) => {
    for (let i = 0; i < 100; i++) {
      const m = await h
        .http()
        .get(`/v1/conversations/${cid}/messages/${mid}`)
        .set('authorization', auth);
      const body = m.body as Record<string, unknown>;
      if (['completed', 'failed', 'incomplete', 'canceled'].includes(body.status as string))
        return body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('never finished');
  };

  it('refuses with USAGE_LIMIT_REACHED (with reset time) once the daily limit would be exceeded', async () => {
    const s = await account('limit-daily');
    const first = await send(s.auth, s.cid, 'one [[stub:cost=0.08]]').expect(202);
    await finish(s.auth, s.cid, first.body.assistant_message.id as string);
    const usage = await h.http().get('/v1/me/ai-usage').set('authorization', s.auth).expect(200);
    expect(usage.body.daily.used_ratio).toBeCloseTo(0.08 / 0.15, 2);
    expect(usage.body.daily.limit_reached).toBe(true); // 0.08 + 0.10 reserve > 0.15
    expect(usage.body.gateway_mode).toBe('mock');
    const before = stub.requests.length;
    const refused = await send(s.auth, s.cid, 'two').expect(429);
    expect(refused.body.error.code).toBe('USAGE_LIMIT_REACHED');
    const reset = (refused.body.error.next_options as string[])[0]!;
    expect(reset).toMatch(/^RESETS_AT:\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    expect(stub.requests.length).toBe(before); // refused BEFORE any AI call
    // Nothing was stored for the refused message.
    const msgs = await h
      .http()
      .get(`/v1/conversations/${s.cid}/messages`)
      .set('authorization', s.auth);
    expect(msgs.body.items).toHaveLength(2);
  });

  it('a Redis counter loss is reconciled from the ledger (limits cannot be reset)', async () => {
    const s = await account('limit-reseed');
    const first = await send(s.auth, s.cid, 'one [[stub:cost=0.08]]').expect(202);
    await finish(s.auth, s.cid, first.body.assistant_message.id as string);
    const redis = app.get(RedisService).client;
    const keys = await redis.keys(`karen:ai:usage:*:${s.userId}:*`);
    expect(keys.length).toBe(2);
    await redis.del(...keys);
    await send(s.auth, s.cid, 'two').expect(429);
  });

  it('a failed answer with no output costs the user nothing', async () => {
    const s = await account('limit-failed-free');
    for (let i = 0; i < 2; i++) {
      const r = await send(s.auth, s.cid, `x [[stub:fail=GATEWAY_PROVIDER_ERROR]] ${i}`).expect(
        202,
      );
      const m = await finish(s.auth, s.cid, r.body.assistant_message.id as string);
      expect(m.status).toBe('failed');
    }
    const usage = await h.http().get('/v1/me/ai-usage').set('authorization', s.auth).expect(200);
    expect(usage.body.daily.used_ratio).toBe(0);
  });

  it('a refused duplicate never releases the reservation another request with the same key holds', async () => {
    const s = await account('limit-dup-key');
    const running = await send(s.auth, s.cid, 'busy [[stub:hang]]').expect(202);
    // A concurrent request with key K holds its reservation (reserved, transaction not yet done).
    const key = randomUUID();
    const { UsageLimitsService } = await import('../src/usage/usage-limits.service.js');
    const usage = app.get(UsageLimitsService);
    // (small amount: the running answer already reserved $0.10 of the $0.15 daily limit)
    expect(await usage.reserve(s.userId, `send:${s.userId}:${key}`, new Date(), 10_000)).toBe(true);
    // A duplicate with the same key is refused (an answer is already running in this thread)…
    await h
      .http()
      .post(`/v1/conversations/${s.cid}/messages`)
      .set('authorization', s.auth)
      .set('idempotency-key', key)
      .send({ content: 'dup' })
      .expect(409);
    // …and must leave the holder's reservation in place.
    const redis = app.get(RedisService).client;
    expect(await redis.exists(`karen:ai:usage:r:send:${s.userId}:${key}`)).toBe(1);
    await usage.release(s.userId, `send:${s.userId}:${key}`);
    await h
      .http()
      .post(
        `/v1/conversations/${s.cid}/messages/${running.body.assistant_message.id as string}/cancel`,
      )
      .set('authorization', s.auth)
      .expect(200);
  });

  it('limits message rate per user', async () => {
    const s = await account('limit-rate');
    const statuses: number[] = [];
    // 9 > 2 × 4: a 429 is guaranteed even if the run straddles a minute boundary.
    for (let i = 0; i < 9; i++) {
      const r = await send(s.auth, s.cid, `m${i} [[stub:fail=TIER_DISABLED]]`);
      statuses.push(r.status);
      if (r.status === 202) await finish(s.auth, s.cid, r.body.assistant_message.id as string);
    }
    expect(statuses).toContain(429);
  });
});
