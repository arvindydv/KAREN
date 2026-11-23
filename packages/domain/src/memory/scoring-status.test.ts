/**
 * T-UNIT-08 (lexical scorer, H2) and T-UNIT-09 (effective status truth table, budget, dedupe),
 * plus vocabulary, workflow-id and validation-order checks.
 */
import { describe, expect, it } from 'vitest';
import {
  INTERNAL_MEMORY_PATHS,
  MEMORY_WORKFLOWS,
  memoryExtractionRequestId,
  memoryExtractionWorkflowId,
} from '../workflows.js';
import { MEMORY_LIMITS } from './limits.js';
import { tokenizeForSearch } from './normalise.js';
import {
  applyBudget,
  freshness,
  inverseDocumentFrequency,
  lexicalNorm,
  rankMemories,
  type RetrievalCandidate,
} from './scoring.js';
import { defaultThreadMemoryEnabled, effectiveMemoryStatus, toWireMemoryStatus } from './status.js';
import { validateCandidate } from './validation.js';
import { MEMORY_DTO_STATUSES, MEMORY_SLOTS, coerceSlot, isSingleValuedSlot } from './vocabulary.js';

const NOW = new Date('2026-11-23T12:00:00Z');
const DAY = 86_400_000;

function cand(
  over: Partial<RetrievalCandidate> & { id: string; text: string },
): RetrievalCandidate {
  return {
    kind: 'fact',
    slot: 'other',
    subject: 'self',
    subjectLabel: null,
    pinned: false,
    lexemes: tokenizeForSearch(over.text),
    valueKey: over.id,
    reasons: ['lexical'],
    createdAt: new Date(NOW.getTime() - 10 * DAY),
    updatedAt: new Date(NOW.getTime() - 10 * DAY),
    expiresAt: null,
    eventDate: null,
    ...over,
  };
}

