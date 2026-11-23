import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/conversation/maintenance.service.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { parseSse, startAiStub, type AiStub } from './ai-stub.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/**
 * Phase 02 P2-M2…M4: conversations, messages, streaming, recovery, limits (integration).
 * Real API + real Postgres (runtime role, RLS) + real Redis; the AI service is a contract-
 * validating stub (test/ai-stub.ts) so failures can be produced deterministically.
 */
type Sse = { events: Record<string, unknown>[]; heartbeats: number };
const idsOf = (body: unknown) => (body as { items: { id: string }[] }).items.map((t) => t.id);
const eventTypes = (s: Sse) => s.events.map((e) => e.type);
const streamedText = (s: Sse) =>
  s.events
    .filter((e) => e.type === 'token_delta')
    .map((e) => e.text as string)
    .join('');

describe('conversations (integration)', () => {
  let app: NestFastifyApplication;
  let base: string;
  let stub: AiStub;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const runtime = new PrismaService(testEnv());
  const h = harness(() => app);

  beforeAll(async () => {
    await ensureDraftNotices(owner);
    stub = await startAiStub();
    app = await startApp({
      AI_SERVICE_URL: stub.url,
      CHAT_MAINTENANCE_INTERVAL_SECONDS: '0',
      CHAT_GENERATION_TIMEOUT_SECONDS: '5',
      CHAT_STREAM_HEARTBEAT_SECONDS: '1',
      CHAT_MESSAGES_PER_MINUTE: '500',
      CHAT_DAILY_LIMIT_USD: '100',
      CHAT_MONTHLY_LIMIT_USD: '1000',
      API_BODY_LIMIT_BYTES: '65536',
    });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    await stub.close();
    await Promise.all([owner.$disconnect(), runtime.$disconnect()]);
  });

  const grant = async (auth: string) =>
    h
      .http()
      .put('/v1/me/consents/AI_PROCESSING')
      .set('authorization', auth)
      .set('if-match', '"0"')
      .send({ decision: 'grant', notice_version: TEST_NOTICE_VERSION, source: 'settings' })
      .expect(200);

  const account = async (tag: string, consent = true) => {
    const s = await h.signIn(await h.activeAccount(tag));
    if (consent) await grant(s.auth);
    return s;
  };

  const createThread = async (auth: string, body: object = {}) =>
    (await h.http().post('/v1/conversations').set('authorization', auth).send(body).expect(201))
      .body as { id: string; version: number; title: string };

  const send = (auth: string, id: string, content: string, key = randomUUID()) =>
    h
      .http()
      .post(`/v1/conversations/${id}/messages`)
      .set('authorization', auth)
      .set('idempotency-key', key)
      .send({ content });

  /** Reads an SSE stream to its end (or until `stopAfter` events, then disconnects). */
  const stream = async (
    auth: string,
    path: string,
    opts: { lastEventId?: number; stopAfter?: number } = {},
  ): Promise<Sse & { status: number }> => {
    const abort = new AbortController();
    const res = await fetch(`${base}${path}`, {
      headers: {
        authorization: auth,
        ...(opts.lastEventId !== undefined ? { 'last-event-id': String(opts.lastEventId) } : {}),
      },
      signal: abort.signal,
    });
    if (res.status !== 200 || !res.body) {
      return { status: res.status, events: [], heartbeats: 0 };
    }
    let text = '';
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
      if (opts.stopAfter && parseSse(text).events.length >= opts.stopAfter) {
        abort.abort();
        break;
      }
    }
    return { status: 200, ...parseSse(text) };
  };

  const message = async (auth: string, cid: string, mid: string) =>
    (
      await h
        .http()
        .get(`/v1/conversations/${cid}/messages/${mid}`)
        .set('authorization', auth)
        .expect(200)
    ).body as Record<string, unknown>;

  // ── Threads ──────────────────────────────────────────────────────────────────────────

  describe('threads', () => {
    it('create → get (ETag) → rename with If-Match → stale 412 → missing 428', async () => {
      const s = await account('conv-crud', false);
      const t = await createThread(s.auth, { title: 'Trip ideas' });
      expect(t).toMatchObject({ title: 'Trip ideas', mode: 'standard', pinned: false, version: 0 });
      const got = await h.http().get(`/v1/conversations/${t.id}`).set('authorization', s.auth);
      expect(got.status).toBe(200);
      expect(got.headers.etag).toBe('"0"');
      const renamed = await h
        .http()
        .patch(`/v1/conversations/${t.id}`)
        .set('authorization', s.auth)
        .set('if-match', '"0"')
        .send({ title: 'Goa trip', pinned: true })
        .expect(200);
      expect(renamed.body).toMatchObject({ title: 'Goa trip', pinned: true, version: 1 });
      await h
        .http()
        .patch(`/v1/conversations/${t.id}`)
        .set('authorization', s.auth)
        .set('if-match', '"0"')
        .send({ title: 'stale' })
        .expect(412);
      await h
        .http()
        .patch(`/v1/conversations/${t.id}`)
        .set('authorization', s.auth)
        .send({ title: 'x' })
        .expect(428);
      await h
        .http()
        .patch(`/v1/conversations/${t.id}`)
        .set('authorization', s.auth)
        .set('if-match', '"1"')
        .send({})
        .expect(400);
    });

    it('lists pinned first, paginates with an opaque cursor, filters archived, searches', async () => {
      const s = await account('conv-list');
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await createThread(s.auth, { title: `T${i}` })).id);
      await h
        .http()
        .patch(`/v1/conversations/${ids[0]}`)
        .set('authorization', s.auth)
        .set('if-match', '"0"')
        .send({ pinned: true })
        .expect(200);
      await h
        .http()
        .patch(`/v1/conversations/${ids[4]}`)
        .set('authorization', s.auth)
        .set('if-match', '"0"')
        .send({ archived: true })
        .expect(200);
      const page1 = await h
        .http()
        .get('/v1/conversations?limit=2')
        .set('authorization', s.auth)
        .expect(200);
      expect(page1.body.items[0].id).toBe(ids[0]);
      expect(page1.body.items).toHaveLength(2);
      const page2 = await h
        .http()
        .get(`/v1/conversations?limit=2&cursor=${page1.body.next_cursor as string}`)
        .set('authorization', s.auth)
        .expect(200);
      const seen = [...page1.body.items, ...page2.body.items].map((t: { id: string }) => t.id);
      expect(new Set(seen).size).toBe(4);
      expect(seen).not.toContain(ids[4]);
      expect(page2.body.next_cursor).toBeNull();
      const archived = await h
        .http()
        .get('/v1/conversations?archived=only')
        .set('authorization', s.auth)
        .expect(200);
      expect(idsOf(archived.body)).toEqual([ids[4]]);
      await h
        .http()
        .get('/v1/conversations?cursor=garbage')
        .set('authorization', s.auth)
        .expect(400);

      const withMsg = await createThread(s.auth);
      await send(s.auth, withMsg.id, 'Remind me about the passport renewal 100%_done').expect(202);
      const found = await h
        .http()
        .get(`/v1/conversations?q=${encodeURIComponent('PASSPORT')}`)
        .set('authorization', s.auth)
        .expect(200);
      expect(idsOf(found.body)).toEqual([withMsg.id]);
      // LIKE metacharacters are literal.
      const literal = await h
        .http()
        .get(`/v1/conversations?q=${encodeURIComponent('%_d')}`)
        .set('authorization', s.auth)
        .expect(200);
      expect(idsOf(literal.body)).toEqual([withMsg.id]);
    });

    it('never exposes another user’s conversations (404 everywhere, nothing listed)', async () => {
      const a = await account('conv-owner');
      const b = await account('conv-intruder');
      const t = await createThread(a.auth);
      const sent = await send(a.auth, t.id, 'private question').expect(202);
      const mid = sent.body.assistant_message.id as string;
      await stream(a.auth, sent.body.stream_path as string);
      const B = b.auth;
      await h.http().get(`/v1/conversations/${t.id}`).set('authorization', B).expect(404);
      await h.http().get(`/v1/conversations/${t.id}/messages`).set('authorization', B).expect(404);
      await h
        .http()
        .patch(`/v1/conversations/${t.id}`)
        .set('authorization', B)
        .set('if-match', '"0"')
        .send({ title: 'x' })
        .expect(404);
      await send(B, t.id, 'inject').expect(404);
      expect((await stream(B, sent.body.stream_path as string)).status).toBe(404);
      await h
        .http()
        .post(`/v1/conversations/${t.id}/messages/${mid}/cancel`)
        .set('authorization', B)
        .expect(404);
      await h
        .http()
        .post(`/v1/conversations/${t.id}/messages/${mid}/feedback`)
        .set('authorization', B)
        .send({ rating: 'down' })
        .expect(404);
      await h
        .http()
        .post(`/v1/conversations/${t.id}/messages/${mid}/regenerate`)
        .set('authorization', B)
        .set('idempotency-key', randomUUID())
        .expect(404);
      await h.http().delete(`/v1/conversations/${t.id}`).set('authorization', B).expect(404);
      const listed = await h.http().get('/v1/conversations').set('authorization', B).expect(200);
      expect(listed.body.items).toEqual([]);
      await h.http().get(`/v1/conversations/${t.id}`).set('authorization', a.auth).expect(200);
    });

    it('delete is permanent and audited; unauthenticated calls are 401', async () => {
      const s = await account('conv-delete');
      const t = await createThread(s.auth);
      await send(s.auth, t.id, 'hello').expect(202);
      await h.http().delete(`/v1/conversations/${t.id}`).set('authorization', s.auth).expect(204);
      await h.http().get(`/v1/conversations/${t.id}`).set('authorization', s.auth).expect(404);
      expect(await owner.conversationMessage.count({ where: { threadId: t.id } })).toBe(0);
      expect(
        await owner.auditEvent.count({
          where: { action: 'conversation.deleted', subjectId: t.id },
        }),
      ).toBe(1);
      await h.http().get('/v1/conversations').expect(401);
    });
  });

  // ── Consent ──────────────────────────────────────────────────────────────────────────

  it('AI_PROCESSING consent gates sending; reading and deleting never need it', async () => {
    const s = await account('conv-consent', false);
    const t = await createThread(s.auth);
    const denied = await send(s.auth, t.id, 'hello').expect(403);
    expect(denied.body.error.code).toBe('CONSENT_REQUIRED');
    expect(denied.body.error.next_options).toEqual(['GRANT_CONSENT:AI_PROCESSING']);
    await grant(s.auth);
    const ok = await send(s.auth, t.id, 'hello').expect(202);
    await stream(s.auth, ok.body.stream_path as string);
    await h
      .http()
      .put('/v1/me/consents/AI_PROCESSING')
      .set('authorization', s.auth)
      .set('if-match', '"1"')
      .send({ decision: 'revoke', notice_version: TEST_NOTICE_VERSION, source: 'settings' })
      .expect(200);
    await send(s.auth, t.id, 'again').expect(403);
    await h
      .http()
      .post(
        `/v1/conversations/${t.id}/messages/${ok.body.assistant_message.id as string}/regenerate`,
      )
      .set('authorization', s.auth)
      .set('idempotency-key', randomUUID())
      .expect(403);
    await h
      .http()
      .get(`/v1/conversations/${t.id}/messages`)
      .set('authorization', s.auth)
      .expect(200);
    await h.http().delete(`/v1/conversations/${t.id}`).set('authorization', s.auth).expect(204);
  });

  // ── Send + stream ────────────────────────────────────────────────────────────────────

  describe('send and stream', () => {
    it('stores the user message first, streams ordered events, persists the full answer', async () => {
      const s = await account('conv-stream');
      const t = await createThread(s.auth, { locale: 'hi-IN' });
      const before = stub.requests.length;
      const res = await send(s.auth, t.id, 'Kal ka plan banao **please**').expect(202);
      expect(res.body.user_message).toMatchObject({ role: 'user', status: 'completed', seq: 1 });
      expect(res.body.assistant_message).toMatchObject({
        role: 'assistant',
        status: 'accepted',
        seq: 2,
      });
      expect(res.body.conversation.title).toBe('Kal ka plan banao please');
      const s1 = await stream(s.auth, res.body.stream_path as string);
      expect(eventTypes(s1)[0]).toBe('accepted');
      expect(eventTypes(s1).slice(-2)).toEqual(['usage', 'complete']);
      expect(s1.events.map((e) => e.seq)).toEqual(s1.events.map((_, i) => i + 1));
      const m = await message(s.auth, t.id, res.body.assistant_message.id as string);
      expect(m).toMatchObject({ status: 'completed', is_mock: false, route_tier: 'BALANCED' });
      expect(m.content).toBe(streamedText(s1));
      expect(m.content).toContain('in hi-IN');

      // What reached the AI service: contract-valid, signed, pseudonymous, this thread only.
      const sentToAi = stub.requests[before]!;
      expect(stub.signed[before]).toBe(true);
      expect(sentToAi.task_kind).toBe('CHAT');
      expect(sentToAi.user_ref).not.toContain(s.userId);
      expect(JSON.stringify(sentToAi)).not.toContain(s.userId);
      expect(JSON.stringify(sentToAi)).not.toContain('@example.test');
      expect(sentToAi.messages.map((x) => x.role)).toEqual(['user']);
      expect(sentToAi.locale).toBe('hi-IN');
      expect(sentToAi.messages.every((x) => x.role !== 'system')).toBe(true);

      // Usage metadata recorded (no content), ledger updated.
      const inv = await owner.aiInvocation.findFirstOrThrow({
        where: { messageId: res.body.assistant_message.id as string },
      });
      expect(inv).toMatchObject({ status: 'completed', isMock: false, costMicroUsd: 1000n });
      expect(inv.servedModel).toBe('test-creator/balanced');
      expect(await owner.usageLedgerEntry.count({ where: { userId: s.userId } })).toBe(1);
    });

    it('resumes with Last-Event-ID without duplicates; a mid-stream disconnect loses nothing', async () => {
      const s = await account('conv-resume');
      const t = await createThread(s.auth);
      const res = await send(s.auth, t.id, 'tell me [[stub:slow]]').expect(202);
      const path = res.body.stream_path as string;
      const first = await stream(s.auth, path, { stopAfter: 4 });
      const lastSeq = first.events.at(-1)!.seq as number;
      const rest = await stream(s.auth, path, { lastEventId: lastSeq });
      expect(rest.events[0]!.seq).toBe(lastSeq + 1);
      const all = [...first.events, ...rest.events];
      expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
      const m = await message(s.auth, t.id, res.body.assistant_message.id as string);
      expect(streamedText({ events: all, heartbeats: 0 })).toBe(m.content);
      // ?after= works like Last-Event-ID; a finished stream replays from the database.
      const replay = await stream(s.auth, `${path}?after=${lastSeq}`);
      expect(replay.events.map((e) => e.seq)).toEqual(rest.events.map((e) => e.seq));
    });

    it('sends heartbeats while waiting', async () => {
      const s = await account('conv-heartbeat');
      const t = await createThread(s.auth);
      const res = await send(s.auth, t.id, 'slow one [[stub:slow]] [[stub:hang]]').expect(202);
      const result = await Promise.race([
        stream(s.auth, res.body.stream_path as string),
        new Promise<null>((r) => setTimeout(() => r(null), 9_000)),
      ]);
      // The 5 s generation timeout ends it; heartbeats arrived meanwhile.
      expect(result).not.toBeNull();
      expect(result!.heartbeats).toBeGreaterThanOrEqual(1);
      expect(result!.events.at(-1)).toMatchObject({
        type: 'error',
        status: 'incomplete',
        code: 'GENERATION_TIMEOUT',
        retryable: true,
      });
    }, 15_000);

    it('is idempotent: a retried send returns the same messages and calls the AI once', async () => {
      const s = await account('conv-idem');
      const t = await createThread(s.auth);
      const key = randomUUID();
      const before = stub.requests.length;
      const a = await send(s.auth, t.id, 'same', key).expect(202);
      await stream(s.auth, a.body.stream_path as string);
      const b = await send(s.auth, t.id, 'same', key).expect(202);
      expect(b.body.user_message.id).toBe(a.body.user_message.id);
      expect(b.body.assistant_message.id).toBe(a.body.assistant_message.id);
      expect(stub.requests.length - before).toBe(1);
      const conflict = await send(s.auth, t.id, 'different', key).expect(409);
      expect(conflict.body.error.code).toBe('CONFLICT');
      const msgs = await h
        .http()
        .get(`/v1/conversations/${t.id}/messages`)
        .set('authorization', s.auth);
      expect(msgs.body.items).toHaveLength(2);
    });

    it('validates input: Idempotency-Key, empty and oversized messages', async () => {
      const s = await account('conv-validate');
      const t = await createThread(s.auth);
      await h
        .http()
        .post(`/v1/conversations/${t.id}/messages`)
        .set('authorization', s.auth)
        .send({ content: 'no key' })
        .expect(400);
      await send(s.auth, t.id, '   ').expect(400);
      await send(s.auth, t.id, 'x'.repeat(8_001)).expect(400);
      await h
        .http()
        .post(`/v1/conversations/${t.id}/messages`)
        .set('authorization', s.auth)
        .set('idempotency-key', randomUUID())
        .send({ content: 'hi', role: 'assistant' })
        .expect(400);
      await h.http().get('/v1/conversations/not-a-uuid').set('authorization', s.auth).expect(400);
    });

    it('allows one generation per conversation at a time', async () => {
      const s = await account('conv-one-active');
      const t = await createThread(s.auth);
      const first = await send(s.auth, t.id, 'long [[stub:slow]]').expect(202);
      const second = await send(s.auth, t.id, 'too soon').expect(409);
      expect(second.body.error.next_options).toEqual(['CANCEL_GENERATION']);
      await stream(s.auth, first.body.stream_path as string);
      await send(s.auth, t.id, 'now fine').expect(202);
    });

    it('answers exact questions without a model (NO_MODEL) and bills nothing', async () => {
      const s = await account('conv-nomodel');
      const t = await createThread(s.auth);
      const res = await send(s.auth, t.id, 'date [[stub:deterministic]]').expect(202);
      await stream(s.auth, res.body.stream_path as string);
      const m = await message(s.auth, t.id, res.body.assistant_message.id as string);
      expect(m).toMatchObject({ status: 'completed', route_tier: 'NO_MODEL', is_mock: false });
      const inv = await owner.aiInvocation.findFirstOrThrow({
        where: { messageId: res.body.assistant_message.id as string },
      });
      expect(inv.costMicroUsd).toBe(0n);
    });

    it('labels mock answers so they are never presented as live', async () => {
      const s = await account('conv-mock');
      const t = await createThread(s.auth);
      const res = await send(s.auth, t.id, 'hi [[stub:mock]] [[stub:cost=0.05]]').expect(202);
      const sse = await stream(s.auth, res.body.stream_path as string);
      expect(sse.events.at(-1)).toMatchObject({ type: 'complete', is_mock: true });
      const inv = await owner.aiInvocation.findFirstOrThrow({
        where: { messageId: res.body.assistant_message.id as string },
      });
      expect(inv.costMicroUsd).toBe(0n); // mock answers are never billed
    });
  });

  // ── Failure, cancel, recovery ────────────────────────────────────────────────────────

  describe('failures and recovery', () => {
    it('cancel stops a running answer (idempotent) and keeps what was written', async () => {
      const s = await account('conv-cancel');
      const t = await createThread(s.auth);
      const res = await send(s.auth, t.id, 'go [[stub:slow]] [[stub:hang]]').expect(202);
      const mid = res.body.assistant_message.id as string;
      await stream(s.auth, res.body.stream_path as string, { stopAfter: 4 });
      const c1 = await h
        .http()
        .post(`/v1/conversations/${t.id}/messages/${mid}/cancel`)
        .set('authorization', s.auth)
        .expect(200);
      expect(c1.body.status).toBe('canceled');
      expect(c1.body.error.code).toBe('CANCELED');
      const c2 = await h
        .http()
        .post(`/v1/conversations/${t.id}/messages/${mid}/cancel`)
        .set('authorization', s.auth)
        .expect(200);
      expect(c2.body.status).toBe('canceled');
      const sse = await stream(s.auth, res.body.stream_path as string);
      expect(sse.events.at(-1)).toMatchObject({
        type: 'error',
        status: 'canceled',
        code: 'CANCELED',
      });
      expect(streamedText(sse)).toBe(c2.body.content);
      // Cancel of a user message is not a thing.
      await h
        .http()
        .post(`/v1/conversations/${t.id}/messages/${res.body.user_message.id as string}/cancel`)
        .set('authorization', s.auth)
        .expect(404);
    });

    it('an upstream failure after partial output → incomplete; never replayed', async () => {
      const s = await account('conv-partial');
      const t = await createThread(s.auth);
      const before = stub.requests.length;
      const res = await send(s.auth, t.id, 'x [[stub:fail_after=3]]').expect(202);
      const sse = await stream(s.auth, res.body.stream_path as string);
      expect(sse.events.at(-1)).toMatchObject({
        type: 'error',
        status: 'incomplete',
        retryable: true,
      });
      const m = await message(s.auth, t.id, res.body.assistant_message.id as string);
      expect(m.status).toBe('incomplete');
      expect(m.content).toBe(streamedText(sse));
      expect((m.content as string).length).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 300));
      expect(stub.requests.length - before).toBe(1);
    });

    it('a dropped stream (no terminal event) → incomplete GENERATION_INTERRUPTED', async () => {
      const s = await account('conv-drop');
      const t = await createThread(s.auth);
      const res = await send(s.auth, t.id, 'x [[stub:drop]]').expect(202);
      const sse = await stream(s.auth, res.body.stream_path as string);
      expect(sse.events.at(-1)).toMatchObject({
        type: 'error',
        status: 'incomplete',
        code: 'GENERATION_INTERRUPTED',
      });
    });

    it.each([
      ['BUDGET_EXCEEDED', 'SERVICE_LIMIT_REACHED', false],
      ['GATEWAY_RATE_LIMITED', 'AI_BUSY', true],
      ['TIER_DISABLED', 'AI_UNAVAILABLE', false],
      ['FALLBACK_EXHAUSTED', 'AI_UNAVAILABLE', false],
    ])(
      'refusal %s before output → failed %s (safe message only)',
      async (aiCode, code, retryable) => {
        const s = await account(`conv-refuse-${aiCode.toLowerCase()}`);
        const t = await createThread(s.auth);
        const res = await send(s.auth, t.id, `x [[stub:fail=${aiCode}]]`).expect(202);
        const sse = await stream(s.auth, res.body.stream_path as string);
        expect(sse.events.at(-1)).toMatchObject({
          type: 'error',
          status: 'failed',
          code,
          retryable,
        });
        expect(JSON.stringify(sse.events)).not.toContain('stub refusal');
        const m = await message(s.auth, t.id, res.body.assistant_message.id as string);
        expect(m).toMatchObject({ status: 'failed', content: '' });
      },
    );

    it('the AI service being unreachable fails the answer, not the request', async () => {
      const dead = await startApp({
        AI_SERVICE_URL: 'http://127.0.0.1:9',
        CHAT_MAINTENANCE_INTERVAL_SECONDS: '0',
      });
      const d = harness(() => dead);
      try {
        const s = await d.signIn(await d.activeAccount('conv-unreachable'));
        await d
          .http()
          .put('/v1/me/consents/AI_PROCESSING')
          .set('authorization', s.auth)
          .set('if-match', '"0"')
          .send({ decision: 'grant', notice_version: TEST_NOTICE_VERSION, source: 'settings' })
          .expect(200);
        const t = await d
          .http()
          .post('/v1/conversations')
          .set('authorization', s.auth)
          .send({})
          .expect(201);
        const sent = await d
          .http()
          .post(`/v1/conversations/${t.body.id as string}/messages`)
          .set('authorization', s.auth)
          .set('idempotency-key', randomUUID())
          .send({ content: 'hello' })
          .expect(202);
        const mid = sent.body.assistant_message.id as string;
        let m: Record<string, unknown> = {};
        for (let i = 0; i < 100 && m.status !== 'failed'; i++) {
          await new Promise((r) => setTimeout(r, 100));
          m = (
            await d
              .http()
              .get(`/v1/conversations/${t.body.id as string}/messages/${mid}`)
              .set('authorization', s.auth)
          ).body as Record<string, unknown>;
        }
        expect(m.status).toBe('failed');
        expect((m.error as { code: string }).code).toBe('AI_UNAVAILABLE');
        expect((m.error as { retryable: boolean }).retryable).toBe(true);
      } finally {
        await dead.close();
      }
    });

    it('the reaper closes a generation whose runner died; readers see the end', async () => {
      const s = await account('conv-reaper');
      const t = await createThread(s.auth);
      // Simulate a crashed runner: an accepted assistant message whose lease already expired.
      const user = await owner.conversationMessage.create({
        data: {
          userId: s.userId,
          threadId: t.id,
          seq: 1,
          role: 'user',
          status: 'completed',
          content: 'q',
        },
      });
      const orphan = await owner.conversationMessage.create({
        data: {
          userId: s.userId,
          threadId: t.id,
          seq: 2,
          role: 'assistant',
          status: 'streaming',
          content: 'partial',
          replyToMessageId: user.id,
          lastEventSeq: 0,
          leaseExpiresAt: new Date(Date.now() - 1_000),
        },
      });
      await owner.conversationThread.update({ where: { id: t.id }, data: { nextSeq: 3 } });
      const sse = await stream(s.auth, `/v1/conversations/${t.id}/messages/${orphan.id}/stream`);
      expect(sse.events.at(-1)).toMatchObject({
        type: 'error',
        status: 'incomplete',
        code: 'GENERATION_INTERRUPTED',
      });
      const m = await message(s.auth, t.id, orphan.id);
      expect(m.status).toBe('incomplete');
      // Idempotent: nothing left to reap.
      expect(await app.get(MaintenanceService).reapStale()).toBe(0);
      // And the conversation is usable again.
      await send(s.auth, t.id, 'next').expect(202);
    });

    it('deleting a conversation stops its running answer', async () => {
      const s = await account('conv-delete-running');
      const t = await createThread(s.auth);
      const res = await send(s.auth, t.id, 'go [[stub:slow]] [[stub:hang]]').expect(202);
      await stream(s.auth, res.body.stream_path as string, { stopAfter: 3 });
      await h.http().delete(`/v1/conversations/${t.id}`).set('authorization', s.auth).expect(204);
      await new Promise((r) => setTimeout(r, 500));
      expect(await owner.conversationMessage.count({ where: { threadId: t.id } })).toBe(0);
    });
  });

  // ── Regenerate, fork, feedback ───────────────────────────────────────────────────────

  describe('regenerate, edit (fork) and feedback', () => {
    it('regenerates only the latest finished answer; the old one is superseded', async () => {
      const s = await account('conv-regen');
      const t = await createThread(s.auth);
      const r1 = await send(s.auth, t.id, 'first').expect(202);
      await stream(s.auth, r1.body.stream_path as string);
      const r2 = await send(s.auth, t.id, 'second').expect(202);
      await stream(s.auth, r2.body.stream_path as string);
      const old1 = r1.body.assistant_message.id as string;
      const old2 = r2.body.assistant_message.id as string;
      const regen = (mid: string, key = randomUUID()) =>
        h
          .http()
          .post(`/v1/conversations/${t.id}/messages/${mid}/regenerate`)
          .set('authorization', s.auth)
          .set('idempotency-key', key);
      await regen(old1).expect(409);
      await regen(r2.body.user_message.id as string).expect(404);
      const key = randomUUID();
      const before = stub.requests.length;
      const g = await regen(old2, key).expect(202);
      expect(g.body.assistant_message).toMatchObject({
        regenerated_from_message_id: old2,
        reply_to_message_id: r2.body.user_message.id,
        seq: 5,
      });
      const again = await regen(old2, key).expect(202);
      expect(again.body.assistant_message.id).toBe(g.body.assistant_message.id);
      await stream(s.auth, g.body.stream_path as string);
      expect(stub.requests.length - before).toBe(1);
      // The context sent for the regeneration excludes the superseded answer.
      expect(stub.requests.at(-1)!.messages.map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
      ]);
      expect((await message(s.auth, t.id, old2)).superseded).toBe(true);
    });

    it('edit-and-resend forks a new conversation from that point', async () => {
      const s = await account('conv-fork');
      const t = await createThread(s.auth, { title: 'Budget' });
      const r1 = await send(s.auth, t.id, 'one').expect(202);
      await stream(s.auth, r1.body.stream_path as string);
      const r2 = await send(s.auth, t.id, 'two').expect(202);
      await stream(s.auth, r2.body.stream_path as string);
      const key = randomUUID();
      const fork = await h
        .http()
        .post(`/v1/conversations/${t.id}/fork`)
        .set('authorization', s.auth)
        .set('idempotency-key', key)
        .send({ from_message_id: r2.body.user_message.id, content: 'two, edited' })
        .expect(202);
      expect(fork.body.conversation.id).not.toBe(t.id);
      expect(fork.body.conversation.title).toBe('Budget (edited)');
      await stream(s.auth, fork.body.stream_path as string);
      const msgs = await h
        .http()
        .get(`/v1/conversations/${fork.body.conversation.id as string}/messages`)
        .set('authorization', s.auth)
        .expect(200);
      expect(
        (msgs.body as { items: { role: string; content: string }[] }).items.map((m) => [
          m.role,
          m.content.slice(0, 11),
        ]),
      ).toEqual([
        ['user', 'one'],
        ['assistant', expect.any(String)],
        ['user', 'two, edited'],
        ['assistant', expect.any(String)],
      ]);
      // The original is untouched.
      const orig = await h
        .http()
        .get(`/v1/conversations/${t.id}/messages`)
        .set('authorization', s.auth);
      expect(orig.body.items).toHaveLength(4);
      // Only user messages can be edited.
      await h
        .http()
        .post(`/v1/conversations/${t.id}/fork`)
        .set('authorization', s.auth)
        .set('idempotency-key', randomUUID())
        .send({ from_message_id: r2.body.assistant_message.id, content: 'x' })
        .expect(404);
    });

    it('records thumbs up/down with a category, updates and clears it', async () => {
      const s = await account('conv-feedback');
      const t = await createThread(s.auth);
      const r = await send(s.auth, t.id, 'hi').expect(202);
      const mid = r.body.assistant_message.id as string;
      await stream(s.auth, r.body.stream_path as string);
      const fb = (body: object) =>
        h
          .http()
          .post(`/v1/conversations/${t.id}/messages/${mid}/feedback`)
          .set('authorization', s.auth)
          .send(body);
      expect((await fb({ rating: 'up' }).expect(200)).body.feedback).toEqual({
        rating: 'up',
        category: null,
      });
      expect(
        (
          await fb({
            rating: 'down',
            category: 'language',
            comment: 'Reply in Hindi please',
          }).expect(200)
        ).body.feedback,
      ).toEqual({ rating: 'down', category: 'language' });
      await fb({ rating: 'meh' }).expect(400);
      await h
        .http()
        .post(`/v1/conversations/${t.id}/messages/${r.body.user_message.id as string}/feedback`)
        .set('authorization', s.auth)
        .send({ rating: 'up' })
        .expect(409);
      const cleared = await h
        .http()
        .delete(`/v1/conversations/${t.id}/messages/${mid}/feedback`)
        .set('authorization', s.auth)
        .expect(200);
      expect(cleared.body.feedback).toBeNull();
    });
  });

  // ── Ephemeral & retention ────────────────────────────────────────────────────────────

  it('ephemeral conversations expire and are purged with their messages', async () => {
    const s = await account('conv-ephemeral');
    const t = await createThread(s.auth, { mode: 'ephemeral' });
    const full = await h.http().get(`/v1/conversations/${t.id}`).set('authorization', s.auth);
    const hours = (Date.parse(full.body.expires_at as string) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    const r = await send(s.auth, t.id, 'temporary').expect(202);
    await stream(s.auth, r.body.stream_path as string);
    await owner.conversationThread.update({
      where: { id: t.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await h.http().get(`/v1/conversations/${t.id}`).set('authorization', s.auth).expect(404);
    const listed = await h.http().get('/v1/conversations').set('authorization', s.auth);
    expect(idsOf(listed.body)).not.toContain(t.id);
    const purged = await app.get(MaintenanceService).purge();
    expect(purged.threads).toBeGreaterThanOrEqual(1);
    expect(await owner.conversationThread.count({ where: { id: t.id } })).toBe(0);
    expect(await owner.conversationMessage.count({ where: { threadId: t.id } })).toBe(0);
  });

  it('stream events of old finished messages are purged; resuming still reports the outcome', async () => {
    const s = await account('conv-retention');
    const t = await createThread(s.auth);
    const r = await send(s.auth, t.id, 'keep me').expect(202);
    const mid = r.body.assistant_message.id as string;
    await stream(s.auth, r.body.stream_path as string);
    await owner.conversationMessage.update({
      where: { id: mid },
      data: { completedAt: new Date(Date.now() - 400 * 3_600_000) },
    });
    await app.get(MaintenanceService).purge();
    expect(await owner.messageEvent.count({ where: { messageId: mid } })).toBe(0);
    const m = await message(s.auth, t.id, mid);
    expect(m.content).not.toBe('');
    const sse = await stream(s.auth, r.body.stream_path as string, { lastEventId: 1 });
    expect(sse.events).toHaveLength(1);
    expect(sse.events[0]).toMatchObject({ type: 'complete', status: 'completed' });
  });

  // ── Row-level security (runtime role) ────────────────────────────────────────────────

  describe('row-level security (runtime role)', () => {
    it('unscoped and other-user scopes see nothing; forged ownership is rejected', async () => {
      const a = await account('conv-rls-a');
      const b = await account('conv-rls-b');
      const t = await createThread(a.auth);
      const r = await send(a.auth, t.id, 'secret').expect(202);
      const mid = r.body.assistant_message.id as string;
      await stream(a.auth, r.body.stream_path as string);
      await h
        .http()
        .post(`/v1/conversations/${t.id}/messages/${mid}/feedback`)
        .set('authorization', a.auth)
        .send({ rating: 'up' })
        .expect(200);

      // Unscoped: deny by default.
      expect(await runtime.conversationThread.count({ where: { id: t.id } })).toBe(0);
      expect(await runtime.conversationMessage.count({ where: { threadId: t.id } })).toBe(0);
      expect(await runtime.messageEvent.count({ where: { messageId: mid } })).toBe(0);
      expect(await runtime.messageFeedback.count({ where: { messageId: mid } })).toBe(0);
      expect(await runtime.aiInvocation.count({ where: { userId: a.userId } })).toBe(0);
      expect(await runtime.usageLedgerEntry.count({ where: { userId: a.userId } })).toBe(0);

      // Another user's scope: still nothing, and writes as A are refused.
      await runtime.withUserScope(b.userId, async (tx) => {
        expect(await tx.conversationThread.count({ where: { id: t.id } })).toBe(0);
        expect(await tx.conversationMessage.count({ where: { threadId: t.id } })).toBe(0);
        expect(await tx.messageEvent.count({ where: { messageId: mid } })).toBe(0);
        expect(await tx.aiInvocation.count({ where: { userId: a.userId } })).toBe(0);
        expect(await tx.usageLedgerEntry.count({ where: { userId: a.userId } })).toBe(0);
      });
      await expect(
        runtime.withUserScope(b.userId, (tx) =>
          tx.conversationThread.create({ data: { userId: a.userId, title: 'x', locale: 'en-IN' } }),
        ),
      ).rejects.toThrow();
      // B cannot attach a message to A's thread even with B's own user_id.
      await expect(
        runtime.withUserScope(b.userId, (tx) =>
          tx.conversationMessage.create({
            data: {
              userId: b.userId,
              threadId: t.id,
              seq: 99,
              role: 'user',
              status: 'completed',
              content: 'x',
            },
          }),
        ),
      ).rejects.toThrow();
      // The runtime role cannot delete individual messages or events, or touch staff data.
      await expect(
        runtime.withUserScope(a.userId, (tx) =>
          tx.conversationMessage.deleteMany({ where: { threadId: t.id } }),
        ),
      ).rejects.toThrow();
      await expect(
        runtime.withUserScope(a.userId, (tx) =>
          tx.messageEvent.deleteMany({ where: { messageId: mid } }),
        ),
      ).rejects.toThrow();
      await expect(
        runtime.withUserScope(a.userId, (tx) =>
          tx.aiInvocation.deleteMany({ where: { userId: a.userId } }),
        ),
      ).rejects.toThrow();
    });
  });

  // ── Data rights cover conversations ─────────────────────────────────────────────────

  it('a data export includes conversations, messages and feedback', async () => {
    const s = await account('conv-export');
    const t = await createThread(s.auth, { title: 'Export me' });
    const r = await send(s.auth, t.id, 'what I said').expect(202);
    await stream(s.auth, r.body.stream_path as string);
    const req = await h
      .http()
      .post('/v1/me/data-rights/export')
      .set('authorization', s.auth)
      .expect(202);
    const { DataRightsService } = await import('../src/data-rights/data-rights.service.js');
    await app.get(DataRightsService).buildExport(req.body.id as string);
    const dl = await h
      .http()
      .get(`/v1/me/data-rights/${req.body.id as string}/download`)
      .set('authorization', s.auth)
      .expect(200);
    const payload = JSON.parse(dl.text) as {
      conversations: { title: string; messages: { role: string; content: string }[] }[];
      ai_usage_by_day: unknown[];
    };
    const conv = payload.conversations.find((c) => c.title === 'Export me');
    expect(conv?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(conv?.messages[0]?.content).toBe('what I said');
    expect(payload.ai_usage_by_day.length).toBe(1);
  });

  it('account erasure removes conversations, AI usage and invocation metadata', async () => {
    const s = await account('conv-erase');
    const t = await createThread(s.auth);
    const r = await send(s.auth, t.id, 'erase me').expect(202);
    await stream(s.auth, r.body.stream_path as string);
    const del = await h
      .http()
      .post('/v1/me/data-rights/deletion')
      .set('authorization', s.auth)
      .send({ current_password: 'mango monsoon bicycle lantern', confirm: true })
      .expect(202);
    await owner.dataRightsRequest.update({
      where: { id: del.body.id as string },
      data: { scheduledFor: new Date(Date.now() - 1_000) },
    });
    const { DataRightsService } = await import('../src/data-rights/data-rights.service.js');
    expect(await app.get(DataRightsService).executeErasure(del.body.id as string)).toBe(
      'completed',
    );
    expect(await owner.conversationThread.count({ where: { userId: s.userId } })).toBe(0);
    expect(await owner.conversationMessage.count({ where: { userId: s.userId } })).toBe(0);
    expect(await owner.messageEvent.count({ where: { userId: s.userId } })).toBe(0);
    expect(await owner.aiInvocation.count({ where: { userId: s.userId } })).toBe(0);
    expect(await owner.usageLedgerEntry.count({ where: { userId: s.userId } })).toBe(0);
  });
});
