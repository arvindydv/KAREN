import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import {
  CONTRACT_VERSION,
  INTERNAL_SIGNATURE_HEADER,
  SPEECH_RESPONSE_HEADERS,
  completionRequestSchema,
  liveAudioChunkSchema,
  liveSessionCloseRequestSchema,
  liveSessionStartRequestSchema,
  speechRequestSchema,
  transcriptionRequestSchema,
  type CompletionRequest,
  type LiveEvent,
  type LiveSessionStartRequest,
  type SpeechRequest,
  type StreamEvent,
  type TranscriptionRequest,
} from '@karen/ai-model-contracts';

/**
 * Deterministic stand-in for apps/ai-service in API integration tests. Speaks the real internal
 * wire contract (every request is validated against `completionRequestSchema`; every event it
 * sends is a contract `StreamEvent`). Behaviour is chosen by directives in the latest user
 * message:
 *   [[stub:slow]]          ~150 ms between deltas        [[stub:hang]]   never finishes
 *   [[stub:fail=CODE]]     JSON refusal before streaming  [[stub:drop]]   socket closes mid-stream
 *   [[stub:fail_after=N]]  terminal `error` after N deltas
 *   [[stub:cost=0.08]]     reported cost in USD           [[stub:mock]]   is_mock=true
 *   [[stub:deterministic]] NO_MODEL route (no tokens billed)
 */
export interface AiStub {
  url: string;
  requests: CompletionRequest[];
  /** Voice (ADR-0026): validated against the speech contracts. Audio "MOCK:<text>" → <text>. */
  transcriptions: TranscriptionRequest[];
  speeches: SpeechRequest[];
  /**
   * Live sessions (ADR-0027): chunk "MOCK:<text>" speaks one turn; "[[stub:fail]]" ends the
   * session with a provider error. Close settles at $0.002 (not mock) so spend is observable.
   */
  liveStarts: LiveSessionStartRequest[];
  liveChunks: { sessionId: string; seq: number }[];
  /** Overrides the voices endpoint (e.g. to simulate voice disabled). */
  voicesDisabled: boolean;
  signed: boolean[];
  close(): Promise<void>;
}

interface StubLiveSession {
  userRef: string;
  events: LiveEvent[];
  chunks: number;
  closed: boolean;
  wake: (() => void)[];
}

