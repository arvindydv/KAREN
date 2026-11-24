import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { internalRequestSigningString, signTimestamped } from '@karen/domain/node';
import { internalSignatureVectors } from '@karen/test-fixtures';
import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '../../config/env.js';
import { CONTRACT_VERSION } from '@karen/ai-model-contracts';
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
      contract_version: CONTRACT_VERSION,
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

describe('AiServiceClient.stream', () => {
  const input = {
    request_id: 'req_stream_0001',
    task_kind: 'CHAT' as const,
    messages: [{ role: 'user' as const, content: 'hi' }],
    user_ref: 'usr_hmac_test01',
  };
  const sse = (chunks: string[], status = 200) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      }),
      { status, headers: { 'content-type': 'text/event-stream' } },
    );
  const frames = (events: unknown[]) =>
    events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`);
  const collect = async (client: AiServiceClient) => {
    const out: unknown[] = [];
    for await (const e of client.stream(input)) out.push(e);
    return out;
  };

  it('parses the shared fixture stream, even when frames are split across chunks', async () => {
    const events = fixture('stream-events.mock.json') as unknown[];
    const text = frames(events).join('').replace(/\n/g, '\r\n');
    const chunks = text.match(/[\s\S]{1,7}/g) ?? [];
    let headers: Headers | undefined;
    const client = new AiServiceClient(env, (async (_u: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return sse(chunks);
    }) as typeof fetch);
    expect(await collect(client)).toEqual(events);
    expect(headers?.get('x-karen-signature')).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(headers?.get('accept')).toBe('text/event-stream');
  });

  it('turns a pre-stream refusal into AiServiceError with the contract code', async () => {
    const client = new AiServiceClient(
      env,
      async () =>
        new Response(JSON.stringify(fixture('error.budget-exceeded.json')), { status: 429 }),
    );
    await expect(collect(client)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });

  it('rejects frames that violate the contract', async () => {
    const client = new AiServiceClient(env, async () =>
      sse(frames([{ event: 'delta', index: 0, text: 'x', extra: true }])),
    );
    await expect(collect(client)).rejects.toMatchObject({ code: 'AI_SERVICE_CONTRACT_VIOLATION' });
  });

  it('reports a stream that ends without done/error as dropped (retryable, never replayed)', async () => {
    let calls = 0;
    const client = new AiServiceClient(env, async () => {
      calls++;
      return sse(frames([{ event: 'delta', index: 0, text: 'partial' }]));
    });
    await expect(collect(client)).rejects.toMatchObject({
      code: 'AI_SERVICE_STREAM_DROPPED',
      retryable: true,
    });
    expect(calls).toBe(1);
  });

  it('maps a connection failure to AI_SERVICE_UNREACHABLE', async () => {
    const client = new AiServiceClient(env, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(collect(client)).rejects.toBeInstanceOf(AiServiceError);
    await expect(collect(client)).rejects.toMatchObject({ code: 'AI_SERVICE_UNREACHABLE' });
  });
});

describe('AiServiceClient — contract v5 outbound validation (M4a)', () => {
  const failingFetch = (async () => {
    throw new Error('must not be called');
  }) as unknown as typeof fetch;

  it('sends a valid v5 memory request unchanged', async () => {
    let sent: Record<string, unknown> | undefined;
    const client = new AiServiceClient(env, (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(fixture('completion-response.mock.json')), {
        status: 200,
      });
    }) as typeof fetch);
    const { contract_version: _cv, ...input } = fixture(
      'completion-request.v5-memory.valid.json',
    ) as Record<string, unknown>;
    await client.complete(input as never);
    expect(sent?.memory_status).toBe('on');
    expect((sent?.memory_context as unknown[]).length).toBe(4);
  });

  it.each(['context-without-on', 'delimiter', 'system-with-memory', '21-items'])(
    'refuses %s locally: no network call, no content in the error',
    async (name) => {
      const client = new AiServiceClient(env, failingFetch);
      const { contract_version: _cv, ...input } = fixture(
        `completion-request.v5-invalid-${name}.json`,
      ) as Record<string, unknown>;
      const err = await client.complete(input as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiServiceError);
      expect((err as AiServiceError).code).toBe('VALIDATION_ERROR');
      expect((err as AiServiceError).retryable).toBe(false);
      expect((err as Error).message).not.toMatch(/vegetarian|system>|पुणे/);
    },
  );
});

describe('AiServiceClient.extractMemory (M5a, T-CTR-06…08)', () => {
  const extractInput = () => {
    const { contract_version: _cv, ...input } = fixture(
      'memory-extract-request.valid.json',
    ) as Record<string, unknown>;
    return input as never;
  };
  const reply = (status: number, b: unknown) =>
    (async () => new Response(JSON.stringify(b), { status })) as unknown as typeof fetch;

  it('signs the request and returns a contract-valid response', async () => {
    let headers: Record<string, string> = {};
    const client = new AiServiceClient(env, (async (_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify(fixture('memory-extract-response.mock.json')), {
        status: 200,
      });
    }) as typeof fetch);
    const res = await client.extractMemory(extractInput());
    expect(res.is_mock).toBe(true);
    expect(res.candidates).toHaveLength(2);
    expect(headers['x-karen-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('rejects an untrusted response that violates the contract or answers another request', async () => {
    const bad = new AiServiceClient(
      env,
      reply(200, fixture('memory-extract-response.invalid-sensitivity.json')),
    );
    await expect(bad.extractMemory(extractInput())).rejects.toMatchObject({
      code: 'AI_SERVICE_CONTRACT_VIOLATION',
      retryable: false,
    });
    const other = {
      ...(fixture('memory-extract-response.mock.json') as object),
      request_id: 'memx_someone-else_1',
    };
    await expect(
      new AiServiceClient(env, reply(200, other)).extractMemory(extractInput()),
    ).rejects.toMatchObject({ code: 'AI_SERVICE_CONTRACT_VIOLATION' });
  });

  it('maps 5xx/network as retryable and 4xx as non-retryable; never echoes content', async () => {
    await expect(
      new AiServiceClient(env, reply(503, { nope: true })).extractMemory(extractInput()),
    ).rejects.toMatchObject({ retryable: true, httpStatus: 503 });
    await expect(
      new AiServiceClient(env, reply(422, fixture('error.budget-exceeded.json'))).extractMemory(
        extractInput(),
      ),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    const down = new AiServiceClient(env, async () => {
      throw new Error('ECONNREFUSED');
    });
    const err = await down.extractMemory(extractInput()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'AI_SERVICE_UNREACHABLE', retryable: true });
    expect((err as Error).message).not.toMatch(/vegetarian|cilantro/);
  });

  it('refuses an invalid outgoing request locally (too long message)', async () => {
    const client = new AiServiceClient(env, async () => {
      throw new Error('must not be called');
    });
    const { contract_version: _cv, ...input } = fixture(
      'memory-extract-request.invalid-too-long.json',
    ) as Record<string, unknown>;
    await expect(client.extractMemory(input as never)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
