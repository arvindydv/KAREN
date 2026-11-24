import { createHash, randomUUID } from 'node:crypto';
import { INTERNAL_SIGNATURE_HEADER } from '@karen/ai-model-contracts';
import { INTERNAL_MEMORY_PATHS, MEMORY_WORKFLOWS, memoryExtractionWorkflowId } from '@karen/domain';
import { memoryValueKeyMaterial, tokenizeForSearch } from '@karen/domain/memory';
import { internalRequestSigningString, signTimestamped } from '@karen/domain/node';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import {
  type ManualWorkflowStarter,
  WORKFLOW_STARTER,
} from '../src/infrastructure/temporal/workflow-starter.js';
import { ApiError } from '../src/common/api-error.js';
import { MemoryMaintenanceService } from '../src/memory/memory-maintenance.service.js';
import { UsageLimitsService } from '../src/usage/usage-limits.service.js';
import { defaultExtract, startAiStub, type AiStub } from './ai-stub.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/**
 * Phase 03 / M5b — extraction job pipeline (arch §8; test strategy T-RACE-01…10/13/14/18,
 * T-WF-04, T-EXT on the mock pipeline). The test plays the Temporal worker by calling the signed
 * internal run/abandon endpoints (workflow orchestration itself is tested in apps/temporal-worker).
 */
const SECRET = testEnv().INTERNAL_SERVICE_HMAC_SECRET as string;

