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
      contract_version: '2026-11-22.v3',
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

describe('AiServiceClient voice (ADR-0027)', () => {
  const sse = (frames: string[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const f of frames) controller.enqueue(new TextEncoder().encode(f));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );

  it('signs the voices GET, validates and caches the catalog', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new AiServiceClient(env, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(fixture('voice-catalog-response.mock.json')));
    }) as typeof fetch);
    const first = await client.voices('req-voices-0001');
    const second = await client.voices('req-voices-0002');
    expect(first.voices).toHaveLength(2);
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://ai.test/internal/v1/audio/voices');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-karen-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('sends audio chunks without a request_id field (contract has none)', async () => {
    let body: Record<string, unknown> = {};
    const client = new AiServiceClient(env, (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    await client.appendLiveAudio(
      'lv_0123456789abcdef0123456789abcdef',
      { user_ref: 'usr_hmac_test01', seq: 3, audio_base64: 'AAAA' },
      'req-live-0001',
    );
    expect(body).toEqual({
      contract_version: '2026-11-22.v3',
      user_ref: 'usr_hmac_test01',
      seq: 3,
      audio_base64: 'AAAA',
    });
  });

  it('streams live events with their resume ids and stops after closed', async () => {
    const events = fixture('live-events.mock.json') as unknown[];
    const frames = events.map((e, i) => `id: ${i + 1}\nevent: x\ndata: ${JSON.stringify(e)}\n\n`);
    const client = new AiServiceClient(env, async () =>
      sse([': keep-alive\n\n', ...frames, 'data: {"type":"ready"}\n\n']),
    );
    const out = [];
    for await (const frame of client.liveEvents(
      'lv_0123456789abcdef0123456789abcdef',
      'usr_hmac_test01',
      null,
      'req-live-0001',
      new AbortController().signal,
    )) {
      out.push(frame);
    }
    expect(out.map((f) => f.event.type)).toEqual([
      'ready',
      'speech_started',
      'partial',
      'end_of_turn',
      'error',
      'closed',
    ]);
    expect(out[0]?.id).toBe('1');
  });

  it('rejects a live event that violates the contract', async () => {
    const client = new AiServiceClient(env, async () =>
      sse(['data: {"type":"transcript_dump","text":"x"}\n\n']),
    );
    const iterate = async () => {
      for await (const _ of client.liveEvents(
        'lv_0123456789abcdef0123456789abcdef',
        'usr_hmac_test01',
        null,
        'req-live-0001',
        new AbortController().signal,
      )) {
        /* consume */
      }
    };
    await expect(iterate()).rejects.toMatchObject({ code: 'AI_SERVICE_CONTRACT_VIOLATION' });
  });

  it('maps a NOT_FOUND session envelope to a typed error', async () => {
    const client = new AiServiceClient(
      env,
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'NOT_FOUND',
              message: 'Live session not found.',
              retryable: false,
              request_id: null,
            },
          }),
          { status: 404 },
        ),
    );
    await expect(
      client.closeLiveSession('lv_0123456789abcdef0123456789abcdef', 'usr_hmac_test01', 'r1'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });
});