const STUB_CATALOG = {
  contract_version: CONTRACT_VERSION,
  catalog_version: 'stub',
  tts_provider: 'deepgram',
  stt_provider: 'deepgram',
  live_available: true,
  speed_min: 0.7,
  speed_max: 1.5,
  voices: [
    {
      voice_id: 'stub-en-IN-female',
      language: 'en',
      accent: 'indian',
      gender: 'female',
      display_name: 'Stub Indian English',
      supports_speed: true,
    },
    {
      voice_id: 'stub-hi-IN-male',
      language: 'hi',
      accent: 'indian',
      gender: 'male',
      display_name: null,
      supports_speed: false,
    },
  ],
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startAiStub(): Promise<AiStub> {
  const requests: CompletionRequest[] = [];
  const transcriptions: TranscriptionRequest[] = [];
  const speeches: SpeechRequest[] = [];
  const liveStarts: LiveSessionStartRequest[] = [];
  const liveChunks: { sessionId: string; seq: number }[] = [];
  const live = new Map<string, StubLiveSession>();
  const stub = { voicesDisabled: false };
  const signed: boolean[] = [];
  const envelope = (code: string, status: number, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: { code, message: 'stub', retryable: false, request_id: null } }),
    );
  };
  const push = (session: StubLiveSession, event: LiveEvent) => {
    session.events.push(event);
    for (const wake of session.wake.splice(0)) wake();
  };
  const closeLive = (id: string, session: StubLiveSession, failed: boolean) => {
    if (session.closed) return;
    session.closed = true;
    push(session, {
      type: 'closed',
      usage: {
        session_id: id,
        status: failed ? 'failed' : 'succeeded',
        reason: failed ? 'provider_error' : 'client_closed',
        audio_seconds: session.chunks * 0.25,
        estimated_cost_usd: 0.002,
        served_model: 'stub/live',
        provider_request_id: 'dg-stub',
        is_mock: false,
      },
    });
  };
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.url === '/health/ready') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ready',
            gateway_mode: 'mock',
            contract_version: CONTRACT_VERSION,
          }),
        );
        return;
      }
      const url = new URL(req.url ?? '/', 'http://stub');
      if (req.method === 'GET' && url.pathname === '/internal/v1/audio/voices') {
        signed.push(typeof req.headers[INTERNAL_SIGNATURE_HEADER] === 'string');
        if (stub.voicesDisabled) return envelope('TIER_DISABLED', 503, res);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(STUB_CATALOG));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/internal/v1/audio/live-sessions') {
        signed.push(typeof req.headers[INTERNAL_SIGNATURE_HEADER] === 'string');
        const parsed = liveSessionStartRequestSchema.safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) return envelope('VALIDATION_ERROR', 422, res);
        liveStarts.push(parsed.data);
        const id = `lv_${Math.random().toString(36).slice(2).padEnd(12, 'x')}${Date.now()}stub`;
        const session: StubLiveSession = {
          userRef: parsed.data.user_ref,
          events: [{ type: 'ready' }],
          chunks: 0,
          closed: false,
          wake: [],
        };
        live.set(id.replace(/[^A-Za-z0-9_]/g, ''), session);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            contract_version: CONTRACT_VERSION,
            session_id: id.replace(/[^A-Za-z0-9_]/g, ''),
            served_model: 'stub/live',
            is_mock: false,
            max_seconds: 300,
            idle_seconds: 20,
            reserved_cost_usd: 0.039,
          }),
        );
        return;
      }
      const liveMatch =
        /^\/internal\/v1\/audio\/live-sessions\/(lv_[A-Za-z0-9]+)\/(audio|close|events)$/.exec(
          url.pathname,
        );
      if (liveMatch) {
        signed.push(typeof req.headers[INTERNAL_SIGNATURE_HEADER] === 'string');
        const [, id = '', action] = liveMatch;
        const session = live.get(id);
        if (action === 'events') {
          if (!session || session.userRef !== url.searchParams.get('user_ref')) {
            return envelope('NOT_FOUND', 404, res);
          }
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          let index = Number(url.searchParams.get('after') ?? 0);
          for (;;) {
            while (index < session.events.length) {
              const event = session.events[index++];
              res.write(`id: ${index}\nevent: ${event?.type}\ndata: ${JSON.stringify(event)}\n\n`);
              if (event?.type === 'closed') return void res.end();
            }
            await new Promise<void>((r) => session.wake.push(r));
          }
        }
        const raw: unknown = JSON.parse(await readBody(req));
        const schema = action === 'audio' ? liveAudioChunkSchema : liveSessionCloseRequestSchema;
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return envelope('VALIDATION_ERROR', 422, res);
        if (!session || session.userRef !== parsed.data.user_ref) {
          return envelope('NOT_FOUND', 404, res);
        }
        if (action === 'close') {
          closeLive(id, session, false);
          res.writeHead(202);
          return void res.end();
        }
        const chunk = liveAudioChunkSchema.parse(raw);
        liveChunks.push({ sessionId: id, seq: chunk.seq });
        session.chunks++;
        const audio = Buffer.from(chunk.audio_base64, 'base64').toString('utf8');
        if (audio.includes('[[stub:fail]]')) {
          push(session, { type: 'error', code: 'PROVIDER_ERROR', retryable: true });
          closeLive(id, session, true);
        } else if (audio.startsWith('MOCK:')) {
          const text = audio.slice(5);
          const turn = session.events.filter((e) => e.type === 'end_of_turn').length;
          push(session, { type: 'speech_started', turn_index: turn });
          push(session, { type: 'partial', turn_index: turn, text: text.split(' ')[0] ?? '' });
          push(session, {
            type: 'end_of_turn',
            turn_index: turn,
            text,
            language: /[\u0900-\u097F]/.test(text) ? 'hi' : 'en',
          });
        }
        res.writeHead(204);
        return void res.end();
      }
      if (req.method === 'POST' && req.url === '/internal/v1/audio/transcriptions') {
        signed.push(typeof req.headers[INTERNAL_SIGNATURE_HEADER] === 'string');
        const parsed = transcriptionRequestSchema.safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) {
          res.writeHead(422, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'contract',
                retryable: false,
                request_id: null,
              },
            }),
          );
          return;
        }
        transcriptions.push(parsed.data);
        const audio = Buffer.from(parsed.data.audio_base64, 'base64').toString('utf8');
        const text = audio.startsWith('MOCK:') ? audio.slice(5) : '[stub] voice note';
        if (text.includes('[[stub:fail=')) {
          const code = /\[\[stub:fail=([A-Z_]+)\]\]/.exec(text)?.[1] ?? 'GATEWAY_PROVIDER_ERROR';
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { code, message: 'stub refusal', retryable: false, request_id: null },
            }),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            contract_version: CONTRACT_VERSION,
            request_id: parsed.data.request_id,
            text,
            language: /[\u0900-\u097F]/.test(text) ? 'hi' : 'en',
            duration_seconds: 1.5,
            served_model: 'stub/stt',
            estimated_cost_usd: text.includes('[[stub:mock]]') ? 0 : 0.004,
            is_mock: text.includes('[[stub:mock]]'),
          }),
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/internal/v1/audio/speech') {
        signed.push(typeof req.headers[INTERNAL_SIGNATURE_HEADER] === 'string');
        const parsed = speechRequestSchema.safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) {
          res.writeHead(422, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'contract',
                retryable: false,
                request_id: null,
              },
            }),
          );
          return;
        }
        speeches.push(parsed.data);
        res.writeHead(200, {
          'content-type': 'audio/mpeg',
          [SPEECH_RESPONSE_HEADERS.voiceId]: `stub-${parsed.data.voice.accent}`,
          [SPEECH_RESPONSE_HEADERS.language]: 'en',
          [SPEECH_RESPONSE_HEADERS.isMock]: 'false',
          [SPEECH_RESPONSE_HEADERS.estimatedCostUsd]: '0.015000',
          [SPEECH_RESPONSE_HEADERS.textTruncated]: 'false',
        });
        res.write(Buffer.from('ID3stub-audio-1'));
        await sleep(20);
        res.end(Buffer.from('stub-audio-2'));
        return;
      }
      if (req.method !== 'POST' || req.url !== '/internal/v1/completions/stream') {
        res.writeHead(404).end();
        return;
      }
      const raw = await readBody(req);
      const parsed = completionRequestSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'contract',
              retryable: false,
              request_id: null,
            },
          }),
        );
        return;
      }
      const body = parsed.data;
      requests.push(body);
      signed.push(typeof req.headers[INTERNAL_SIGNATURE_HEADER] === 'string');
      const last = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const directive = (name: string) =>
        new RegExp(`\\[\\[stub:${name}(?:=([A-Z_0-9.]+))?\\]\\]`).exec(last);
      const fail = directive('fail');
      if (fail?.[1]) {
        res.writeHead(fail[1] === 'BUDGET_EXCEEDED' ? 429 : 503, {
          'content-type': 'application/json',
        });
        res.end(
          JSON.stringify({
            error: {
              code: fail[1],
              message: 'stub refusal',
              retryable: false,
              request_id: body.request_id,
            },
          }),
        );
        return;
      }
      const deterministic = Boolean(directive('deterministic'));
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (e: StreamEvent) =>
        res.write(`event: ${e.event}\ndata: ${JSON.stringify(e)}\n\n`);
      send({
        event: 'start',
        request_id: body.request_id,
        route_tier: deterministic ? 'NO_MODEL' : 'BALANCED',
        served_model: deterministic ? null : 'test-creator/balanced',
        is_mock: Boolean(directive('mock')),
      });
      const words =
        `Answer to ${body.messages.filter((m) => m.role === 'user').length} question(s) in ${body.locale ?? 'unknown'} with care and detail`.split(
          ' ',
        );
      const failAfter = directive('fail_after')?.[1];
      const slow = Boolean(directive('slow')) || Boolean(directive('hang'));
      for (let i = 0; i < words.length; i++) {
        if (failAfter !== undefined && i === Number(failAfter)) {
          send({
            event: 'error',
            code: 'GATEWAY_PROVIDER_ERROR',
            message: 'upstream',
            retryable: true,
          });
          res.end();
          return;
        }
        if (directive('drop') && i === 3) {
          await sleep(100); // let already-written deltas reach the client, then reset
          res.socket?.destroy();
          return;
        }
        if (res.destroyed) return;
        send({ event: 'delta', index: i, text: (i === 0 ? '' : ' ') + words[i] });
        if (slow) await sleep(150);
      }
      if (directive('hang')) {
        await new Promise<void>((resolve) => res.on('close', () => resolve()));
        return;
      }
      const cost = Number(directive('cost')?.[1] ?? '0.001');
      send({
        event: 'done',
        finish_reason: deterministic ? 'no_model' : 'stop',
        usage: {
          input_tokens: 40,
          output_tokens: words.length,
          cached_tokens: null,
          reasoning_tokens: null,
        },
        estimated_cost_usd: deterministic ? 0 : cost,
        requested_model: deterministic ? null : 'test-creator/balanced',
        served_model: deterministic ? null : 'test-creator/balanced',
        gateway_request_id: deterministic ? null : 'gw_stub_1',
        prompt_version: deterministic ? null : 'chat.v2',
      });
      res.end();
    })().catch(() => res.destroy());
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    transcriptions,
    speeches,
    liveStarts,
    liveChunks,
    get voicesDisabled() {
      return stub.voicesDisabled;
    },
    set voicesDisabled(value: boolean) {
      stub.voicesDisabled = value;
    },
    signed,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Parses an SSE body into events (data JSON) and the count of heartbeat comments. */
export function parseSse(body: string): { events: Record<string, unknown>[]; heartbeats: number } {
  const events: Record<string, unknown>[] = [];
  let heartbeats = 0;
  for (const frame of body.split('\n\n')) {
    if (frame.startsWith(': ping')) heartbeats++;
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (data) events.push(JSON.parse(data) as Record<string, unknown>);
  }
  return { events, heartbeats };
}
