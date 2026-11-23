/**
 * Retrieval ranking, dedupe and budget (arch §6.5, §6.6). Pure and deterministic. SQL only
 * selects bounded candidate sets per reason (H2); all ranking happens here.
 *
 *   score = 1·pinned + 2·lexicalNorm + 2·[lexicalNorm > 0] + 0.5·alwaysPreference
 *           + freshness(kind, age) + 0.25·recent          (ms-1; arch §6.5 as tuned on dev)
 */
import { MEMORY_LIMITS } from './limits.js';
import { isSingleValuedSlot, type MemoryKind } from './vocabulary.js';

export type CandidateReason = 'lexical' | 'pinned' | 'always' | 'recent';

export interface RetrievalCandidate {
  id: string;
  kind: MemoryKind;
  slot: string;
  subject: 'self' | 'third_party';
  subjectLabel: string | null;
  text: string;
  pinned: boolean;
  /** Stored search lexemes (from `tokenizeForSearch`, same tokenizer version as the query). */
  lexemes: readonly string[];
  /** Dedupe key (`value_key`). */
  valueKey: string;
  /** Why SQL selected it (an item can be selected by several branches). */
  reasons: readonly CandidateReason[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  /** For events: the stated date (`valid_until`), if any. */
  eventDate: Date | null;
}

export interface ScoredCandidate extends RetrievalCandidate {
  score: number;
  lexicalNorm: number;
}

/** idf over the user's candidate set (≤ 60 rows): ln(1 + N / (1 + df)). Always > 0. */
export function inverseDocumentFrequency(
  candidates: readonly Pick<RetrievalCandidate, 'lexemes'>[],
): (token: string) => number {
  const df = new Map<string, number>();
  for (const c of candidates) for (const t of new Set(c.lexemes)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = candidates.length;
  return (t) => Math.log(1 + n / (1 + (df.get(t) ?? 0)));
}

/**
 * Weighted token overlap in [0, 1]: Σ idf(matched query tokens) / Σ idf(all query tokens).
 * 0 when the query has no tokens or nothing matches (H2: never constant 0 for a real match).
 */
export function lexicalNorm(
  queryTokens: readonly string[],
  itemLexemes: readonly string[],
  idf: (token: string) => number,
): number {
  const q = [...new Set(queryTokens)];
  if (q.length === 0) return 0;
  const item = new Set(itemLexemes);
  let total = 0;
  let matched = 0;
  for (const t of q) {
    const w = idf(t);
    total += w;
    if (item.has(t)) matched += w;
  }
  return total === 0 ? 0 : matched / total;
}

const DAY_MS = 86_400_000;

/** 0 for fact/preference; context/event decay linearly to 0 at expiry; stale events −1. */
export function freshness(
  c: Pick<RetrievalCandidate, 'kind' | 'createdAt' | 'expiresAt' | 'eventDate'>,
  now: Date,
): number {
  if (c.kind === 'fact' || c.kind === 'preference') return 0;
  if (c.kind === 'event' && c.eventDate && now.getTime() - c.eventDate.getTime() > 7 * DAY_MS) {
    return -1;
  }
  if (!c.expiresAt) return 0;
  const total = c.expiresAt.getTime() - c.createdAt.getTime();
  if (total <= 0) return 0;
  const left = c.expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.min(1, left / total));
}

/** Scorer weights, version MEMORY_SCORER_VERSION. */
export const MEMORY_SCORER_VERSION = 'ms-1';
export const WEIGHTS = {
  pinned: 1,
  lexical: 2,
  lexicalMatch: 2,
  alwaysPreference: 0.5,
  recent: 0.25,
} as const;

export function scoreCandidate(
  c: RetrievalCandidate,
  queryTokens: readonly string[],
  idf: (token: string) => number,
  now: Date,
): ScoredCandidate {
  const ln = lexicalNorm(queryTokens, c.lexemes, idf);
  const always = c.kind === 'preference' && c.reasons.includes('always');
  const recent = c.reasons.includes('recent');
  // Weights tuned on the dev split (recorded in arch §6.5): any lexical match outranks every
  // non-matching row (T-RET-05); pinned items are guaranteed a place by `applyBudget`, so their
  // weight only orders them among themselves.
  const lexicalBonus = ln > 0 ? WEIGHTS.lexicalMatch : 0;
  const score =
    WEIGHTS.pinned * (c.pinned ? 1 : 0) +
    WEIGHTS.lexical * ln +
    lexicalBonus +
    (always ? WEIGHTS.alwaysPreference : 0) +
    freshness(c, now) +
    (recent ? WEIGHTS.recent : 0);
  return { ...c, score, lexicalNorm: ln };
}

/** Deterministic order: score DESC, updatedAt DESC, id ASC. */
export function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.score !== a.score) return b.score - a.score;
  const t = b.updatedAt.getTime() - a.updatedAt.getTime();
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Drop exact `valueKey` duplicates and keep only the best item per single-valued slot. */
export function dedupeScored(sorted: readonly ScoredCandidate[]): ScoredCandidate[] {
  const keys = new Set<string>();
  const singles = new Set<string>();
  const ids = new Set<string>();
  const out: ScoredCandidate[] = [];
  for (const c of sorted) {
    if (ids.has(c.id) || keys.has(c.valueKey)) continue;
    const singleKey = `${c.subject}|${c.subjectLabel ?? ''}|${c.slot}`;
    if (isSingleValuedSlot(c.slot) && singles.has(singleKey)) continue;
    ids.add(c.id);
    keys.add(c.valueKey);
    if (isSingleValuedSlot(c.slot)) singles.add(singleKey);
    out.push(c);
  }
  return out;
}

