import { describe, expect, it } from 'vitest';
import { validateCandidate } from './validation.js';

/**
 * Regression (found in M5b): a model's `source_span` naturally includes the trigger phrase. The
 * tier-1 rule must locate the stored VALUE, so such candidates are tier 1 — while every H1
 * protection (clause, negation, question, reminder) still demotes the near-misses.
 */
const cand = (span: string, value: string) => ({
  kind: 'preference',
  slot: 'other',
  subject: 'self',
  source_span: span,
  value_text: value,
  explicit_request: true,
  sensitivity: 'none',
});
const tier = (message: string, span: string, value: string) => {
  const d = validateCandidate(cand(span, value), { message, askBeforeSaving: false });
  return d.accepted ? d.tier : 'rejected';
};

describe('tier-1 with the trigger inside source_span', () => {
  it.each([
    ["Remember that I'm vegetarian", "Remember that I'm vegetarian", "I'm vegetarian"],
    [
      'yaad rakhna main vegetarian hoon',
      'yaad rakhna main vegetarian hoon',
      'main vegetarian hoon',
    ],
    ['याद रखना मेरा घर पुणे में है', 'याद रखना मेरा घर पुणे में है', 'मेरा घर पुणे में है'],
    ["I'm vegetarian, yaad rakhna", "I'm vegetarian, yaad rakhna", "I'm vegetarian"],
  ])('%s → tier 1', (m, s, v) => {
    expect(tier(m, s, v)).toBe(1);
  });

  it.each([
    ["don't remember that I'm vegetarian", "don't remember that I'm vegetarian", "I'm vegetarian"],
    [
      "do you remember that I'm vegetarian?",
      "do you remember that I'm vegetarian",
      "I'm vegetarian",
    ],
    ["remind me that I'm in Delhi", "remind me that I'm in Delhi", "I'm in Delhi"],
    ['Remember to call mom. Also I hate cilantro', 'I hate cilantro', 'I hate cilantro'],
    [
      'yaad mat rakhna main vegetarian hoon',
      'yaad mat rakhna main vegetarian hoon',
      'main vegetarian hoon',
    ],
  ])('%s → tier 2', (m, s, v) => {
    expect(tier(m, s, v)).toBe(2);
  });
});
