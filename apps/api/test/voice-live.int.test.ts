import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { parseSse, startAiStub, type AiStub } from './ai-stub.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/**
 * Voice settings v2 and live voice conversations (ADR-0027). Real API + Postgres (RLS) + Redis;
 * the AI service is the contract-validating stub (no Deepgram call is ever made).
 */
describe('live voice + voice settings (integration)', () => {
  let app: NestFastifyApplication;
  let stub: AiStub;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const h = harness(() => app);

  beforeAll(async () => {
    await ensureDraftNotices(owner);
    stub = await startAiStub();
    app = await startApp({
      AI_SERVICE_URL: stub.url,
      CHAT_MAINTENANCE_INTERVAL_SECONDS: '0',
      CHAT_MESSAGES_PER_MINUTE: '500',
      CHAT_DAILY_LIMIT_USD: '100',
      CHAT_MONTHLY_LIMIT_USD: '1000',
      VOICE_REQUESTS_PER_MINUTE: '500',
      API_BODY_LIMIT_BYTES: '1048576',
    });
    await app.listen(0, '127.0.0.1');
    void (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await app.close();
    await stub.close();
    await owner.$disconnect();
  });

  const account = async (tag: string, consent = true) => {
    const s = await h.signIn(await h.activeAccount(tag));
    if (consent) {
      await h
        .http()
        .put('/v1/me/consents/AI_PROCESSING')
        .set('authorization', s.auth)
        .set('if-match', '"0"')
        .send({ decision: 'grant', notice_version: TEST_NOTICE_VERSION, source: 'settings' })
        .expect(200);
    }
    return s;
  };
  const chunk = (seq: number, text: string) => ({
    seq,
    audio_base64: Buffer.from(text).toString('base64'),
  });
  const patchPrefs = async (auth: string, body: object, status = 200) => {
    const got = await h.http().get('/v1/me/preferences').set('authorization', auth).expect(200);
    return h
      .http()
      .patch('/v1/me/preferences')
      .set('authorization', auth)
      .set('if-match', got.headers.etag as string)
      .send(body)
      .expect(status);
  };
  const conversation = async (auth: string) =>
    (await h.http().post('/v1/conversations').set('authorization', auth).send({}).expect(201))
      .body as { id: string };

  describe('voice options and settings', () => {
    it('lists the usable voices from the provider catalog', async () => {
      const s = await account('vl-options', false);
      const res = await h.http().get('/v1/voice/options').set('authorization', s.auth).expect(200);
      expect(res.body).toMatchObject({ available: true, live_available: true, is_mock: false });
      expect(res.body.voices).toHaveLength(2);
    });

    it('defaults keep today’s behaviour and new settings persist', async () => {
      const s = await account('vl-prefs', false);
      const got = await h.http().get('/v1/me/preferences').set('authorization', s.auth).expect(200);
      expect(got.body).toMatchObject({
        voice_enabled: true,
        voice_replies: true,
        reply_language: 'auto',
        voice_id: null,
      });
      const saved = await patchPrefs(s.auth, {
        reply_language: 'hi-Latn',
        voice_id: 'stub-en-IN-female',
        voice_speed_pct: 140,
        voice_enabled: false,
      });
      expect(saved.body).toMatchObject({
        reply_language: 'hi-Latn',
        voice_id: 'stub-en-IN-female',
        voice_speed_pct: 140,
        voice_enabled: false,
      });
    });

    it('refuses a voice that is not in the provider catalog and out-of-range values', async () => {
      const s = await account('vl-prefs-bad', false);
      const unknown = await patchPrefs(s.auth, { voice_id: 'aura-made-up-voice' }, 400);
      expect(unknown.body.error.code).toBe('VALIDATION_FAILED');
      await patchPrefs(s.auth, { reply_language: 'fr' }, 400);
      await patchPrefs(s.auth, { voice_speed_pct: 160 }, 400);
      await expect(
        owner.$executeRawUnsafe(
          `INSERT INTO identity.user_preferences (user_id, reply_language, updated_at) VALUES ('${s.userId}', 'fr', now())`,
        ),
      ).rejects.toThrow(/user_preferences_voice_v2/);
    });

    it('sends the saved reply language with every chat request (typed and spoken alike)', async () => {
      const s = await account('vl-reply-lang');
      await patchPrefs(s.auth, { reply_language: 'hi' });
      const thread = await conversation(s.auth);
      await h
        .http()
        .post(`/v1/conversations/${thread.id}/messages`)
        .set('authorization', s.auth)
        .set('idempotency-key', randomUUID())
        .send({ content: 'Explain the architecture' })
        .expect(202);
      for (let i = 0; i < 60 && !stub.requests.some((r) => r.reply_language === 'hi'); i += 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(stub.requests.some((r) => r.reply_language === 'hi')).toBe(true);
    });

    it('answers a spoken turn in spoken style, and only that turn (ADR-0029)', async () => {
      const s = await account('vl-spoken-style');
      const thread = await conversation(s.auth);
      const ask = async (content: string, input_mode?: 'voice' | 'text') =>
        h
          .http()
          .post(`/v1/conversations/${thread.id}/messages`)
          .set('authorization', s.auth)
          .set('idempotency-key', randomUUID())
          .send({ content, ...(input_mode ? { input_mode } : {}) })
          .expect(202);
      const waitFor = async (content: string) => {
        const find = () =>
          stub.requests.find((r) => r.messages.at(-1)?.content === content) ?? null;
        for (let i = 0; i < 100 && !find(); i += 1) await new Promise((r) => setTimeout(r, 50));
        return find();
      };
      const settle = async (mid: string) => {
        for (let i = 0; i < 100; i += 1) {
          const m = await h
            .http()
            .get(`/v1/conversations/${thread.id}/messages/${mid}`)
            .set('authorization', s.auth);
          if (!['queued', 'streaming'].includes(m.body.status as string)) return;
          await new Promise((r) => setTimeout(r, 50));
        }
      };
      const spoken = await ask('Kal ka plan batao', 'voice');
      expect((await waitFor('Kal ka plan batao'))?.reply_style).toBe('spoken');
      await settle(spoken.body.assistant_message.id as string);
      await ask('Now type it out');
      const typed = await waitFor('Now type it out');
      expect(typed).not.toBeNull();
      expect(typed?.reply_style).toBeUndefined();
      await h
        .http()
        .post(`/v1/conversations/${thread.id}/messages`)
        .set('authorization', s.auth)
        .set('idempotency-key', randomUUID())
        .send({ content: 'x', input_mode: 'shout' })
        .expect(400);
    });
  });

  describe('live sessions', () => {
    it('needs AI_PROCESSING consent and never reaches the AI without it', async () => {
      const s = await account('vl-no-consent', false);
      const before = stub.liveStarts.length;
      const res = await h
        .http()
        .post('/v1/voice/sessions')
        .set('authorization', s.auth)
        .send({ audio_format: 'webm' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONSENT_REQUIRED');
      expect(stub.liveStarts.length).toBe(before);
    });

    it('streams a turn, dedupes its message, settles usage once and frees the slot', async () => {
      const s = await account('vl-flow');
      await patchPrefs(s.auth, { reply_language: 'hi' });
      const thread = await conversation(s.auth);
      const started = await h
        .http()
        .post('/v1/voice/sessions')
        .set('authorization', s.auth)
        .send({ conversation_id: thread.id, audio_format: 'webm' })
        .expect(201);
      const sid = started.body.session_id as string;
      expect(stub.liveStarts.at(-1)?.language_hint).toBe('hi');
      // One live session per user.
      const second = await h
        .http()
        .post('/v1/voice/sessions')
        .set('authorization', s.auth)
        .send({ audio_format: 'webm' });
      expect(second.status).toBe(409);

      const text = 'Mujhe authentication system samjhao';
      for (const [seq, payload] of [
        [0, 'opus-header'],
        [1, `MOCK:${text}`],
      ] as const) {
        await h
          .http()
          .post(`/v1/voice/sessions/${sid}/audio`)
          .set('authorization', s.auth)
          .send(chunk(seq, payload))
          .expect(204);
      }
      await h
        .http()
        .post(`/v1/voice/sessions/${sid}/close`)
        .set('authorization', s.auth)
        .expect(202);

      const events = await h
        .http()
        .get(`/v1/voice/sessions/${sid}/events`)
        .set('authorization', s.auth)
        .buffer(true)
        .parse((res, done) => {
          let body = '';
          res.on('data', (c: Buffer) => (body += c.toString()));
          res.on('end', () => done(null, body));
        })
        .expect(200);
      const parsed = parseSse(events.body as string).events;
      const final = parsed.find((e) => e.type === 'end_of_turn');
      expect(final).toMatchObject({ text, turn_index: 0 });
      expect(parsed.at(-1)).toEqual({
        type: 'closed',
        reason: 'client_closed',
        audio_seconds: 0.5,
      });
      expect(JSON.stringify(parsed)).not.toContain('estimated_cost');

      // The client sends the final transcript as a normal message; a retry is deduplicated.
      const send = () =>
        h
          .http()
          .post(`/v1/conversations/${thread.id}/messages`)
          .set('authorization', s.auth)
          .set('idempotency-key', `voice-${sid}-0`)
          .send({ content: text });
      const a = (await send().expect(202)).body as { user_message: { id: string } };
      const b = (await send()).body as { user_message: { id: string } };
      expect(b.user_message.id).toBe(a.user_message.id);

      const rows = await owner.aiInvocation.findMany({
        where: { userId: s.userId, routeTier: 'AUDIO', servedModel: 'stub/live' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.costMicroUsd).toBe(2000n);
      // Slot released after settlement: a new session may start.
      const again = await h
        .http()
        .post('/v1/voice/sessions')
        .set('authorization', s.auth)
        .send({ audio_format: 'webm' })
        .expect(201);
      await h
        .http()
        .post(`/v1/voice/sessions/${again.body.session_id as string}/close`)
        .set('authorization', s.auth)
        .expect(202);
    });

    it('never lets another user stream into, read or close a session', async () => {
      const a = await account('vl-owner');
      const b = await account('vl-intruder');
      const sid = (
        await h
          .http()
          .post('/v1/voice/sessions')
          .set('authorization', a.auth)
          .send({ audio_format: 'webm' })
          .expect(201)
      ).body.session_id as string;
      await h
        .http()
        .post(`/v1/voice/sessions/${sid}/audio`)
        .set('authorization', b.auth)
        .send(chunk(0, 'x'))
        .expect(404);
      await h
        .http()
        .get(`/v1/voice/sessions/${sid}/events`)
        .set('authorization', b.auth)
        .expect(404);
      await h
        .http()
        .post(`/v1/voice/sessions/${sid}/close`)
        .set('authorization', b.auth)
        .expect(404);
      await h
        .http()
        .post(`/v1/voice/sessions/${sid}/close`)
        .set('authorization', a.auth)
        .expect(202);
      // Another user's conversation cannot be attached either.
      const foreign = await conversation(a.auth);
      await h
        .http()
        .post('/v1/voice/sessions')
        .set('authorization', b.auth)
        .send({ conversation_id: foreign.id, audio_format: 'webm' })
        .expect(404);
    });

    it('respects the user turning voice off and validates the session id', async () => {
      const s = await account('vl-off');
      await patchPrefs(s.auth, { voice_enabled: false });
      const res = await h
        .http()
        .post('/v1/voice/sessions')
        .set('authorization', s.auth)
        .send({ audio_format: 'webm' });
      expect(res.status).toBe(409);
      await h
        .http()
        .post('/v1/voice/sessions/not-a-session/close')
        .set('authorization', s.auth)
        .expect(404);
    });

    it('a provider failure ends the session and is recorded as failed', async () => {
      const s = await account('vl-fail');
      const sid = (
        await h
          .http()
          .post('/v1/voice/sessions')
          .set('authorization', s.auth)
          .send({ audio_format: 'webm' })
          .expect(201)
      ).body.session_id as string;
      await h
        .http()
        .post(`/v1/voice/sessions/${sid}/audio`)
        .set('authorization', s.auth)
        .send(chunk(0, '[[stub:fail]]'))
        .expect(204);
      await h
        .http()
        .post(`/v1/voice/sessions/${sid}/close`)
        .set('authorization', s.auth)
        .expect(202);
      const row = await owner.aiInvocation.findFirst({
        where: { userId: s.userId, routeTier: 'AUDIO', servedModel: 'stub/live' },
      });
      expect(row).toMatchObject({ status: 'failed', errorCode: 'PROVIDER_ERROR' });
    });
  });

  describe('spoken replies use the saved voice settings', () => {
    it('passes the preferred voice and refuses when spoken replies are off', async () => {
      const s = await account('vl-tts');
      await patchPrefs(s.auth, { voice_id: 'stub-en-IN-female' });
      const thread = await conversation(s.auth);
      const sent = (
        await h
          .http()
          .post(`/v1/conversations/${thread.id}/messages`)
          .set('authorization', s.auth)
          .set('idempotency-key', randomUUID())
          .send({ content: 'Kal ka plan batao' })
          .expect(202)
      ).body as { assistant_message: { id: string } };
      const mid = sent.assistant_message.id;
      for (let i = 0; i < 100; i += 1) {
        const msg = await h
          .http()
          .get(`/v1/conversations/${thread.id}/messages/${mid}`)
          .set('authorization', s.auth);
        if ((msg.body as { status: string }).status === 'completed') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await h
        .http()
        .post(`/v1/conversations/${thread.id}/messages/${mid}/speech`)
        .set('authorization', s.auth)
        .expect(200);
      expect(stub.speeches.at(-1)?.voice.voice_id).toBe('stub-en-IN-female');
      await patchPrefs(s.auth, { voice_replies: false });
      const off = await h
        .http()
        .post(`/v1/conversations/${thread.id}/messages/${mid}/speech`)
        .set('authorization', s.auth);
      expect(off.status).toBe(409);
    });
  });
});
