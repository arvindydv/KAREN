import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { internalRequestSigningString, signTimestamped } from '@karen/domain/node';
import { internalSignatureVectors } from '@karen/test-fixtures';
import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '../../config/env.js';
import { AiServiceClient, AiServiceError } from './ai-service.client.js';

const require = createRequire(import.meta.url);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(require.resolve(`@karen/ai-model-contracts/fixtures/${name}`), 'utf8'));

const env = loadApiEnv({
  DATABASE_URL: 'postgresql://x',
  REDIS_URL: 'redis://x',
  AUTH_MODE: 'local-dev',
  AI_SERVICE_URL: 'http://ai.test',
  INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789abcdef',
});

describe('internal request signing', () => {
  it('reproduces the shared cross-language test vectors exactly', () => {
    const { secret, vectors } = internalSignatureVectors();
    for (const v of vectors) {
      const signing = internalRequestSigningString(v.method, v.path_with_query, v.body);
      expect(signing).toBe(v.signing_string);
      expect(signTimestamped(secret, signing, v.timestamp)).toBe(v.header);
    }
  });
});

describe('AiServiceClient', () => {
  it('sends a signed, contract-versioned request and validates the response', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const client = new AiServiceClient(env, (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify(fixture('completion-response.mock.json')), {
        status: 200,
      });
    }) as typeof fetch);
    const req = fixture('completion-request.valid.json') as Record<string, unknown>;
    const { contract_version: _cv, ...input } = req;
    const res = await client.complete(input as never);
    expect(res.is_mock).toBe(true);
    const headers = captured?.init.headers as Record<string, string>;
    expect(captured?.url).toBe('http://ai.test/internal/v1/completions');
    expect(headers['x-karen-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(headers['x-karen-caller']).toBe('karen-api');
    expect(JSON.parse(captured?.init.body as string)).toMatchObject({
      contract_version: '2026-11-19.v1',
    });
  });

  it('maps the AI error envelope to a typed error', async () => {
    const client = new AiServiceClient(
      env,
      async () =>
        new Response(JSON.stringify(fixture('error.budget-exceeded.json')), { status: 403 }),
    );
    await expect(
      client.complete({
        request_id: 'req_12345678',
        task_kind: 'CHAT',
        messages: [{ role: 'user', content: 'hi' }],
        user_ref: 'usr_12345678',
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', retryable: false, httpStatus: 403 });
  });

  it('rejects responses that violate the contract instead of trusting them', async () => {
    const client = new AiServiceClient(
      env,
      async () => new Response(JSON.stringify({ output_text: 'hi' }), { status: 200 }),
    );
    await expect(
      client.complete({
        request_id: 'req_12345678',
        task_kind: 'CHAT',
        messages: [{ role: 'user', content: 'hi' }],
        user_ref: 'usr_12345678',
      }),
    ).rejects.toBeInstanceOf(AiServiceError);
  });
});
