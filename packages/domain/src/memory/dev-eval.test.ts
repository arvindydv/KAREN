/**
 * Regression guard on the DEV split only (evals/datasets/memory/*.dev.jsonl), plus a seal check
 * that the sealed TEST split files are unchanged (OD-11 (a); SEALED.md). The test split is never
 * evaluated here: its numbers are produced only by the M4b/M7 evaluation runs.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tokenizeForSearch } from './normalise.js';
import { decideTier1, detectSensitive, mentionsChild } from './policy.js';
import { rankMemories, type CandidateReason, type RetrievalCandidate } from './scoring.js';
import { rejectWholeMessage } from './validation.js';

const DIR = fileURLToPath(new URL('../../../../evals/datasets/memory/', import.meta.url));
const read = (name: string) => readFileSync(DIR + name, 'utf8');
const rows = (name: string): Record<string, unknown>[] =>
  read(name)
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('sealed test split is unchanged (OD-11 a)', () => {
  it('SHA-256 of every sealed file matches SEALED.md', () => {
    const sealed = read('SEALED.md');
    for (const name of ['retrieval.v1.test.jsonl', 'extraction.v1.test.jsonl']) {
      const m = new RegExp(`\`${name.replace(/\./g, '\\.')}\`[^\\n]*\`([0-9a-f]{64})\``).exec(
        sealed,
      );
      expect(m, name).not.toBeNull();
      const digest = createHash('sha256').update(read(name)).digest('hex');
      expect(digest, name).toBe(m![1]);
    }
  });
});

describe('extraction policy — dev split regression', () => {
  const data = rows('extraction.v1.dev.jsonl');
  const tier1 = (message: string, span: string) =>
    decideTier1({ message, span, subject: 'self', askBeforeSaving: false, modelExplicit: true })
      .tier1;

  const checks: Record<string, (r: Record<string, unknown>) => boolean> = {
    secret: (r) => rejectWholeMessage(r.message as string)?.class === 'secret',
    secret_near_miss: (r) => rejectWholeMessage(r.message as string) === null,
    sensitive: (r) => detectSensitive(r.span as string).length > 0,
    sensitive_negative: (r) =>
      detectSensitive(r.span as string).length === 0 &&
      rejectWholeMessage(r.message as string) === null,
    minor_self: (r) => rejectWholeMessage(r.message as string)?.class === 'minor',
    minor_third_party: (r) => mentionsChild(r.message as string),
    minor_negative: (r) => rejectWholeMessage(r.message as string) === null,
    explicit: (r) => tier1(r.message as string, r.span as string),
    negated: (r) => !tier1(r.message as string, r.span as string),
    question: (r) => !tier1(r.message as string, r.span as string),
    reminder: (r) => !tier1(r.message as string, r.span as string),
    multi_clause: (r) => !tier1(r.message as string, r.span as string),
    stated: (r) => !tier1(r.message as string, r.span as string),
  };
  for (const [slice, check] of Object.entries(checks)) {
    it(`${slice}: every dev record handled correctly`, () => {
      const subset = data.filter((r) => r.slice === slice);
      expect(subset.length).toBeGreaterThan(0);
      const failures = subset.filter((r) => !check(r)).map((r) => r.message);
      expect(failures).toEqual([]);
    });
  }
});

describe('retrieval scorer — dev split regression (SQL branches simulated)', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const DAY = 86_400_000;
  const data = rows('retrieval.v1.dev.jsonl');
  type Mem = {
    id: string;
    kind: RetrievalCandidate['kind'];
    slot: string;
    subject: 'self' | 'third_party';
    text: string;
    pinned: boolean;
    saved_days_ago: number;
    expires_in_days: number | null;
  };
  const users = new Map(
    data.filter((r) => r.record === 'user').map((u) => [u.user as string, u.memories as Mem[]]),
  );

  function candidates(user: string, q: Set<string>): RetrievalCandidate[] {
    const items = users
      .get(user)!
      .map((x) => {
        const updatedAt = new Date(now.getTime() - x.saved_days_ago * DAY);
        const expiresAt =
          x.expires_in_days === null ? null : new Date(now.getTime() + x.expires_in_days * DAY);
        return { x, updatedAt, expiresAt, lexemes: tokenizeForSearch(x.text) };
      })
      .filter((i) => !i.expiresAt || i.expiresAt > now) // SQL lifecycle filter
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.x.id < b.x.id ? -1 : 1));
    const sel = new Map<string, { item: (typeof items)[number]; reasons: CandidateReason[] }>();
    const add = (list: typeof items, reason: CandidateReason) =>
      list.forEach((i) => {
        const e = sel.get(i.x.id) ?? { item: i, reasons: [] };
        e.reasons.push(reason);
        sel.set(i.x.id, e);
      });
    add(items.filter((i) => i.lexemes.some((t) => q.has(t))).slice(0, 40), 'lexical');
    add(items.filter((i) => i.x.pinned).slice(0, 5), 'pinned');
    add(items.filter((i) => i.x.kind === 'preference').slice(0, 10), 'always');
    add(items.filter((i) => now.getTime() - i.updatedAt.getTime() < 7 * DAY).slice(0, 5), 'recent');
    return [...sel.values()].map(({ item, reasons }) => ({
      id: item.x.id,
      kind: item.x.kind,
      slot: item.x.slot,
      subject: item.x.subject,
      subjectLabel: null,
      text: item.x.text,
      pinned: item.x.pinned,
      lexemes: item.lexemes,
      valueKey: item.x.id,
      reasons,
      createdAt: item.updatedAt,
      updatedAt: item.updatedAt,
      expiresAt: item.expiresAt,
      eventDate: null,
    }));
  }

  const queries = data.filter((r) => r.record === 'query');
  const run = (slice: string) =>
    queries
      .filter((q) => q.slice === slice)
      .map((q) => {
        const qt = tokenizeForSearch(q.text as string);
        const ranked = rankMemories(candidates(q.user as string, new Set(qt)), qt, now).map(
          (r) => r.id,
        );
        const rel = q.relevant as string[];
        return {
          top5: rel.length > 0 && rel.every((id) => ranked.slice(0, 5).includes(id)),
          inContext: rel.length > 0 && rel.every((id) => ranked.includes(id)),
          leak: (q.must_not as string[]).some((id) => ranked.includes(id)),
        };
      });

  for (const slice of ['en', 'hi', 'hg']) {
    it(`${slice}: recall@5 ≥ 0.9 and recall-in-context ≥ 0.95 on dev`, () => {
      const r = run(slice);
      expect(r.filter((x) => x.top5).length / r.length).toBeGreaterThanOrEqual(0.9);
      expect(r.filter((x) => x.inContext).length / r.length).toBeGreaterThanOrEqual(0.95);
    });
  }
  it('isolation, temporal and distractor slices: no must-not item is ever returned', () => {
    for (const slice of ['isolation', 'temporal', 'distractor']) {
      expect(run(slice).filter((x) => x.leak)).toEqual([]);
    }
  });
});
