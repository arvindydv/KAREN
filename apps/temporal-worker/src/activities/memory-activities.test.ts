import { ApplicationFailure } from '@temporalio/common';
import { describe, expect, it } from 'vitest';
import { MEMORY_HTTP_TIMEOUT_MS, createMemoryActivities } from './memory-activities.js';

const JOB = '3f2b6f6e-6d4c-4b7a-9a52-2a8b1c7d9e10';
const api = (
  status: number,
  body: unknown,
  seen?: { url?: string; headers?: Record<string, string> },
) =>
  (async (url: string, init: RequestInit) => {
    if (seen) Object.assign(seen, { url, headers: init.headers });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

describe('memory activities (signed worker → API calls)', () => {
  it('signs the call and returns the outcome code', async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const a = createMemoryActivities({
      apiBaseUrl: 'http://api.test/',
      secret: 's'.repeat(40),
      fetchImpl: api(200, { outcome: 'stored' }, seen),
    });
    expect(await a.runMemoryExtraction(JOB)).toEqual({ outcome: 'stored' });
    expect(seen.url).toBe(`http://api.test/internal/v1/memory/extraction-jobs/${JOB}/run`);
    expect(seen.headers!['x-karen-signature']).toMatch(/^t=\d+,v1=/);
  });

  it('4xx is non-retryable InternalCallRejected; 5xx/429 retryable; no body in the message', async () => {
    const reject = createMemoryActivities({
      apiBaseUrl: 'http://a',
      secret: 'x'.repeat(40),
      fetchImpl: api(404, { secret: 'BODY' }),
    });
    const e = await reject.runMemoryExtraction(JOB).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApplicationFailure);
    expect((e as ApplicationFailure).type).toBe('InternalCallRejected');
    expect((e as Error).message).not.toContain(JOB);
    expect((e as Error).message).not.toContain('BODY');
    for (const status of [500, 503, 429, 408]) {
      const r = createMemoryActivities({
        apiBaseUrl: 'http://a',
        secret: 'x'.repeat(40),
        fetchImpl: api(status, {}),
      });
      const err = await r.abandonMemoryExtraction(JOB).catch((x: unknown) => x);
      expect(err).not.toBeInstanceOf(ApplicationFailure);
    }
  });

  it('missing secret → ConfigError; malformed outcome → non-retryable', async () => {
    const none = createMemoryActivities({
      apiBaseUrl: 'http://a',
      secret: undefined,
      fetchImpl: api(200, {}),
    });
    await expect(none.runMemoryExtraction(JOB)).rejects.toMatchObject({ type: 'ConfigError' });
    const weird = createMemoryActivities({
      apiBaseUrl: 'http://a',
      secret: 'x'.repeat(40),
      fetchImpl: api(200, { outcome: 'I like tea' }),
    });
    await expect(weird.runMemoryExtraction(JOB)).rejects.toMatchObject({
      type: 'InternalCallRejected',
    });
  });

  it('SR-WF-06 the HTTP timeout stays below the 90 s activity timeout', () => {
    expect(MEMORY_HTTP_TIMEOUT_MS).toBeLessThan(90_000);
  });
});
