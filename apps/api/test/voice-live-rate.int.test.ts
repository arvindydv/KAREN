import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { startAiStub, type AiStub } from './ai-stub.js';
import { TEST_OWNER_DATABASE_URL, TEST_REDIS_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/**
 * Regression (ADR-0029): a live conversation streams ~4 audio chunks per second. The general
 * per-IP limiter used to count them and cut every conversation off after ~30 s. Audio chunks are
 * governed only by their own per-user limiter (VOICE_LIVE_CHUNKS_PER_MINUTE).
 */
describe('live voice audio is not throttled by the general limiter (integration)', () => {
  let app: NestFastifyApplication;
  let stub: AiStub;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const h = harness(() => app);
  const GENERAL_LIMIT = 30;

  beforeAll(async () => {
    await ensureDraftNotices(owner);
    stub = await startAiStub();
    app = await startApp({
      AI_SERVICE_URL: stub.url,
      CHAT_MAINTENANCE_INTERVAL_SECONDS: '0',
      API_RATE_LIMIT_PER_MINUTE: String(GENERAL_LIMIT),
      // Own Redis database: suites running in parallel share 127.0.0.1's per-IP counters otherwise.
      REDIS_URL: TEST_REDIS_URL.replace(/\/\d+$/, '/7'),
      VOICE_LIVE_CHUNKS_PER_MINUTE: '600',
    });
  });
  afterAll(async () => {
    await app.close();
    await stub.close();
    await owner.$disconnect();
  });

  it('accepts more chunks than the general per-minute limit, still per-user limited', async () => {
    const s = await h.signIn(await h.activeAccount('vlr-chunks'));
    await h
      .http()
      .put('/v1/me/consents/AI_PROCESSING')
      .set('authorization', s.auth)
      .set('if-match', '"0"')
      .send({ decision: 'grant', notice_version: TEST_NOTICE_VERSION, source: 'settings' })
      .expect(200);
    const started = await h
      .http()
      .post('/v1/voice/sessions')
      .set('authorization', s.auth)
      .send({ audio_format: 'webm' })
      .expect(201);
    const sid = started.body.session_id as string;
    const statuses: number[] = [];
    for (let seq = 0; seq < GENERAL_LIMIT + 15; seq += 1) {
      const res = await h
        .http()
        .post(`/v1/voice/sessions/${sid}/audio`)
        .set('authorization', s.auth)
        .send({ seq, audio_base64: Buffer.from(`chunk-${seq}`).toString('base64') });
      statuses.push(res.status);
    }
    expect(statuses.every((code) => code === 204)).toBe(true);
    // Closing is incidental here (and other suites running in parallel share the per-IP limiter).
    await h.http().post(`/v1/voice/sessions/${sid}/close`).set('authorization', s.auth);
  });
});
