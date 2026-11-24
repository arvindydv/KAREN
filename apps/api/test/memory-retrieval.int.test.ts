import { createHash, randomUUID } from 'node:crypto';
import { memoryValueKeyMaterial, tokenizeForSearch } from '@karen/domain/memory';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { MemoryTurnService } from '../src/memory/memory-turn.service.js';
import { startAiStub, type AiStub } from './ai-stub.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/**
 * Phase 03 / M4b — retrieval in chat turns (arch §6, §9; test strategy T-TXN-01, T-RET-01…08,
 * T-RACE-11/12). The AI stub records every request, so what reached the model is asserted
 * exactly (memory_status / memory_context), together with memory.access_events.
 */
describe('memory retrieval in chat (M4b, integration)', () => {
  let app: NestFastifyApplication;
  let offApp: NestFastifyApplication;
  let stub: AiStub;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const runtime = new PrismaService(testEnv({ DATABASE_POOL_MAX: '2' }));
  const h = harness(() => app);
  const off = harness(() => offApp);
  const chatEnv = (s: AiStub) => ({
    AI_SERVICE_URL: s.url,
    CHAT_MAINTENANCE_INTERVAL_SECONDS: '0',
    CHAT_GENERATION_TIMEOUT_SECONDS: '30',
    CHAT_MESSAGES_PER_MINUTE: '600',
    CHAT_DAILY_LIMIT_USD: '100',
    CHAT_MONTHLY_LIMIT_USD: '1000',
  });

  beforeAll(async () => {
    await ensureDraftNotices(owner);
    stub = await startAiStub();
    app = await startApp({
      ...chatEnv(stub),
      MEMORY_FEATURE_ENABLED: 'true',
      MEMORY_CONSENT_ELIGIBLE_POLICY_VERSIONS: TEST_NOTICE_VERSION,
    });
    offApp = await startApp({ ...chatEnv(stub), MEMORY_FEATURE_ENABLED: 'false' });
    await runtime.$connect();
  });
  afterAll(async () => {
    await Promise.all([app.close(), offApp.close()]);
    await stub.close();
    await Promise.all([owner.$disconnect(), runtime.$disconnect()]);
  });

  type S = Awaited<ReturnType<typeof h.signIn>>;
  const consent = async (hh: typeof h, s: S, purpose: string, decision: 'grant' | 'revoke') => {
    const g = await owner.consentGrant.findFirst({
      where: { userId: s.userId, purpose: purpose as never },
    });
    await hh
      .http()
      .put(`/v1/me/consents/${purpose}`)
      .set('authorization', s.auth)
      .set('if-match', `"${g?.version ?? 0}"`)
      .send({ decision, notice_version: TEST_NOTICE_VERSION, source: 'settings' })
      .expect(200);
  };
  const account = async (tag: string, hh = h, memory = true) => {
    const s = await hh.signIn(await hh.activeAccount(tag));
    await consent(hh, s, 'AI_PROCESSING', 'grant');
    if (memory) await consent(hh, s, 'MEMORY_STORAGE', 'grant');
    return s;
  };
  const conversation = async (s: S, body: object = {}, hh = h) =>
    (await hh.http().post('/v1/conversations').set('authorization', s.auth).send(body).expect(201))
      .body.id as string;
  /** Sends a message, waits for the terminal state, returns the AI request the stub saw. */
  const ask = async (s: S, threadId: string, content: string, hh = h) => {
    const marker = `q-${randomUUID().slice(0, 8)}`;
    const sent = await hh
      .http()
      .post(`/v1/conversations/${threadId}/messages`)
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ content: `${content} ${marker}` })
      .expect(202);
    const aid = sent.body.assistant_message.id as string;
    for (let i = 0; i < 200; i += 1) {
      const m = await hh
        .http()
        .get(`/v1/conversations/${threadId}/messages/${aid}`)
        .set('authorization', s.auth)
        .expect(200);
      if (['completed', 'incomplete', 'failed', 'canceled'].includes(m.body.status as string)) {
        const req = stub.requests.find((r) =>
          r.messages.some((x) => x.role === 'user' && x.content.includes(marker)),
        );
        return { reply: m.body as { id: string; status: string }, req };
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('reply did not finish');
  };
  const vk = (kind: string, slot: string, text: string) =>
    createHash('sha256')
      .update(memoryValueKeyMaterial({ kind, slot, subject: 'self', text }))
      .digest('hex');
  const remember = async (
    userId: string,
    text: string,
    o: Partial<{ kind: string; slot: string; pinned: boolean; updatedAgo: string }> = {},
  ) => {
    const kind = o.kind ?? 'preference';
    const slot = o.slot ?? 'other';
    const rows = await owner.$queryRaw<{ id: string }[]>`
      INSERT INTO memory.items (user_id, kind, slot, single_valued, subject, value_text, value_key,
        search_lexemes, origin, pinned, source_recorded_at, confirmed_at, expires_at,
        created_at, updated_at)
      VALUES (${userId}::uuid, ${kind}, ${slot}, false, 'self', ${text}, ${vk(kind, slot, text)},
        array_to_tsvector(${tokenizeForSearch(text)}::text[]), 'user_created', ${o.pinned ?? false},
        now(), now(), CASE WHEN ${kind} = 'context' THEN now() + interval '10 days' END,
        now() - ${o.updatedAgo ?? '30 days'}::interval, now() - ${o.updatedAgo ?? '30 days'}::interval)
      RETURNING id`;
    return rows[0]!.id;
  };
  const texts = (req: { memory_context?: { text: string }[] } | undefined) =>
    (req?.memory_context ?? []).map((m) => m.text);

  // ── T-TXN-01 savepoint inside a Prisma interactive transaction (03C-01) ─────────────────
  describe('T-TXN-01 savepoint proof', () => {
    it('ROLLBACK TO SAVEPOINT after a failed statement keeps the outer transaction usable', async () => {
      const s = await account('m4b-txn');
      const a = `txn-a-${randomUUID().slice(0, 6)}`;
      const b = `txn-b-${randomUUID().slice(0, 6)}`;
      await runtime.withUserScope(s.userId, async (tx) => {
        await tx.$executeRaw`UPDATE identity.users SET display_name = ${a} WHERE id = ${s.userId}::uuid`;
        await tx.$executeRawUnsafe('SAVEPOINT proof');
        await expect(
          tx.$executeRaw`INSERT INTO memory.user_settings (user_id) VALUES (${randomUUID()}::uuid)`,
        ).rejects.toThrow();
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT proof');
        await tx.$executeRaw`INSERT INTO memory.user_settings (user_id, ask_before_saving) VALUES (${s.userId}::uuid, true)`;
        void b;
      });
      const u = await owner.user.findUniqueOrThrow({ where: { id: s.userId } });
      expect(u.displayName).toBe(a);
      expect(
        (await owner.memoryUserSettings.findUniqueOrThrow({ where: { userId: s.userId } }))
          .askBeforeSaving,
      ).toBe(true);
    });

    it('MemoryTurnService.writeInTx rolls back only the memory section on failure', async () => {
      const s = await account('m4b-txn2');
      const item = await remember(s.userId, 'I like plain dosa');
      const turn = app.get(MemoryTurnService, { strict: false });
      const marker = `kept-${randomUUID().slice(0, 6)}`;
      const ok = await runtime.withUserScope(s.userId, async (tx) => {
        await tx.$executeRaw`UPDATE identity.users SET display_name = ${marker} WHERE id = ${s.userId}::uuid`;
        // A reply id that is not an assistant message of this user → the owner trigger raises.
        return turn.writeInTx(tx, {
          userId: s.userId,
          replyMessageId: randomUUID(),
          sent: [{ itemId: item, ref: 'm1', rank: 1, reason: 'lexical' }],
        });
      });
      expect(ok).toBe(false);
      expect((await owner.user.findUniqueOrThrow({ where: { id: s.userId } })).displayName).toBe(
        marker,
      );
      expect(await owner.memoryAccessEvent.count({ where: { userId: s.userId } })).toBe(0);
    });
  });

  // ── §9.2 behaviour matrix ───────────────────────────────────────────────────────────────
  describe('T-RET-01 behaviour matrix (§9.2)', () => {
    it('on: relevant memory sent with an opaque ref; access event + last_used_at recorded', async () => {
      const s = await account('m4b-on');
      const id = await remember(s.userId, 'I prefer window seats on flights');
      const t = await conversation(s);
      const { reply, req } = await ask(s, t, 'book me flight seats please');
      expect(reply.status).toBe('completed');
      expect(req?.memory_status).toBe('on');
      expect(texts(req)).toContain('I prefer window seats on flights');
      expect(JSON.stringify(req?.memory_context)).not.toContain(id); // refs, never DB ids
      expect(req?.memory_context?.[0]?.ref).toMatch(/^m\d+$/);
      const ev = await owner.memoryAccessEvent.findMany({ where: { userId: s.userId } });
      expect(ev).toEqual([
        expect.objectContaining({ itemId: id, replyMessageId: reply.id, reason: 'lexical' }),
      ]);
      const row = await owner.memoryItem.findUniqueOrThrow({ where: { id } });
      expect(row.lastUsedAt).not.toBeNull();
      expect(row.version).toBe(0); // not a content change (§9.4)
    });

    it('off_thread / off_ephemeral / off_consent send a status and no context; flag off omits both', async () => {
      const s = await account('m4b-matrix');
      await remember(s.userId, 'I prefer aisle seats');
      const offThread = await conversation(s, { memory_enabled: false });
      expect((await ask(s, offThread, 'seats?')).req).toMatchObject({
        memory_status: 'off_thread',
      });
      const eph = await conversation(s, { mode: 'ephemeral' });
      const e = (await ask(s, eph, 'seats?')).req;
      expect(e?.memory_status).toBe('off_ephemeral');
      expect(e?.memory_context).toBeUndefined();
      const onThread = await conversation(s);
      await consent(h, s, 'MEMORY_STORAGE', 'revoke');
      const c = (await ask(s, onThread, 'seats?')).req;
      expect(c?.memory_status).toBe('off_consent');
      expect(c?.memory_context).toBeUndefined();

      const f = await account('m4b-flag-off', off);
      const ft = await conversation(f, {}, off);
      const fr = (await ask(f, ft, 'seats?', off)).req;
      expect(fr).toBeDefined();
      expect(fr).not.toHaveProperty('memory_status');
      expect(fr).not.toHaveProperty('memory_context');
    });

    it('retrieval timeout/failure → unavailable; the reply still completes', async () => {
      const s = await account('m4b-unavailable');
      await remember(s.userId, 'I like masala chai');
      const t = await conversation(s);
      // Hold an exclusive lock on memory.items: the retrieval statement hits its 250 ms timeout.
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holder = owner.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('LOCK TABLE memory.items IN ACCESS EXCLUSIVE MODE');
          locked();
          await held;
        },
        { timeout: 20_000 },
      );
      await isLocked;
      try {
        const { reply, req } = await ask(s, t, 'chai?');
        expect(req?.memory_status).toBe('unavailable');
        expect(req?.memory_context).toBeUndefined();
        expect(reply.status).toBe('completed');
      } finally {
        release();
        await holder;
      }
    });
  });

  // ── isolation, lifecycle, deletion reflection ───────────────────────────────────────────
  it('T-RET-02 wrong-user recall is 0 with near-identical memories', async () => {
    const a = await account('m4b-iso-a');
    const b = await account('m4b-iso-b');
    await remember(a.userId, 'my city is Pune');
    await remember(b.userId, 'my city is Pun3');
    const t = await conversation(a);
    const { req } = await ask(a, t, 'which city is mine');
    expect(texts(req)).toContain('my city is Pune');
    expect(texts(req)).not.toContain('my city is Pun3');
  });

  it('T-RET-03 suspended and expired memories are never sent', async () => {
    const s = await account('m4b-lifecycle');
    const sus = await remember(s.userId, 'I like jaggery sweets');
    const exp = await remember(s.userId, 'I am in Goa for jaggery shopping', { kind: 'context' });
    await owner.memoryItem.update({
      where: { id: exp },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await owner.$executeRaw`UPDATE memory.items SET status = 'suspended', suspended_at = now() WHERE id = ${sus}::uuid`;
    const t = await conversation(s);
    const { req } = await ask(s, t, 'jaggery ideas');
    expect(texts(req)).toEqual([]);
  });

  it('T-RET-04 deletion and edit are reflected in the next response (different thread, OD-04)', async () => {
    const s = await account('m4b-reflect');
    const id = await remember(s.userId, 'I love hiking in the Western Ghats');
    const threadB = await conversation(s);
    expect(texts((await ask(s, threadB, 'weekend hiking plan')).req)).toContain(
      'I love hiking in the Western Ghats',
    );
    // Edit through the public API → the next turn carries only the new text.
    const v = (await owner.memoryItem.findUniqueOrThrow({ where: { id } })).version;
    await h
      .http()
      .patch(`/v1/memory/${id}`)
      .set('authorization', s.auth)
      .set('if-match', `"${v}"`)
      .send({ text: 'I love hiking in the Himalayas' })
      .expect(200);
    const edited = texts((await ask(s, threadB, 'weekend hiking plan')).req);
    expect(edited).toContain('I love hiking in the Himalayas');
    expect(edited).not.toContain('I love hiking in the Western Ghats');
    // Delete → absent from the next turn (thread B and a new thread C) and from access events.
    await h.http().delete(`/v1/memory/${id}`).set('authorization', s.auth).expect(204);
    const afterB = await ask(s, threadB, 'weekend hiking plan');
    const threadC = await conversation(s);
    const afterC = await ask(s, threadC, 'hiking?');
    for (const r of [afterB, afterC]) {
      expect(texts(r.req).some((x) => x.includes('hiking'))).toBe(false);
      expect(await owner.memoryAccessEvent.count({ where: { replyMessageId: r.reply.id } })).toBe(
        0,
      );
    }
  });

  it('T-RET-05 an old lexical match beats 60 newer non-matching pinned/preference/recent items', async () => {
    const s = await account('m4b-bound');
    const target = await remember(s.userId, 'my passport renewal office is in Thane', {
      kind: 'fact',
      updatedAgo: '400 days',
    });
    for (let i = 0; i < 5; i += 1)
      await remember(s.userId, `pinned note ${i}`, { pinned: true, updatedAgo: '1 day' });
    for (let i = 0; i < 40; i += 1)
      await remember(s.userId, `preference item ${i}`, { updatedAgo: '2 days' });
    for (let i = 0; i < 15; i += 1)
      await remember(s.userId, `recent fact ${i}`, { kind: 'fact', updatedAgo: '1 hour' });
    const t = await conversation(s);
    const { req, reply } = await ask(s, t, 'where is the passport office');
    expect(texts(req)).toContain('my passport renewal office is in Thane');
    expect((req?.memory_context ?? []).length).toBeLessThanOrEqual(12);
    const ev = await owner.memoryAccessEvent.findFirst({
      where: { replyMessageId: reply.id, itemId: target },
    });
    expect(ev?.reason).toBe('lexical');
  });

  // ── races ────────────────────────────────────────────────────────────────────────────────
  it('T-RACE-12 deleting a memory while the answer streams: reply completes, no access event for it', async () => {
    const s = await account('m4b-race12');
    const id = await remember(s.userId, 'I enjoy slow travel');
    const t = await conversation(s);
    const sent = await h
      .http()
      .post(`/v1/conversations/${t}/messages`)
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ content: 'travel ideas [[stub:slow]]' })
      .expect(202);
    const aid = sent.body.assistant_message.id as string;
    for (let i = 0; i < 100; i += 1) {
      const m = await owner.conversationMessage.findUniqueOrThrow({ where: { id: aid } });
      if (m.status === 'streaming') break;
      await new Promise((r) => setTimeout(r, 30));
    }
    await h.http().delete(`/v1/memory/${id}`).set('authorization', s.auth).expect(204);
    for (let i = 0; i < 200; i += 1) {
      const m = await owner.conversationMessage.findUniqueOrThrow({ where: { id: aid } });
      if (m.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect((await owner.conversationMessage.findUniqueOrThrow({ where: { id: aid } })).status).toBe(
      'completed',
    );
    expect(await owner.aiInvocation.count({ where: { messageId: aid } })).toBe(1);
    expect(await owner.memoryAccessEvent.count({ where: { replyMessageId: aid } })).toBe(0);
  });

  it('T-RACE-11 revoke racing finalize: no deadlock; never an access event for a suspended item after the revoke', async () => {
    for (let round = 0; round < 4; round += 1) {
      const s = await account(`m4b-race11-${round}`);
      const id = await remember(s.userId, `I like idli round ${round}`);
      const t = await conversation(s);
      const sent = await h
        .http()
        .post(`/v1/conversations/${t}/messages`)
        .set('authorization', s.auth)
        .set('idempotency-key', `k-${randomUUID()}`)
        .send({ content: `idli ideas ${round}` })
        .expect(202);
      await consent(h, s, 'MEMORY_STORAGE', 'revoke');
      const aid = sent.body.assistant_message.id as string;
      for (let i = 0; i < 200; i += 1) {
        const m = await owner.conversationMessage.findUniqueOrThrow({ where: { id: aid } });
        if (['completed', 'incomplete', 'failed'].includes(m.status)) break;
        await new Promise((r) => setTimeout(r, 30));
      }
      const item = await owner.memoryItem.findUniqueOrThrow({ where: { id } });
      expect(item.status).toBe('suspended');
      const events = await owner.memoryAccessEvent.findMany({ where: { replyMessageId: aid } });
      for (const e of events)
        expect(e.createdAt.getTime()).toBeLessThanOrEqual(item.suspendedAt!.getTime());
    }
  });
});
