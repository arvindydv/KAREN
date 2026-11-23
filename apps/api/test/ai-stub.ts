import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import {
  CONTRACT_VERSION,
  INTERNAL_SIGNATURE_HEADER,
  completionRequestSchema,
  type CompletionRequest,
  type StreamEvent,
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
  signed: boolean[];
  close(): Promise<void>;
}

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
  const signed: boolean[] = [];
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
