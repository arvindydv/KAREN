import type { Histogram } from '@opentelemetry/sdk-metrics';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HTTP_DURATION_BUCKETS_S,
  UNMATCHED_ROUTE,
  createHttpServerMetrics,
  histogramQuantile,
  registerDbPoolMetrics,
} from './metrics.js';
import { installInMemoryMetrics } from './testing.js';

const mem = installInMemoryMetrics();
afterAll(() => mem.shutdown());

const find = async (name: string) =>
  (await mem.collect()).scopeMetrics
    .flatMap((s) => s.metrics)
    .find((m) => m.descriptor.name === name);

describe('histogramQuantile', () => {
  it('interpolates like histogram_quantile and handles the +Inf bucket', () => {
    const b = [0.1, 0.5, 1];
    expect(histogramQuantile(0.5, b, [50, 50, 0, 0])).toBeCloseTo(0.1, 6);
    expect(histogramQuantile(0.95, b, [50, 50, 0, 0])).toBeCloseTo(0.46, 6);
    expect(histogramQuantile(0.99, b, [0, 0, 0, 10])).toBe(1);
    expect(histogramQuantile(0.5, b, [0, 0, 0, 0])).toBeUndefined();
  });
});

describe('HTTP server latency histogram', () => {
  it('records route templates (never raw URLs) with explicit buckets for p95/p99', async () => {
    const http = createHttpServerMetrics('karen-test');
    // 94 fast (20 ms), 5 slower (400 ms), 1 slow (3 s) → p95 in the 0.35–0.5 s bucket.
    for (let i = 0; i < 94; i += 1) {
      http.record({ method: 'get', route: '/v1/me', statusCode: 200, durationSeconds: 0.02 });
    }
    for (let i = 0; i < 5; i += 1) {
      http.record({ method: 'GET', route: '/v1/me', statusCode: 200, durationSeconds: 0.4 });
    }
    http.record({ method: 'GET', route: '/v1/me', statusCode: 200, durationSeconds: 3 });
    http.record({ method: 'GET', route: undefined, statusCode: 404, durationSeconds: 0.001 });
    http.record({ method: 'GET', route: '/v1/me', statusCode: 200, durationSeconds: Number.NaN });

    const metric = await find('http.server.request.duration');
    expect(metric?.descriptor.unit).toBe('s');
    const points = metric?.dataPoints ?? [];
    const me = points.find((p) => p.attributes['http.route'] === '/v1/me');
    const unmatched = points.find((p) => p.attributes['http.route'] === UNMATCHED_ROUTE);
    expect(unmatched?.attributes['http.response.status_code']).toBe(404);
    const h = me?.value as Histogram;
    expect(h.count).toBe(100); // NaN sample dropped
    expect(h.buckets.boundaries).toEqual([...HTTP_DURATION_BUCKETS_S]);
    const p95 = histogramQuantile(0.95, h.buckets.boundaries, h.buckets.counts) ?? 0;
    const p99 = histogramQuantile(0.99, h.buckets.boundaries, h.buckets.counts) ?? 0;
    expect(p95).toBeGreaterThan(0.35);
    expect(p95).toBeLessThanOrEqual(0.5);
    expect(p99).toBeGreaterThan(0.35);
    expect(p99).toBeLessThanOrEqual(0.5);
    expect(Object.keys(me?.attributes ?? {}).sort()).toEqual([
      'http.request.method',
      'http.response.status_code',
      'http.route',
    ]);
  });
});

describe('DB pool metrics', () => {
  it('reports idle/used connections, max and pending requests from the live pool object', async () => {
    const pool = { totalCount: 7, idleCount: 2, waitingCount: 3 };
    registerDbPoolMetrics('karen-test', 'api', pool, 10);
    const count = await find('db.client.connection.count');
    const byState = Object.fromEntries(
      (count?.dataPoints ?? []).map((p) => [p.attributes['db.client.connection.state'], p.value]),
    );
    expect(byState).toEqual({ idle: 2, used: 5 });
    expect((await find('db.client.connection.max'))?.dataPoints[0]?.value).toBe(10);
    expect((await find('db.client.connection.pending_requests'))?.dataPoints[0]?.value).toBe(3);
    pool.waitingCount = 0; // observable: re-read on every collection
    expect((await find('db.client.connection.pending_requests'))?.dataPoints[0]?.value).toBe(0);
  });
});
