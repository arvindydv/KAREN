import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INTERNAL_SIGNATURE_HEADER } from '@karen/ai-model-contracts';
import { internalRequestSigningString, verifyTimestamped } from '@karen/domain/node';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataRightsActivities } from './data-rights-activities.js';

const SECRET = 'test-only-internal-hmac-secret-0123456789';

describe('data-rights activities (signed internal HTTP)', () => {
  let server: Server;
  let base = '';
  let status = 200;
  const seen: { path: string; valid: boolean }[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const path = req.url ?? '';
      const result = verifyTimestamped({
        secret: SECRET,
        payload: internalRequestSigningString(req.method ?? '', path, ''),
        header: req.headers[INTERNAL_SIGNATURE_HEADER] as string | undefined,
        nowUnixSeconds: Math.floor(Date.now() / 1000),
        toleranceSeconds: 300,
      });
      seen.push({ path, valid: result.ok });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          path.endsWith('/export')
            ? { outcome: 'ready', expiresInSeconds: null }
            : { outcome: 'completed' },
        ),
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const id = '6f1c2b9e-0000-4000-8000-000000000001';

  it('signs every call so the API can verify it', async () => {
    status = 200;
    const a = createDataRightsActivities({ apiBaseUrl: base, secret: SECRET });
    expect(await a.executeErasure(id)).toBe('completed');
    expect(await a.buildExport(id)).toEqual({ outcome: 'ready', expiresInSeconds: null });
    expect(seen.slice(-2).every((s) => s.valid)).toBe(true);
    expect(seen.at(-1)?.path).toBe(`/internal/v1/data-rights/${id}/export`);
  });

  it('4xx is non-retryable; 5xx is retryable; missing secret refuses to call', async () => {
    const a = createDataRightsActivities({ apiBaseUrl: base, secret: SECRET });
    status = 404;
    await expect(a.executeErasure(id)).rejects.toBeInstanceOf(ApplicationFailure);
    status = 503;
    const err = await a.executeErasure(id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApplicationFailure);
    const unconfigured = createDataRightsActivities({ apiBaseUrl: base, secret: undefined });
    await expect(unconfigured.executeErasure(id)).rejects.toMatchObject({ nonRetryable: true });
  });
});
