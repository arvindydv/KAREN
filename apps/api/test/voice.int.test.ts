import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { startAiStub, type AiStub } from './ai-stub.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/**
 * Voice (ADR-0026): preferences, voice commands (STT) and spoken replies (TTS).
 * Real API + Postgres (RLS) + Redis; the AI service is the contract-validating stub.
 */
describe('voice (integration)', () => {
  let app: NestFastifyApplication;
  let base: string;
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
      // Production default (1 MiB): voice messages need it; the test env otherwise uses 4 KiB.
      API_BODY_LIMIT_BYTES: '1048576',
    });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    await stub.close();
    await owner.$disconnect();
  });

  const grant = (auth: string) =>
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
  const audio = (text: string) => Buffer.from(`MOCK:${text}`).toString('base64');
  const transcribe = (auth: string, body: object) =>
    h.http().post('/v1/voice/transcriptions').set('authorization', auth).send(body);

  /** A finished assistant answer, produced through the normal chat path. */
  const answered = async (auth: string): Promise<{ threadId: string; messageId: string }> => {
    const thread = (
      await h.http().post('/v1/conversations').set('authorization', auth).send({}).expect(201)
    ).body as { id: string };
    const sent = (
      await h
        .http()
        .post(`/v1/conversations/${thread.id}/messages`)
        .set('authorization', auth)
        .set('idempotency-key', randomUUID())
        .send({ content: 'Kal ka plan batao' })
        .expect(202)
    ).body as { assistant_message: { id: string } };
    const messageId = sent.assistant_message.id;
    for (let i = 0; i < 100; i += 1) {
      const msg = await h
        .http()
        .get(`/v1/conversations/${thread.id}/messages/${messageId}`)
        .set('authorization', auth);
      if ((msg.body as { status: string }).status === 'completed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return { threadId: thread.id, messageId };
  };

  describe('preferences', () => {
    it('defaults to an Indian voice and saves accent, gender, speed and autoplay', async () => {
      const s = await account('voice-prefs', false);
      const got = await h.http().get('/v1/me/preferences').set('authorization', s.auth).expect(200);
      expect(got.body).toMatchObject({
        voice_accent: 'indian',
        voice_gender: 'any',
        voice_speed_pct: 100,
        voice_autoplay: false,
      });
      const saved = await h
        .http()
        .patch('/v1/me/preferences')
        .set('authorization', s.auth)
        .set('if-match', got.headers.etag as string)
        .send({
          voice_accent: 'british',
          voice_gender: 'female',
          voice_speed_pct: 110,
          voice_autoplay: true,
        })
        .expect(200);
      expect(saved.body).toMatchObject({ voice_accent: 'british', voice_speed_pct: 110 });
    });

    it('rejects values outside the supported set (contract and DB constraint)', async () => {
      const s = await account('voice-prefs-bad', false);
      const got = await h.http().get('/v1/me/preferences').set('authorization', s.auth);
      for (const bad of [{ voice_accent: 'scottish' }, { voice_speed_pct: 300 }]) {
        await h
          .http()
          .patch('/v1/me/preferences')
          .set('authorization', s.auth)
          .set('if-match', got.headers.etag as string)
          .send(bad)
          .expect(400);
      }
      await expect(
        owner.$executeRawUnsafe(
          `INSERT INTO identity.user_preferences (user_id, voice_accent, updated_at) VALUES ('${s.userId}', 'scottish', now())`,
        ),
      ).rejects.toThrow(/user_preferences_voice/);
    });
  });

  describe('voice commands (speech-to-text)', () => {
    it('needs AI_PROCESSING consent and never reaches the AI without it', async () => {
      const s = await account('voice-no-consent', false);
      const before = stub.transcriptions.length;
      const res = await transcribe(s.auth, { audio_base64: audio('hello'), audio_format: 'webm' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONSENT_REQUIRED');
      expect(stub.transcriptions.length).toBe(before);
    });

    it('returns the transcript; the text is then sent through the normal chat path', async () => {
      const s = await account('voice-stt');
      const spoken = 'Kal subah 7 baje mujhe yaad dila dena';
      const res = await transcribe(s.auth, {
        audio_base64: audio(spoken),
        audio_format: 'webm',
        duration_ms: 2_000,
        language_hint: 'hi-Latn',
      }).expect(200);
      expect(res.body).toEqual({ text: spoken, language: 'en', is_mock: false });
      const sent = stub.transcriptions.at(-1);
      expect(sent?.user_ref).not.toContain(s.userId); // pseudonymous user_ref only
      expect(sent?.max_cost_usd).toBe(0.01);
      expect(stub.signed.at(-1)).toBe(true);
      // Charged to the user's ledger and recorded as an AUDIO invocation (metadata only).
      const invocation = await owner.aiInvocation.findFirst({
        where: { userId: s.userId, routeTier: 'AUDIO' },
        orderBy: { createdAt: 'desc' },
      });
      expect(invocation).toMatchObject({ status: 'completed', costMicroUsd: 4000n, isMock: false });
      expect(
        JSON.stringify(invocation, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
      ).not.toContain('yaad');
    });

    it('rejects oversized or malformed audio before calling the AI', async () => {
      const s = await account('voice-stt-bad');
      const before = stub.transcriptions.length;
      // Just over the voice cap (but under the body limit): contract validation.
      await transcribe(s.auth, { audio_base64: 'A'.repeat(940_000), audio_format: 'webm' }).expect(
        400,
      );
      // Far over: the global body limit refuses it before parsing.
      await transcribe(s.auth, {
        audio_base64: 'A'.repeat(2_000_000),
        audio_format: 'webm',
      }).expect(413);
      await transcribe(s.auth, { audio_base64: audio('x'), audio_format: 'exe' }).expect(400);
      expect(stub.transcriptions.length).toBe(before);
    });

    it('maps AI refusals to safe errors and charges nothing', async () => {
      const s = await account('voice-stt-fail');
      const res = await transcribe(s.auth, {
        audio_base64: audio('[[stub:fail=TIER_DISABLED]]'),
        audio_format: 'webm',
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PROVIDER_CAPABILITY_UNAVAILABLE');
      expect(res.text).not.toContain('stub refusal');
      const ledger = await owner.usageLedgerEntry.findMany({ where: { userId: s.userId } });
      expect(ledger).toEqual([]);
    });
  });

  describe('spoken replies (text-to-speech)', () => {
    it('streams audio for an owned answer in the saved accent', async () => {
      const s = await account('voice-tts');
      const prefs = await h.http().get('/v1/me/preferences').set('authorization', s.auth);
      await h
        .http()
        .patch('/v1/me/preferences')
        .set('authorization', s.auth)
        .set('if-match', prefs.headers.etag as string)
        .send({ voice_accent: 'american', voice_speed_pct: 120 })
        .expect(200);
      const { threadId, messageId } = await answered(s.auth);
      const res = await fetch(`${base}/v1/conversations/${threadId}/messages/${messageId}/speech`, {
        method: 'POST',
        headers: { authorization: s.auth },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('audio/mpeg');
      expect(res.headers.get('x-karen-voice-id')).toBe('stub-american');
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('ID3stub-audio-1stub-audio-2');
      const sent = stub.speeches.at(-1);
      expect(sent?.voice).toEqual({ accent: 'american', gender: 'any', speed: 1.2 });
      expect(sent?.text.length).toBeGreaterThan(0); // the server's own stored answer, not client text
      await expect
        .poll(() =>
          owner.aiInvocation.findFirst({
            where: { userId: s.userId, routeTier: 'AUDIO', messageId },
          }),
        )
        .toMatchObject({ status: 'completed', costMicroUsd: 15000n });
    });

    it('starts speaking while the answer is still being written (ADR-0031)', async () => {
      const s = await account('voice-tts-live');
      const thread = (
        await h.http().post('/v1/conversations').set('authorization', s.auth).send({}).expect(201)
      ).body as { id: string };
      const sent = (
        await h
          .http()
          .post(`/v1/conversations/${thread.id}/messages`)
          .set('authorization', s.auth)
          .set('idempotency-key', randomUUID())
          .send({ content: 'Kal ka plan batao [[stub:slow]]', input_mode: 'voice' })
          .expect(202)
      ).body as { assistant_message: { id: string } };
      const mid = sent.assistant_message.id;
      // Requested right after sending: the server waits for the text, then streams it.
      const res = await fetch(`${base}/v1/conversations/${thread.id}/messages/${mid}/speech`, {
        method: 'POST',
        headers: { authorization: s.auth },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('audio/mpeg');
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
      const spoken = stub.speeches.filter((x) => x.text.startsWith('Answer to'));
      expect(spoken.at(-1)?.text).toMatch(/^Answer to 1 question\(s\)/);
    });

    it('streams the same answer over GET for native players (bearer only)', async () => {
      const s = await account('voice-tts-get');
      const { threadId, messageId } = await answered(s.auth);
      const url = `${base}/v1/conversations/${threadId}/messages/${messageId}/speech`;
      const ok = await fetch(url, { headers: { authorization: s.auth } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toBe('audio/mpeg');
      expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);
      const anonymous = await fetch(url);
      expect(anonymous.status).toBe(401);
    });

    it('serves one segment at a time for mobile and 204 when there are no more', async () => {
      const s = await account('voice-tts-seg');
      const { threadId, messageId } = await answered(s.auth);
      const url = `${base}/v1/conversations/${threadId}/messages/${messageId}/speech`;
      const first = await fetch(`${url}?segment=0`, {
        method: 'POST',
        headers: { authorization: s.auth },
      });
      expect(first.status).toBe(200);
      expect((await first.arrayBuffer()).byteLength).toBeGreaterThan(0);
      const after = await fetch(`${url}?segment=1`, {
        method: 'POST',
        headers: { authorization: s.auth },
      });
      expect(after.status).toBe(204);
      const bad = await fetch(`${url}?segment=-1`, {
        method: 'POST',
        headers: { authorization: s.auth },
      });
      expect(bad.status).toBe(400);
    });

    it('previews a voice with KAREN’s own sample line, never client text', async () => {
      const s = await account('voice-preview');
      const options = await h.http().get('/v1/voice/options').set('authorization', s.auth);
      const voiceId = (options.body as { voices: { voice_id: string }[] }).voices[0]!.voice_id;
      const before = stub.speeches.length;
      const res = await fetch(`${base}/v1/voice/preview`, {
        method: 'POST',
        headers: { authorization: s.auth, 'content-type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId }),
      });
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
      const sent = stub.speeches.slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toMatch(/KAREN|करेन/);
      expect((sent[0]?.voice as { voice_id?: string }).voice_id).toBe(voiceId);
      const unknown = await h
        .http()
        .post('/v1/voice/preview')
        .set('authorization', s.auth)
        .send({ voice_id: 'not-a-real-voice' });
      expect(unknown.status).toBe(404);
      const extra = await h
        .http()
        .post('/v1/voice/preview')
        .set('authorization', s.auth)
        .send({ voice_id: voiceId, text: 'say this' });
      expect(extra.status).toBe(400);
    });

    it('never speaks another user’s message', async () => {
      const alice = await account('voice-tts-alice');
      const bob = await account('voice-tts-bob');
      const { threadId, messageId } = await answered(alice.auth);
      const before = stub.speeches.length;
      const res = await h
        .http()
        .post(`/v1/conversations/${threadId}/messages/${messageId}/speech`)
        .set('authorization', bob.auth);
      expect(res.status).toBe(404);
      expect(stub.speeches.length).toBe(before);
    });
  });
});
