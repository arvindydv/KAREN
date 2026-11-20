import { histogramQuantile } from '@karen/observability';
import { installInMemoryMetrics, type Histogram } from '@karen/observability/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { testEnv } from './env.js';

/** Metrics emitted by the real API (Fastify hooks + live pg pool) on real PostgreSQL/Redis. */
describe('API metrics (integration)', () => {
  const mem = installInMemoryMetrics();
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    app = await createApp(testEnv(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    // Like the load balancer: send traffic only once Redis/DB are ready (sensitive routes
    // fail closed while the rate-limit store is still connecting).
    for (let i = 0; i < 50; i += 1) {
      if ((await request(app.getHttpServer()).get('/health/ready')).status === 200) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  afterAll(async () => {
    await app.close();
    await mem.shutdown();
  });

  const metric = async (name: string) =>
    (await mem.collect()).scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === name);

  it('records request latency per route template with p95/p99-capable buckets', async () => {
    const subject = `dev|metrics-${Date.now().toString(36)}`;
    const token = (await request(app.getHttpServer()).post('/dev/auth/token').send({ subject }))
      .body.access_token as string;
    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer()).get('/v1/me').set('authorization', `Bearer ${token}`);
    }
    await request(app.getHttpServer()).get('/v1/users/123e4567-e89b-12d3-a456-426614174000');

    const points = (await metric('http.server.request.duration'))?.dataPoints ?? [];
    const me = points.find(
      (p) =>
        p.attributes['http.route'] === '/v1/me' &&
        p.attributes['http.response.status_code'] === 200,
    );
    const h = me?.value as Histogram;
    expect(h.count).toBe(20);
    const p95 = histogramQuantile(0.95, h.buckets.boundaries, h.buckets.counts);
    const p99 = histogramQuantile(0.99, h.buckets.boundaries, h.buckets.counts);
    expect(p95).toBeGreaterThan(0);
    expect(p99).toBeGreaterThanOrEqual(p95 ?? 0);
    // Unknown paths never leak IDs into labels.
    expect(points.some((p) => String(p.attributes['http.route']).includes('123e4567'))).toBe(false);
    expect(points.some((p) => p.attributes['http.route'] === '__unmatched__')).toBe(true);
  });

  it('exports live DB pool utilisation', async () => {
    const counts = (await metric('db.client.connection.count'))?.dataPoints ?? [];
    const total = counts.reduce((sum, p) => sum + Number(p.value), 0);
    expect(total).toBeGreaterThan(0); // the requests above opened at least one connection
    expect((await metric('db.client.connection.max'))?.dataPoints[0]?.value).toBe(10);
    expect(
      Number((await metric('db.client.connection.pending_requests'))?.dataPoints[0]?.value),
    ).toBe(0);
  });

  it('counts security events with a fixed, PII-free label vocabulary', async () => {
    const email = `metrics.${Date.now().toString(36)}@example.test`;
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        email,
        password: 'not a real passphrase at all',
        client: 'web',
        device: { installation_id: '6f1c2b9e-0000-4000-8000-0000000000aa' },
      })
      .expect(401);
    const login = (await metric('karen.auth.login'))?.dataPoints ?? [];
    const invalid = login.find((p) => p.attributes.outcome === 'invalid_credentials');
    expect(Number(invalid?.value)).toBeGreaterThanOrEqual(1);
    const everything = JSON.stringify(
      (await mem.collect()).scopeMetrics.flatMap((s) =>
        s.metrics.flatMap((m) => m.dataPoints.map((d) => d.attributes)),
      ),
    );
    expect(everything).not.toContain(email);
    expect(everything).not.toContain('@');
  });
});
