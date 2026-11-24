import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MEMORY_LIMITS,
  MEMORY_SCORER_VERSION,
  MEMORY_TOKENIZER_VERSION,
  memoryValueKeyMaterial,
  rankMemories,
  tokenizeForSearch,
  type RetrievalCandidate,
} from '@karen/domain/memory';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { MemoryRetrievalService } from '../src/memory/memory-retrieval.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION } from './notices.js';
import { startApp } from './support.js';

/**
 * Phase 03 / M4b — retrieval evaluation harness (arch §13.3; test strategy T-RET-EVAL, T-PERF-01).
 *
 * Runs the REAL retrieval path (owner-filtered SQL under RLS + TypeScript scorer + budget + wire
 * validation) over the SEALED test split (and the dev split for comparison), and the F1
 * (`to_tsvector('simple', …)`) alternative for the lexical branch with the same scorer.
 * Zero-tolerance properties are ASSERTED (wrong-user recall, expired items, budget). Recall
 * thresholds are only REPORTED: Q9 (thresholds) is not owner-approved, so nothing is "accepted".
 * Set MEMORY_EVAL_REPORT_DIR to write the JSON report (M4b/M7 evidence).
 */
const DATA = fileURLToPath(new URL('../../../evals/datasets/memory/', import.meta.url));
const SEAL: Record<string, string> = {
  'retrieval.v1.test.jsonl': '559236ea50d93fe71f0b9732cd14f425b9489b92cd6287a0fe9484d4c1a15d3d',
  'retrieval.v1.dev.jsonl': '974a68a741ee864261aa7cbf312e8b2cb007abc9b4f604ac5ac212e4b37eeae2',
};

interface Mem {
  id: string;
  kind: 'fact' | 'preference' | 'context' | 'event';
  slot: string;
  subject: 'self' | 'third_party';
  text: string;
  pinned: boolean;
  saved_days_ago: number;
  expires_in_days: number | null;
  subject_label?: string;
}
interface Query {
  qid: string;
  user: string;
  slice: string;
  lang: string;
  text: string;
  relevant: string[];
  must_not: string[];
}

/** 95 % Wilson score interval (arch §13.3 rule 3). */
export function wilson(k: number, n: number): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: (c - m) / d, hi: (c + m) / d };
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;

