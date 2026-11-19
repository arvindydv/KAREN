import { describe, expect, it } from 'vitest';
import { createKarenApiClient } from './client.js';

describe('generated typed API client', () => {
  it('calls typed paths with bearer auth and a request id, and parses JSON', async () => {
    const seen: Request[] = [];
    const fakeFetch = async (input: Request | string | URL) => {
      const req = input instanceof Request ? input : new Request(input);
      seen.push(req);
      return new Response(JSON.stringify({ status: 'ok', service: 'karen-api', version: 'dev' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = createKarenApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => 'token-abc',
      fetch: fakeFetch,
    });
    const { data, error } = await client.GET('/health/live');
    expect(error).toBeUndefined();
    expect(data?.status).toBe('ok');
    expect(seen[0]?.url).toBe('http://api.test/health/live');
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer token-abc');
    expect(seen[0]?.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('omits the authorization header when signed out and surfaces typed errors', async () => {
    const client = createKarenApiClient({
      baseUrl: 'http://api.test',
      fetch: (async (input: Request) => {
        expect(input.headers.has('authorization')).toBe(false);
        return new Response(
          JSON.stringify({
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Authentication is required.',
              correlation_id: 'r',
              retryable: false,
            },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch,
    });
    const { error, response } = await client.GET('/v1/me');
    expect(response.status).toBe(401);
    expect(error?.error.code).toBe('UNAUTHENTICATED');
  });
});