export interface BudgetOptions {
  maxItems?: number;
  maxChars?: number;
}

/**
 * Greedy budget in rank order. Reserved items (pinned) are admitted first so they are always sent
 * when they fit; then the rest in rank order. An item that does not fit the remaining characters
 * is skipped and smaller later items may still fit. Never exceeds either bound. Output keeps rank
 * order.
 */
export function applyBudget<T extends { text: string }>(
  ranked: readonly T[],
  opts: BudgetOptions = {},
  isReserved: (item: T) => boolean = () => false,
): T[] {
  const maxItems = Math.min(
    opts.maxItems ?? MEMORY_LIMITS.contextBudgetItems,
    MEMORY_LIMITS.contextWireMaxItems,
  );
  const maxChars = opts.maxChars ?? MEMORY_LIMITS.contextMaxChars;
  const chosen = new Set<number>();
  let chars = 0;
  const admit = (pass: (item: T) => boolean) => {
    ranked.forEach((c, i) => {
      if (chosen.has(i) || chosen.size >= maxItems || !pass(c)) return;
      const len = [...c.text].length;
      if (chars + len > maxChars) return;
      chosen.add(i);
      chars += len;
    });
  };
  admit(isReserved);
  admit(() => true);
  return ranked.filter((_, i) => chosen.has(i));
}

export interface RankedMemory extends ScoredCandidate {
  /** Opaque per-request reference `m1`…`m20`; never a database id. */
  ref: string;
}

/** Full pipeline: score → sort → dedupe → budget → opaque refs. */
export function rankMemories(
  candidates: readonly RetrievalCandidate[],
  queryTokens: readonly string[],
  now: Date,
  opts: BudgetOptions = {},
): RankedMemory[] {
  const idf = inverseDocumentFrequency(candidates);
  const scored = candidates
    .map((c) => scoreCandidate(c, queryTokens, idf, now))
    .sort(compareScored);
  return applyBudget(dedupeScored(scored), opts, (c) => c.pinned).map((c, i) => ({
    ...c,
    ref: `m${i + 1}`,
  }));
}