describe('T-UNIT-08 lexical scorer (H2)', () => {
  it('a matching item gets a non-zero lexicalNorm; a non-matching item gets 0', () => {
    const items = [
      cand({ id: 'a', text: 'I live in Pune' }),
      cand({ id: 'b', text: 'I love tea' }),
    ];
    const idf = inverseDocumentFrequency(items);
    const q = tokenizeForSearch('weather in Pune today');
    expect(lexicalNorm(q, items[0]!.lexemes, idf)).toBeGreaterThan(0);
    expect(lexicalNorm(q, items[1]!.lexemes, idf)).toBe(0);
    expect(lexicalNorm([], items[0]!.lexemes, idf)).toBe(0);
  });
  it('idf weighting: a rare query token counts more than a common one', () => {
    const items = [
      cand({ id: 'a', text: 'Pune home' }),
      cand({ id: 'b', text: 'Pune office' }),
      cand({ id: 'c', text: 'Pune gym Bruno' }),
    ];
    const idf = inverseDocumentFrequency(items);
    expect(idf('bruno')).toBeGreaterThan(idf('pune'));
    const q = tokenizeForSearch('Pune Bruno');
    expect(lexicalNorm(q, items[2]!.lexemes, idf)).toBe(1);
    expect(lexicalNorm(q, items[0]!.lexemes, idf)).toBeLessThan(0.5);
  });
  it('an old lexical match ranks ahead of non-matching pinned / preference / recent rows (T-RET-05)', () => {
    const filler = Array.from({ length: 60 }, (_, i) =>
      cand({
        id: `f${String(i).padStart(2, '0')}`,
        text: `unrelated preference number ${i}`,
        kind: 'preference',
        pinned: i < 5,
        reasons: ['pinned', 'always', 'recent'],
        updatedAt: new Date(NOW.getTime() - DAY),
      }),
    );
    const old = cand({
      id: 'zz-old',
      text: 'my dog is called Bruno',
      updatedAt: new Date(NOW.getTime() - 400 * DAY),
    });
    const ranked = rankMemories([...filler, old], tokenizeForSearch('what should Bruno eat'), NOW);
    expect(ranked.map((r) => r.id)).toContain('zz-old');
    expect(ranked[0]!.id).toBe('zz-old');
  });
  it('ties break deterministically by updatedAt DESC then id', () => {
    const a = cand({ id: 'b', text: 'tea', reasons: ['recent'] });
    const b = cand({ id: 'a', text: 'coffee', reasons: ['recent'] });
    expect(rankMemories([a, b], [], NOW).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('T-UNIT-09 effective status, budget, dedupe', () => {
  it('effectiveMemoryStatus truth table (most global reason wins)', () => {
    const rows: [boolean, 'standard' | 'ephemeral', boolean, boolean, string][] = [
      [false, 'standard', true, true, 'off_feature'],
      [false, 'ephemeral', false, false, 'off_feature'],
      [true, 'ephemeral', true, true, 'off_ephemeral'],
      [true, 'ephemeral', false, false, 'off_ephemeral'],
      [true, 'standard', false, true, 'off_thread'],
      [true, 'standard', false, false, 'off_thread'],
      [true, 'standard', true, false, 'off_consent'],
      [true, 'standard', true, true, 'on'],
    ];
    for (const [featureEnabled, threadMode, threadMemoryEnabled, consentEligible, want] of rows) {
      expect(
        effectiveMemoryStatus({ featureEnabled, threadMode, threadMemoryEnabled, consentEligible }),
      ).toBe(want);
    }
  });
  it('wire mapping omits the field when the feature is off', () => {
    expect(toWireMemoryStatus('off_feature')).toBeUndefined();
    expect(toWireMemoryStatus('off_consent')).toBe('off_consent');
    expect(MEMORY_DTO_STATUSES).toContain('off_feature');
  });
  it('new standard threads default on only with feature + consent', () => {
    expect(
      defaultThreadMemoryEnabled({
        featureEnabled: true,
        threadMode: 'standard',
        consentEligible: true,
      }),
    ).toBe(true);
    expect(
      defaultThreadMemoryEnabled({
        featureEnabled: true,
        threadMode: 'ephemeral',
        consentEligible: true,
      }),
    ).toBe(false);
    expect(
      defaultThreadMemoryEnabled({
        featureEnabled: false,
        threadMode: 'standard',
        consentEligible: true,
      }),
    ).toBe(false);
    expect(
      defaultThreadMemoryEnabled({
        featureEnabled: true,
        threadMode: 'standard',
        consentEligible: false,
      }),
    ).toBe(false);
  });
  it('budget: never more than 12 items or 2,000 characters; skips an oversize item', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ text: 'x'.repeat(100), i }));
    expect(applyBudget(many)).toHaveLength(MEMORY_LIMITS.contextBudgetItems);
    const big = [{ text: 'y'.repeat(1990) }, { text: 'z'.repeat(50) }, { text: 'w'.repeat(10) }];
    const out = applyBudget(big);
    expect(out.map((o) => o.text.length)).toEqual([1990, 10]);
    expect(out.reduce((n, o) => n + o.text.length, 0)).toBeLessThanOrEqual(2000);
    // An override is clamped to the wire ceiling (20); 20 × 100 chars still fits 2,000.
    expect(applyBudget(many, { maxItems: 99 })).toHaveLength(MEMORY_LIMITS.contextWireMaxItems);
  });
  it('budget: pinned items are always admitted when they fit', () => {
    const ranked = [
      ...Array.from({ length: 12 }, (_, i) => ({ text: `r${i}`, pinned: false })),
      { text: 'pinned-last', pinned: true },
    ];
    const out = applyBudget(ranked, {}, (x) => x.pinned);
    expect(out).toHaveLength(12);
    expect(out.map((o) => o.text)).toContain('pinned-last');
  });
  it('dedupe: one item per single-valued slot, no duplicate value keys; refs are opaque', () => {
    const items = [
      cand({ id: '1', text: 'I live in Pune', slot: 'home_city', reasons: ['lexical'] }),
      cand({ id: '2', text: 'I live in Delhi', slot: 'home_city', reasons: ['recent'] }),
      cand({ id: '3', text: 'tea', slot: 'drink_preference', valueKey: 'k' }),
      cand({ id: '4', text: 'tea again', slot: 'drink_preference', valueKey: 'k' }),
    ];
    const out = rankMemories(items, tokenizeForSearch('Pune'), NOW);
    expect(out.map((o) => o.id)).toEqual(['1', '3']);
    expect(out.map((o) => o.ref)).toEqual(['m1', 'm2']);
  });
  it('freshness: 0 for facts, decays for context, −1 for stale events', () => {
    expect(freshness(cand({ id: 'f', text: 'x', kind: 'fact' }), NOW)).toBe(0);
    const ctx = cand({
      id: 'c',
      text: 'x',
      kind: 'context',
      createdAt: new Date(NOW.getTime() - 10 * DAY),
      expiresAt: new Date(NOW.getTime() + 10 * DAY),
    });
    expect(freshness(ctx, NOW)).toBeCloseTo(0.5);
    const ev = cand({
      id: 'e',
      text: 'x',
      kind: 'event',
      eventDate: new Date(NOW.getTime() - 8 * DAY),
    });
    expect(freshness(ev, NOW)).toBe(-1);
  });
});

describe('vocabulary and workflow contracts', () => {
  it('slots are unique; no health-adjacent slot exists (D9)', () => {
    const names = MEMORY_SLOTS.map((s) => s.slot);
    expect(new Set(names).size).toBe(names.length);
    expect(names.some((n) => /allerg|medic|health|condition/.test(n))).toBe(false);
    expect(isSingleValuedSlot('home_city')).toBe(true);
    expect(isSingleValuedSlot('cuisine_like')).toBe(false);
  });
  it('V9 coerces unknown slots and kind mismatches to other', () => {
    expect(coerceSlot('home_city', 'fact')).toBe('home_city');
    expect(coerceSlot('home_city', 'event')).toBe('other');
    expect(coerceSlot('allergies', 'fact')).toBe('other');
  });
  it('workflow ids and internal paths', () => {
    expect(MEMORY_WORKFLOWS.EXTRACTION).toBe('memoryExtractionWorkflow');
    expect(memoryExtractionWorkflowId('m-1')).toBe('memory-extract:m-1');
    expect(memoryExtractionRequestId('j', 2)).toBe('memx_j_2');
    expect(INTERNAL_MEMORY_PATHS.runExtractionJob('j')).toBe(
      '/internal/v1/memory/extraction-jobs/j/run',
    );
    expect(INTERNAL_MEMORY_PATHS.abandonExtractionJob('j')).toBe(
      '/internal/v1/memory/extraction-jobs/j/abandon',
    );
  });
});

describe('validation order V1–V11', () => {
  const ok = {
    kind: 'preference',
    slot: 'diet',
    subject: 'self',
    source_span: "I'm vegetarian",
    value_text: "I'm vegetarian",
    explicit_request: true,
    sensitivity: 'none',
  };
  const ctx = { message: "Remember that I'm vegetarian", askBeforeSaving: false };
  it('accepts a verified explicit request as tier 1', () => {
    expect(validateCandidate(ok, ctx)).toMatchObject({
      accepted: true,
      tier: 1,
      slot: 'diet',
      expires: false,
    });
  });
  it('V1 rejects a malformed candidate', () => {
    expect(validateCandidate({ ...ok, kind: 'inference' }, ctx)).toMatchObject({ check: 'V1' });
    expect(validateCandidate({ ...ok, valid_until: 'tomorrow' }, ctx)).toMatchObject({
      check: 'V1',
    });
  });
  it('V4 rejects delimiter characters', () => {
    const m = 'Remember that I like {curly} braces';
    expect(
      validateCandidate(
        { ...ok, source_span: 'I like {curly} braces', value_text: 'I like {curly} braces' },
        { ...ctx, message: m },
      ),
    ).toMatchObject({ accepted: false, class: 'invalid', check: 'V4' });
  });
  it('V6 self-minor anywhere in the message rejects', () => {
    const m = "Remember that I'm vegetarian. I'm 15";
    expect(validateCandidate(ok, { ...ctx, message: m })).toMatchObject({
      class: 'minor',
      check: 'V6',
    });
  });
  it('V6 third-party child rejects; adult third party is tier 2 with label', () => {
    const m1 = 'Remember that my son loves cricket';
    const third = {
      ...ok,
      kind: 'fact',
      slot: 'contact_fact',
      subject: 'third_party',
      subject_label: 'son',
    };
    expect(
      validateCandidate(
        { ...third, source_span: 'my son loves cricket', value_text: 'my son loves cricket' },
        { ...ctx, message: m1 },
      ),
    ).toMatchObject({ class: 'minor' });
    const m2 = 'Remember that my wife loves cricket';
    expect(
      validateCandidate(
        {
          ...third,
          subject_label: 'wife',
          source_span: 'my wife loves cricket',
          value_text: 'my wife loves cricket',
        },
        { ...ctx, message: m2 },
      ),
    ).toMatchObject({ accepted: true, tier: 2, subjectLabel: 'wife', tier2Reason: 'third_party' });
  });
  it('V4 coerces an invalid label to contact and tier 2', () => {
    const m = 'Remember that my boss prefers morning meetings';
    expect(
      validateCandidate(
        {
          ...ok,
          kind: 'preference',
          slot: 'contact_fact',
          subject: 'third_party',
          subject_label: '<boss>',
          source_span: 'my boss prefers morning meetings',
          value_text: 'my boss prefers morning meetings',
        },
        { ...ctx, message: m },
      ),
    ).toMatchObject({
      accepted: true,
      tier: 2,
      subjectLabel: 'contact',
      tier2Reason: 'label_coerced',
    });
  });
  it('V7 sensitive span rejects with its category', () => {
    const m = 'Remember that I have diabetes';
    expect(
      validateCandidate(
        {
          ...ok,
          kind: 'fact',
          slot: 'other',
          source_span: 'I have diabetes',
          value_text: 'I have diabetes',
        },
        { ...ctx, message: m },
      ),
    ).toMatchObject({ accepted: false, class: 'sensitive', categories: ['health'] });
  });
  it('V8 the model label can only escalate', () => {
    expect(validateCandidate({ ...ok, sensitivity: 'sensitive' }, ctx)).toMatchObject({
      accepted: false,
      class: 'sensitive',
      check: 'V8',
    });
  });
  it('V9 context/event carry an expiry; V10 ask-before-saving forces tier 2', () => {
    const m = "Remember that I'm in Delhi this week";
    const c = {
      ...ok,
      kind: 'context',
      slot: 'current_trip',
      source_span: "I'm in Delhi this week",
      value_text: "I'm in Delhi this week",
      valid_until: '2026-11-30',
    };
    expect(validateCandidate(c, { ...ctx, message: m })).toMatchObject({
      tier: 1,
      expires: true,
      validUntil: '2026-11-30',
    });
    expect(validateCandidate(c, { message: m, askBeforeSaving: true })).toMatchObject({
      tier: 2,
      tier2Reason: 'ask_before_saving',
    });
  });
});