describe('memory retrieval evaluation (M4b harness, integration)', () => {
  let app: NestFastifyApplication;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const runtime = new PrismaService(testEnv({ DATABASE_POOL_MAX: '4' }));
  const report: Record<string, unknown> = {};

  beforeAll(async () => {
    app = await startApp({
      MEMORY_FEATURE_ENABLED: 'true',
      MEMORY_CONSENT_ELIGIBLE_POLICY_VERSIONS: TEST_NOTICE_VERSION,
      // Evaluation measures ranking, not the latency guard (measured separately below).
      MEMORY_RETRIEVAL_TIMEOUT_MS: '5000',
    });
    await runtime.$connect();
  }, 120_000);
  afterAll(async () => {
    const dir = process.env.MEMORY_EVAL_REPORT_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/memory-retrieval.v1.json`, `${JSON.stringify(report, null, 2)}\n`);
    }
    await app.close();
    await Promise.all([owner.$disconnect(), runtime.$disconnect()]);
  });

  const load = (name: string) => {
    const raw = readFileSync(DATA + name, 'utf8');
    expect(createHash('sha256').update(raw).digest('hex'), `${name} seal`).toBe(SEAL[name]);
    const rows = raw
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    return {
      users: rows.filter((r) => r.record === 'user') as unknown as {
        user: string;
        memories: Mem[];
      }[],
      queries: rows.filter((r) => r.record === 'query') as unknown as Query[],
    };
  };

  /** Seeds one DB user + memory-enabled thread per dataset user; returns id maps. */
  const seed = async (users: { user: string; memories: Mem[] }[]) => {
    const userIds = new Map<string, string>();
    const threads = new Map<string, string>();
    const itemOf = new Map<string, string>(); // db item id → dataset memory id
    const ownerOf = new Map<string, string>(); // db item id → dataset user
    for (const u of users) {
      const id = randomUUID();
      userIds.set(u.user, id);
      await owner.user.create({ data: { id, displayName: `eval-${u.user}` } });
      for (const purpose of ['AI_PROCESSING', 'MEMORY_STORAGE'] as const) {
        await owner.consentGrant.create({
          data: { userId: id, purpose, policyVersion: TEST_NOTICE_VERSION, receiptHash: 'eval' },
        });
      }
      const t = await owner.conversationThread.create({
        data: { userId: id, title: 'eval', locale: 'en-IN', mode: 'standard', memoryEnabled: true },
      });
      threads.set(u.user, t.id);
      const rows = u.memories.map((m) => ({
        did: m.id,
        kind: m.kind,
        slot: m.slot,
        subject: m.subject,
        label: m.subject === 'third_party' ? (m.subject_label ?? 'contact') : null,
        text: m.text,
        key: createHash('sha256')
          .update(
            memoryValueKeyMaterial({
              kind: m.kind,
              slot: m.slot,
              subject: m.subject,
              subjectLabel: m.subject === 'third_party' ? (m.subject_label ?? 'contact') : null,
              text: m.text,
            }),
          )
          .digest('hex'),
        lexemes: tokenizeForSearch(m.text),
        pinned: m.pinned,
        ago: m.saved_days_ago,
        exp: m.kind === 'context' && m.expires_in_days === null ? 30 : m.expires_in_days,
      }));
      await owner.$executeRaw`
        INSERT INTO memory.items (user_id, kind, slot, single_valued, subject, subject_label,
          value_text, value_key, search_lexemes, origin, pinned, source_recorded_at, confirmed_at,
          expires_at, created_at, updated_at)
        SELECT ${id}::uuid, r.kind, r.slot, false, r.subject, r.label, r.text, r.key,
               array_to_tsvector(ARRAY(SELECT jsonb_array_elements_text(r.lexemes))),
               'user_created', r.pinned, now() - make_interval(days => r.ago),
               now() - make_interval(days => r.ago),
               CASE WHEN r.exp IS NULL THEN NULL ELSE now() + make_interval(days => r.exp) END,
               now() - make_interval(days => r.ago), now() - make_interval(days => r.ago)
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(did text, kind text,
               slot text, subject text, label text, text text, key text, lexemes jsonb,
               pinned boolean, ago int, exp int)
        ON CONFLICT DO NOTHING`;
      const byKey = new Map(rows.map((r) => [`${r.kind}|${r.slot}|${r.key}`, r.did]));
      const stored = await owner.memoryItem.findMany({
        where: { userId: id },
        select: { id: true, kind: true, slot: true, valueKey: true },
      });
      for (const r of stored) {
        const did = byKey.get(`${r.kind}|${r.slot}|${r.valueKey}`);
        if (did) itemOf.set(r.id, did);
        ownerOf.set(r.id, u.user);
      }
    }
    return { userIds, threads, itemOf, ownerOf };
  };

  const evaluate = async (split: 'test' | 'dev') => {
    const { users, queries } = load(`retrieval.v1.${split}.jsonl`);
    const { userIds, threads, itemOf, ownerOf } = await seed(users);
    const svc = app.get(MemoryRetrievalService, { strict: false });
    type Acc = { n: number; at5: number; inCtx: number; mrr: number; mustNot: number };
    const slices = new Map<string, Acc>();
    let wrongUser = 0;
    let budgetViolations = 0;
    let expiredSent = 0;
    let boundHits = 0;
    const f1 = new Map<string, { n: number; at5: number }>();
    const durations: number[] = [];
    const expiredIds = new Set(
      users.flatMap((u) =>
        u.memories
          .filter((m) => m.expires_in_days !== null && m.expires_in_days <= 0)
          .map((m) => m.id),
      ),
    );
    for (const q of queries) {
      const uid = userIds.get(q.user)!;
      const t0 = performance.now();
      const res = await svc.retrieve({
        userId: uid,
        threadId: threads.get(q.user)!,
        latestUserText: q.text,
        previousUserText: null,
      });
      durations.push(performance.now() - t0);
      expect(res.status, q.qid).toBe('on');
      const sentDs = res.sent.map((s) => itemOf.get(s.itemId));
      expiredSent += sentDs.filter((d) => d !== undefined && expiredIds.has(d)).length;
      wrongUser += res.sent.filter((s) => ownerOf.get(s.itemId) !== q.user).length;
      if (
        res.context.length > MEMORY_LIMITS.contextBudgetItems ||
        res.context.reduce((a, c) => a + [...c.text].length, 0) > MEMORY_LIMITS.contextMaxChars
      ) {
        budgetViolations += 1;
      }
      const acc = slices.get(q.slice) ?? { n: 0, at5: 0, inCtx: 0, mrr: 0, mustNot: 0 };
      if (q.must_not.some((m) => sentDs.includes(m))) acc.mustNot += 1;
      if (q.relevant.length > 0) {
        acc.n += 1;
        const top5 = sentDs.slice(0, 5);
        if (q.relevant.every((r) => top5.includes(r))) acc.at5 += 1;
        if (q.relevant.every((r) => sentDs.includes(r))) acc.inCtx += 1;
        const first = sentDs.findIndex((d) => d !== undefined && q.relevant.includes(d));
        acc.mrr += first >= 0 ? 1 / (first + 1) : 0;
      }
      slices.set(q.slice, acc);
      // F1 comparison (arch §6.3): the `simple` parser on BOTH sides (database locale
      // dependent, no app-side normalisation), OR semantics like F2, the same scorer and bounds.
      if (q.relevant.length > 0) {
        const f = f1.get(q.slice) ?? { n: 0, at5: 0 };
        const hit = await runtime.withUserScope(uid, async (tx) => {
          const [qt] = await tx.$queryRaw<{ tokens: string[] }[]>`
            SELECT coalesce(tsvector_to_array(to_tsvector('simple', ${q.text})), '{}') AS tokens`;
          const tokens = qt?.tokens ?? [];
          const rows = await tx.$queryRaw<
            (Omit<RetrievalCandidate, 'lexemes' | 'reasons'> & {
              lexemes: string[];
              lex: boolean;
            })[]
          >`
            SELECT i.id, i.kind, i.slot, i.subject, i.subject_label AS "subjectLabel",
                   i.value_text AS text, i.pinned, i.value_key AS "valueKey",
                   tsvector_to_array(to_tsvector('simple', i.value_text)) AS lexemes,
                   i.created_at AS "createdAt", i.updated_at AS "updatedAt",
                   i.expires_at AS "expiresAt", NULL AS "eventDate",
                   cardinality(${tokens}::text[]) > 0 AND to_tsvector('simple', i.value_text) @@
                     (SELECT string_agg(quote_literal(t), ' | ')::tsquery
                        FROM unnest(${tokens}::text[]) t) AS lex
              FROM memory.items i
             WHERE i.user_id = ${uid}::uuid AND i.status = 'active'
               AND (i.expires_at IS NULL OR i.expires_at > now())`;
          const byReason = (r: (typeof rows)[number]): RetrievalCandidate['reasons'] => [
            ...(r.lex ? (['lexical'] as const) : []),
            ...(r.pinned ? (['pinned'] as const) : []),
            ...(r.kind === 'preference' ? (['always'] as const) : []),
          ];
          const ranked = rankMemories(
            rows.map((r) => ({ ...r, reasons: byReason(r) })).filter((c) => c.reasons.length > 0),
            tokens,
            new Date(),
          );
          const top5 = ranked.slice(0, 5).map((c) => itemOf.get(c.id));
          return q.relevant.every((r) => top5.includes(r));
        });
        f.n += 1;
        if (hit) f.at5 += 1;
        f1.set(q.slice, f);
      }
      // Lexical bound (§6.4): how often more than 40 items matched lexically (bound hit).
      const tokens = tokenizeForSearch(q.text);
      if (tokens.length > 0) {
        const [m] = await runtime.withUserScope(
          uid,
          (tx) =>
            tx.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM memory.items
             WHERE user_id = ${uid}::uuid AND status = 'active'
               AND (expires_at IS NULL OR expires_at > now())
               AND search_lexemes @@ (SELECT string_agg(quote_literal(t), ' | ')::tsquery
                                        FROM unnest(${tokens}::text[]) t)`,
        );
        if ((m?.n ?? 0) > MEMORY_LIMITS.candidateLexicalMax) boundHits += 1;
      }
    }
    durations.sort((a, b) => a - b);
    const pct = (p: number) =>
      r3(durations[Math.min(durations.length - 1, Math.floor(p * durations.length))]!);
    const bySlice = Object.fromEntries(
      [...slices.entries()].map(([k, a]) => [
        k,
        {
          queries_with_relevant: a.n,
          recall_at_5: a.n ? { ...wilson(a.at5, a.n), k: a.at5 } : null,
          recall_in_context: a.n ? { ...wilson(a.inCtx, a.n), k: a.inCtx } : null,
          mrr: a.n ? r3(a.mrr / a.n) : null,
          must_not_violations: a.mustNot,
          f1_recall_at_5: f1.get(k) ? wilson(f1.get(k)!.at5, f1.get(k)!.n) : null,
        },
      ]),
    );
    return {
      split,
      queries: queries.length,
      users: users.length,
      wrong_user_items_sent: wrongUser,
      budget_violations: budgetViolations,
      expired_items_in_dataset: expiredIds.size,
      expired_items_sent: expiredSent,
      lexical_bound_hits: boundHits,
      latency_ms_local_docker: { p50: pct(0.5), p95: pct(0.95), max: pct(1) },
      slices: bySlice,
    };
  };

  it('sealed TEST split: zero-tolerance properties hold; recall reported with Wilson intervals', async () => {
    const r = await evaluate('test');
    report.test = r;
    expect(r.wrong_user_items_sent).toBe(0);
    expect(r.budget_violations).toBe(0);
    expect(r.expired_items_sent).toBe(0);
    for (const [slice, s] of Object.entries(r.slices)) {
      expect(s.must_not_violations, `${slice} must_not`).toBe(0);
    }
  }, 600_000);

  it('DEV split (comparison only)', async () => {
    const r = await evaluate('dev');
    report.dev = r;
    expect(r.wrong_user_items_sent).toBe(0);
    expect(r.budget_violations).toBe(0);
  }, 600_000);

  it('T-PERF-01 p95 with 500 active items per user × 50 users (local docker, not RDS)', async () => {
    const svc = app.get(MemoryRetrievalService, { strict: false });
    const users: { id: string; thread: string }[] = [];
    const vocab = [
      'chai',
      'dosa',
      'pune',
      'train',
      'office',
      'gym',
      'wedding',
      'flight',
      'yoga',
      'rain',
    ];
    for (let u = 0; u < 50; u += 1) {
      const id = randomUUID();
      await owner.user.create({ data: { id, displayName: `perf-${u}` } });
      for (const purpose of ['AI_PROCESSING', 'MEMORY_STORAGE'] as const) {
        await owner.consentGrant.create({
          data: { userId: id, purpose, policyVersion: TEST_NOTICE_VERSION, receiptHash: 'perf' },
        });
      }
      const t = await owner.conversationThread.create({
        data: { userId: id, title: 'perf', locale: 'en-IN', mode: 'standard', memoryEnabled: true },
      });
      await owner.$executeRaw`
        INSERT INTO memory.items (user_id, kind, slot, single_valued, subject, value_text, value_key,
          search_lexemes, origin, pinned, source_recorded_at, confirmed_at, created_at, updated_at)
        SELECT ${id}::uuid, CASE WHEN g % 3 = 0 THEN 'preference' ELSE 'fact' END, 'other', false,
               'self', 'note ' || g || ' about ' || (${vocab}::text[])[1 + g % 10],
               encode(sha256(convert_to(${id} || g::text, 'UTF8')), 'hex'),
               array_to_tsvector(ARRAY['note', g::text, (${vocab}::text[])[1 + g % 10]]),
               'user_created', g <= 3, now(), now(),
               now() - make_interval(hours => g), now() - make_interval(hours => g)
          FROM generate_series(1, 500) g`;
      users.push({ id, thread: t.id });
    }
    const times: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      const u = users[i % users.length]!;
      const t0 = performance.now();
      const res = await svc.retrieve({
        userId: u.id,
        threadId: u.thread,
        latestUserText: `any ${vocab[i % 10]} plans for the ${vocab[(i + 3) % 10]}?`,
        previousUserText: null,
      });
      times.push(performance.now() - t0);
      expect(res.status).toBe('on');
      expect(res.context.length).toBeLessThanOrEqual(12);
    }
    times.sort((a, b) => a - b);
    const p = (q: number) => r3(times[Math.floor(q * (times.length - 1))]!);
    report.perf = {
      label:
        'local docker PostgreSQL 17, end-to-end retrieve() incl. transaction; NOT an RDS figure',
      users: 50,
      items_per_user: 500,
      samples: times.length,
      p50_ms: p(0.5),
      p95_ms: p(0.95),
      max_ms: p(1),
      target_p95_ms: 150,
    };
    report.versions = {
      tokenizer: MEMORY_TOKENIZER_VERSION,
      scorer: MEMORY_SCORER_VERSION,
      search_option: 'F2 (app-side tokens, array_to_tsvector, quoted-lexeme tsquery)',
      thresholds: 'Q9 NOT APPROVED — results reported, not accepted',
    };
    // Reported, not asserted as a gate (target, local only); a gross regression still fails.
    expect(p(0.95)).toBeLessThan(1_000);
  }, 600_000);
});