describe('memory extraction pipeline (M5b, integration)', () => {
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
      CHAT_GENERATION_TIMEOUT_SECONDS: '30',
      CHAT_MESSAGES_PER_MINUTE: '600',
      CHAT_DAILY_LIMIT_USD: '100',
      CHAT_MONTHLY_LIMIT_USD: '1000',
      MEMORY_FEATURE_ENABLED: 'true',
      MEMORY_CONSENT_ELIGIBLE_POLICY_VERSIONS: TEST_NOTICE_VERSION,
      MEMORY_MAINTENANCE_INTERVAL_SECONDS: '0',
    });
  });
  afterAll(async () => {
    await app.close();
    await stub.close();
    await owner.$disconnect();
  });
  beforeEach(() => {
    stub.extract = defaultExtract;
  });

  let lastT = Number.POSITIVE_INFINITY;
  const nextT = () => {
    lastT = Math.min(Math.floor(Date.now() / 1000) - 1, lastT - 1);
    return lastT;
  };
  const signed = (path: string, t = nextT()) =>
    h
      .http()
      .post(path)
      .set(
        INTERNAL_SIGNATURE_HEADER,
        signTimestamped(SECRET, internalRequestSigningString('POST', path, ''), t),
      );
  const run = (jobId: string) => signed(INTERNAL_MEMORY_PATHS.runExtractionJob(jobId));
  const abandon = (jobId: string) => signed(INTERNAL_MEMORY_PATHS.abandonExtractionJob(jobId));

  type S = Awaited<ReturnType<typeof h.signIn>>;
  const consent = async (s: S, purpose: string, decision: 'grant' | 'revoke') => {
    const g = await owner.consentGrant.findFirst({
      where: { userId: s.userId, purpose: purpose as never },
    });
    await h
      .http()
      .put(`/v1/me/consents/${purpose}`)
      .set('authorization', s.auth)
      .set('if-match', `"${g?.version ?? 0}"`)
      .send({ decision, notice_version: TEST_NOTICE_VERSION, source: 'settings' })
      .expect(200);
  };
  const account = async (tag: string, memory = true) => {
    const s = await h.signIn(await h.activeAccount(tag));
    await consent(s, 'AI_PROCESSING', 'grant');
    if (memory) await consent(s, 'MEMORY_STORAGE', 'grant');
    return s;
  };
  const conversation = async (s: S, body: object = {}) =>
    (await h.http().post('/v1/conversations').set('authorization', s.auth).send(body).expect(201))
      .body.id as string;
  /** Sends a message and waits for the reply; returns ids and the job (if any). */
  const say = async (s: S, threadId: string, content: string) => {
    const sent = await h
      .http()
      .post(`/v1/conversations/${threadId}/messages`)
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ content })
      .expect(202);
    const aid = sent.body.assistant_message.id as string;
    const uid = sent.body.user_message.id as string;
    for (let i = 0; i < 200; i += 1) {
      const m = await owner.conversationMessage.findUniqueOrThrow({ where: { id: aid } });
      if (['completed', 'incomplete', 'failed', 'canceled'].includes(m.status)) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    const job = await owner.memoryExtractionJob.findUnique({ where: { sourceMessageId: uid } });
    return { userMessageId: uid, replyId: aid, job };
  };
  const starter = () => app.get<ManualWorkflowStarter>(WORKFLOW_STARTER);
  const items = (userId: string) =>
    owner.memoryItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

  // ── happy path, contract, idempotency ───────────────────────────────────────────────────
  it('explicit request → job in finalize, workflow started (ids only), run stores a verbatim memory', async () => {
    const s = await account('m5b-happy');
    const t = await conversation(s);
    const { userMessageId, job } = await say(s, t, "Remember that I'm vegetarian");
    expect(job).toMatchObject({ status: 'pending', threadId: t });
    expect(starter().started).toContainEqual({
      workflowType: MEMORY_WORKFLOWS.EXTRACTION,
      workflowId: memoryExtractionWorkflowId(userMessageId),
      input: { jobId: job!.id },
    });
    const r = await run(job!.id).expect(200);
    expect(r.body).toEqual({ outcome: 'stored' });
    const [item] = await items(s.userId);
    expect(item).toMatchObject({
      valueText: "I'm vegetarian",
      origin: 'explicit_request',
      sourceMessageId: userMessageId,
      sourceThreadId: t,
      status: 'active',
    });
    // The extract call carried ONE user message and a pseudonymous user ref (never the raw id).
    const req = stub.extractRequests.at(-1)!;
    expect(req.message_text).toBe("Remember that I'm vegetarian");
    expect(req.user_ref).not.toContain(s.userId);
    expect(req.request_id).toBe(`memx_${job!.id}_1`);
    const done = await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: job!.id } });
    expect(done).toMatchObject({
      status: 'completed',
      outcomeCode: 'stored',
      storedCount: 1,
      policyVersion: expect.any(String),
    });
    expect(
      await owner.aiInvocation.count({ where: { requestId: req.request_id, isMock: true } }),
    ).toBe(1);
    const ledger = await owner.usageLedgerEntry.findMany({ where: { userId: s.userId } });
    expect(ledger.reduce((a, l) => a + l.memoryExtractionRequests, 0)).toBe(1);
    expect(
      await owner.auditEvent.count({
        where: { action: 'memory.extraction.completed', subjectId: job!.id },
      }),
    ).toBe(1);
    // Activity (chips) shows the saved item id and version for Undo.
    const act = await h
      .http()
      .get(`/v1/memory/activity?conversation_id=${t}`)
      .set('authorization', s.auth)
      .expect(200);
    expect(act.body.items[0]).toMatchObject({
      status: 'completed',
      outcome_code: 'stored',
      items: [{ id: item!.id, version: 0 }],
    });
    // T-RACE-14: idempotent replay of a terminal job writes nothing new.
    expect((await run(job!.id).expect(200)).body).toEqual({ outcome: 'stored' });
    expect(await items(s.userId)).toHaveLength(1);
  });

  it('T-RACE-14 replayed signature is rejected; unknown job is 404 (non-retryable for the worker)', async () => {
    const path = INTERNAL_MEMORY_PATHS.runExtractionJob(randomUUID());
    const header = signTimestamped(
      SECRET,
      internalRequestSigningString('POST', path, ''),
      Math.floor(Date.now() / 1000),
    );
    await h.http().post(path).set(INTERNAL_SIGNATURE_HEADER, header).expect(404);
    await h.http().post(path).set(INTERNAL_SIGNATURE_HEADER, header).expect(401);
    await h.http().post(path).expect(401);
  });

  // ── job creation matrix (§8.2, §9.2, Q10) ───────────────────────────────────────────────
  it('no job for: thread off, ephemeral, no consent, failed reply (Q10); one job per source message', async () => {
    const s = await account('m5b-matrix');
    expect(
      (await say(s, await conversation(s, { memory_enabled: false }), 'remember I like tea')).job,
    ).toBeNull();
    expect(
      (await say(s, await conversation(s, { mode: 'ephemeral' }), 'remember I like tea')).job,
    ).toBeNull();
    expect(
      (
        await say(
          s,
          await conversation(s),
          'remember I like tea [[stub:fail=GATEWAY_PROVIDER_ERROR]]',
        )
      ).job,
    ).toBeNull();
    const n = await account('m5b-matrix-noconsent', false);
    expect((await say(n, await conversation(n), 'remember I like tea')).job).toBeNull();
    // Regenerate the same user message → still exactly one job.
    const t = await conversation(s);
    const first = await say(s, t, 'remember I like rasam');
    expect(first.job).not.toBeNull();
    await h
      .http()
      .post(`/v1/conversations/${t}/messages/${first.replyId}/regenerate`)
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .expect(202);
    await new Promise((r) => setTimeout(r, 500));
    expect(
      await owner.memoryExtractionJob.count({ where: { sourceMessageId: first.userMessageId } }),
    ).toBe(1);
  });

  // ── deterministic validation on the mock pipeline (T-EXT) ───────────────────────────────
  it('secret in the message → nothing stored, rejected_class secret; non-explicit → suggestion only', async () => {
    const s = await account('m5b-validate');
    const t = await conversation(s);
    const sec = await say(s, t, 'remember my card number is 4111 1111 1111 1111');
    expect((await run(sec.job!.id).expect(200)).body).toEqual({ outcome: 'rejected' });
    expect(
      await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: sec.job!.id } }),
    ).toMatchObject({ rejectedClass: 'secret', storedCount: 0 });
    const stated = await say(s, t, 'I hate cilantro');
    expect((await run(stated.job!.id).expect(200)).body).toEqual({ outcome: 'suggested' });
    expect(await items(s.userId)).toEqual([]);
    expect(
      await owner.memorySuggestion.count({ where: { userId: s.userId, reason: 'stated' } }),
    ).toBe(1);
    // A model claiming "explicit" for text that is not in the message cannot store anything (V2).
    const forged = await say(s, t, 'remember I like plain rice');
    stub.extract = () => ({
      candidates: [
        {
          kind: 'preference',
          slot: 'other',
          subject: 'self',
          source_span: 'remember I like caviar',
          value_text: 'I like caviar',
          explicit_request: true,
          sensitivity: 'none',
        },
      ],
    });
    expect((await run(forged.job!.id).expect(200)).body).toEqual({ outcome: 'rejected' });
    expect(await items(s.userId)).toEqual([]);
  });

  it('tier-1 supersedes an unpinned single-slot value (undo restores it); a pinned value becomes a conflict suggestion', async () => {
    const s = await account('m5b-supersede');
    const t = await conversation(s);
    const city = (text: string) => ({
      candidates: [
        {
          kind: 'fact' as const,
          slot: 'home_city',
          subject: 'self' as const,
          source_span: `remember ${text}`,
          value_text: text,
          explicit_request: true,
          trigger_text: 'remember',
          sensitivity: 'none' as const,
        },
      ],
    });
    stub.extract = () => city('I live in Pune');
    const a = await say(s, t, 'remember I live in Pune');
    await run(a.job!.id).expect(200);
    stub.extract = () => city('I live in Delhi');
    const b = await say(s, t, 'remember I live in Delhi');
    expect((await run(b.job!.id).expect(200)).body).toEqual({ outcome: 'stored' });
    const [item] = await items(s.userId);
    expect(item).toMatchObject({ valueText: 'I live in Delhi', version: 1 });
    expect(await owner.memoryItemRevision.findMany({ where: { itemId: item!.id } })).toEqual([
      expect.objectContaining({
        valueText: 'I live in Pune',
        changedBy: 'explicit_supersede',
        itemVersion: 0,
      }),
    ]);
    const undo = await h
      .http()
      .post(`/v1/memory/${item!.id}/undo`)
      .set('authorization', s.auth)
      .set('if-match', '"1"')
      .expect(200);
    expect(undo.body).toMatchObject({ outcome: 'reverted', item: { text: 'I live in Pune' } });
    // Pin it → the next explicit value does not override the user's pin.
    await h
      .http()
      .patch(`/v1/memory/${item!.id}`)
      .set('authorization', s.auth)
      .set('if-match', '"2"')
      .send({ pinned: true })
      .expect(200);
    stub.extract = () => city('I live in Goa');
    const c = await say(s, t, 'remember I live in Goa');
    expect((await run(c.job!.id).expect(200)).body).toEqual({ outcome: 'suggested' });
    expect((await items(s.userId))[0]!.valueText).toBe('I live in Pune');
    expect(await owner.memorySuggestion.findFirst({ where: { userId: s.userId } })).toMatchObject({
      reason: 'conflict',
      conflictsWithItemId: item!.id,
    });
  });

  // ── race and resurrection suite (§13.2) ─────────────────────────────────────────────────
  it('T-RACE-01 revoke while the AI call is in flight → nothing stored, job canceled by the trigger', async () => {
    const s = await account('m5b-race01');
    const t = await conversation(s);
    const { job } = await say(s, t, 'remember I like mangoes');
    stub.extract = (req) => ({
      ...defaultExtract(req),
      before: () => consent(s, 'MEMORY_STORAGE', 'revoke'),
    });
    const r = await run(job!.id).expect(200);
    expect(r.body.outcome).toBe('consent_revoked');
    expect(await items(s.userId)).toEqual([]);
    expect(
      await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: job!.id } }),
    ).toMatchObject({ status: 'canceled' });
  });

  it('T-RACE-18 revoke between TX-A and the AI call → zero AI calls (pre-call re-check)', async () => {
    const s = await account('m5b-race18');
    const t = await conversation(s);
    const { job } = await say(s, t, 'remember I like guava');
    const usage = app.get(UsageLimitsService, { strict: false });
    const original = usage.reserve.bind(usage);
    usage.reserve = async (...args: Parameters<typeof usage.reserve>) => {
      const res = await original(...args);
      // Revoke directly in the user's scope (the trigger cancels the job), AFTER TX-A committed.
      await owner.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('karen.user_id', ${s.userId}, true)`;
        await tx.$executeRaw`UPDATE consent.consent_grants SET status = 'REVOKED', revoked_at = now() WHERE user_id = ${s.userId}::uuid AND purpose = 'MEMORY_STORAGE'`;
      });
      return res;
    };
    const before = stub.extractRequests.length;
    try {
      expect((await run(job!.id).expect(200)).body.outcome).toBe('consent_revoked');
    } finally {
      usage.reserve = original;
    }
    expect(stub.extractRequests.length).toBe(before);
    expect(await items(s.userId)).toEqual([]);
  });

  it('T-RACE-04 / T-RACE-05 / T-RACE-10: thread deleted → 404; switch off → thread_off; clear → cleared', async () => {
    const s = await account('m5b-race-misc');
    const t1 = await conversation(s);
    const gone = await say(s, t1, 'remember I like kebabs');
    await h.http().delete(`/v1/conversations/${t1}`).set('authorization', s.auth).expect(204);
    await run(gone.job!.id).expect(404);

    const t2 = await conversation(s);
    const off = await say(s, t2, 'remember I like naan');
    const v = (await owner.conversationThread.findUniqueOrThrow({ where: { id: t2 } })).version;
    await h
      .http()
      .patch(`/v1/conversations/${t2}`)
      .set('authorization', s.auth)
      .set('if-match', `"${v}"`)
      .send({ memory_enabled: false })
      .expect(200);
    expect((await run(off.job!.id).expect(200)).body.outcome).toBe('thread_off');

    const t3 = await conversation(s);
    const cleared = await say(s, t3, 'remember I like lassi');
    await h
      .http()
      .post('/v1/memory/clear')
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ scope: 'all' })
      .expect(200);
    expect((await run(cleared.job!.id).expect(200)).body.outcome).toBe('cleared');
    expect(await items(s.userId)).toEqual([]);
  });

  it('T-RACE-07 two concurrent runs of the same job write exactly once (CAS)', async () => {
    const s = await account('m5b-race07');
    const t = await conversation(s);
    const { job } = await say(s, t, 'remember I like jalebi');
    const results = await Promise.all([run(job!.id), run(job!.id)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => (r.body as { outcome: string }).outcome)).toEqual(
      expect.arrayContaining(['stored']),
    );
    expect(await items(s.userId)).toHaveLength(1);
  });

  it('T-RACE-09 erasure while a job is pending → job gone; run 404', async () => {
    const s = await account('m5b-race09');
    const t = await conversation(s);
    const { job } = await say(s, t, 'remember I like poha');
    await owner.memoryExtractionJob.delete({ where: { id: job!.id } }); // what erase_user does (T-DR-03 covers erase_user itself)
    await run(job!.id).expect(404);
  });

  it('budget refusal → skipped/budget; retryable AI failure → back to pending (retry-safe); non-retryable → failed', async () => {
    const s = await account('m5b-budget');
    const t = await conversation(s);
    const a = await say(s, t, 'remember I like coffee');
    const usage = app.get(UsageLimitsService, { strict: false });
    const original = usage.reserve.bind(usage);
    usage.reserve = () => Promise.reject(new ApiError('USAGE_LIMIT_REACHED', 'limit'));
    try {
      expect((await run(a.job!.id).expect(200)).body.outcome).toBe('budget');
      expect(
        await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: a.job!.id } }),
      ).toMatchObject({ status: 'skipped', outcomeCode: 'budget' });
    } finally {
      usage.reserve = original;
    }
    const b2 = await say(s, t, 'remember I like dosa');
    stub.extract = () => ({ status: 503 });
    await run(b2.job!.id).expect(503);
    expect(
      (await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: b2.job!.id } })).status,
    ).toBe('pending');
    stub.extract = () => ({ status: 422 });
    expect((await run(b2.job!.id).expect(200)).body.outcome).toBe('gateway_error');
    expect(
      await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: b2.job!.id } }),
    ).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('abandon: pending → failed/abandoned (idempotent); terminal job keeps its outcome', async () => {
    const s = await account('m5b-abandon');
    const t = await conversation(s);
    const { job } = await say(s, t, 'remember I like idli');
    expect((await abandon(job!.id).expect(200)).body).toEqual({ outcome: 'abandoned' });
    expect((await abandon(job!.id).expect(200)).body).toEqual({ outcome: 'abandoned' });
    expect((await run(job!.id).expect(200)).body).toEqual({ outcome: 'abandoned' });
    expect(await items(s.userId)).toEqual([]);
  });

  it('T-RACE-13 maintenance: re-kick calls start for due jobs; stale jobs terminated then purged later', async () => {
    const s = await account('m5b-sweep');
    const t = await conversation(s);
    const { job, userMessageId } = await say(s, t, 'remember I like chikki');
    // Simulate a lost start: drop the recorded start, then sweep.
    const st = starter();
    const idx = st.started.findIndex(
      (x) => x.workflowId === memoryExtractionWorkflowId(userMessageId),
    );
    st.started.splice(idx, 1);
    // Make it the oldest due job (the re-kick list is bounded to 100, oldest first).
    await owner.$executeRaw`UPDATE memory.extraction_jobs SET next_attempt_at = now() - interval '23 hours' WHERE id = ${job!.id}::uuid`;
    const sweep = app.get(MemoryMaintenanceService, { strict: false });
    const r1 = await sweep.sweep();
    expect(r1.rekicked).toBeGreaterThanOrEqual(1);
    expect(st.started.some((x) => x.workflowId === memoryExtractionWorkflowId(userMessageId))).toBe(
      true,
    );
    // Age it past the DB max age → terminated, never "recovered".
    await owner.$executeRaw`UPDATE memory.extraction_jobs SET created_at = now() - interval '25 hours' WHERE id = ${job!.id}::uuid`;
    const r2 = await sweep.sweep();
    expect(r2.staleTerminated).toBeGreaterThanOrEqual(1);
    expect(
      await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: job!.id } }),
    ).toMatchObject({ status: 'failed', outcomeCode: 'abandoned_stale' });
    await owner.$executeRaw`UPDATE memory.extraction_jobs SET expires_at = now() - interval '1 minute' WHERE id = ${job!.id}::uuid`;
    await sweep.sweep();
    expect(await owner.memoryExtractionJob.findUnique({ where: { id: job!.id } })).toBeNull();
  });

  it('T-RACE-06 a memory deleted before the job runs is not resurrected from cached state', async () => {
    const s = await account('m5b-race06');
    const t = await conversation(s);
    const vk = createHash('sha256')
      .update(
        memoryValueKeyMaterial({
          kind: 'preference',
          slot: 'other',
          subject: 'self',
          text: 'I like bhel',
        }),
      )
      .digest('hex');
    await owner.$executeRaw`
      INSERT INTO memory.items (user_id, kind, slot, single_valued, subject, value_text, value_key, search_lexemes, origin, source_recorded_at, confirmed_at)
      VALUES (${s.userId}::uuid, 'preference', 'other', false, 'self', 'I like bhel', ${vk}, array_to_tsvector(${tokenizeForSearch('I like bhel')}::text[]), 'user_created', now(), now())`;
    const { job } = await say(s, t, 'remember I like sev puri');
    await h
      .http()
      .post('/v1/memory/clear')
      .set('authorization', s.auth)
      .set('idempotency-key', `k-${randomUUID()}`)
      .send({ scope: 'kind', kind: 'preference' })
      .expect(200);
    // `kind` clear does not cancel jobs (M-12): the job still stores ONLY its own new candidate.
    expect((await run(job!.id).expect(200)).body.outcome).toBe('stored');
    expect((await items(s.userId)).map((i) => i.valueText)).toEqual(['I like sev puri']);
  });
});
