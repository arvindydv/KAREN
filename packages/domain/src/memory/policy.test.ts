/**
 * T-UNIT-05 (tier-1 rule, H1) and T-UNIT-06 (clause splitter), EN / HI-Devanagari / Hinglish.
 */
import { describe, expect, it } from 'vitest';
import { decideTier1, splitClauses, type Tier1Failure } from './policy.js';

const tier = (message: string, span: string) =>
  decideTier1({ message, span, subject: 'self', askBeforeSaving: false, modelExplicit: true });

const expectTier1 = (message: string, span: string) =>
  expect(tier(message, span), message).toEqual({ tier1: true });
const expectTier2 = (message: string, span: string, failure?: Tier1Failure) => {
  const d = tier(message, span);
  expect(d.tier1, message).toBe(false);
  if (failure && !d.tier1) expect(d.failure, message).toBe(failure);
};

describe('T-UNIT-06 clause splitter', () => {
  it('splits on sentence punctuation incl. danda, newline and semicolon', () => {
    expect(splitClauses('Remember to call mom. Also I hate cilantro')).toEqual([
      'Remember to call mom',
      'I hate cilantro',
    ]);
    expect(splitClauses('माँ को फ़ोन करना। मैं शाकाहारी हूँ॥ ठीक')).toEqual([
      'माँ को फ़ोन करना',
      'मैं शाकाहारी हूँ',
      'ठीक',
    ]);
    expect(splitClauses('first line\nsecond line; third')).toEqual([
      'first line',
      'second line',
      'third',
    ]);
  });
  it('splits on connectors (also, but, aur, lekin, par, और, लेकिन, पर)', () => {
    expect(splitClauses('I like tea but I hate coffee')).toEqual(['I like tea', 'I hate coffee']);
    expect(splitClauses('chai pasand hai lekin coffee nahi')).toEqual([
      'chai pasand hai',
      'coffee nahi',
    ]);
    expect(splitClauses('मुझे चाय पसंद है लेकिन कॉफ़ी नहीं')).toEqual(['मुझे चाय पसंद है', 'कॉफ़ी नहीं']);
    expect(splitClauses('remember the cab and also I am in Delhi')).toEqual([
      'remember the cab',
      'I am in Delhi',
    ]);
  });
  it('does not split a decimal number', () => {
    expect(splitClauses('my flight is at 6.30 tomorrow')).toEqual([
      'my flight is at 6.30 tomorrow',
    ]);
  });
});

describe('T-UNIT-05 tier-1 rule — explicit requests (tier 1)', () => {
  const cases: [string, string][] = [
    ["Remember that I'm vegetarian", "I'm vegetarian"],
    ["I'm vegetarian, remember that", "I'm vegetarian"],
    ['Please remember I prefer window seats', 'I prefer window seats'],
    ["Don't forget that I wake up at 6 am", 'I wake up at 6 am'],
    ['Note that I always fly IndiGo', 'I always fly IndiGo'],
    ['Keep in mind that I live in Pune', 'I live in Pune'],
    ["Remember that I don't eat onions", "I don't eat onions"],
    ["I don't eat onions, remember that", "I don't eat onions"],
    ['याद रखना कि मैं शाकाहारी हूँ', 'मैं शाकाहारी हूँ'],
    ['मैं पुणे में रहता हूँ, याद रखना', 'मैं पुणे में रहता हूँ'],
    ['ये याद रखो कि मुझे चाय पसंद है', 'मुझे चाय पसंद है'],
    ['ध्यान रखना कि मैं सुबह 6 बजे उठता हूँ', 'मैं सुबह 6 बजे उठता हूँ'],
    ['yaad rakhna ki main shakahari hoon', 'main shakahari hoon'],
    ['main Pune mein rehta hoon, yaad rakhna', 'main Pune mein rehta hoon'],
    ['ye yaad rakh lo ki mujhe window seat pasand hai', 'mujhe window seat pasand hai'],
    ['yaad rakhna ki main weekend par cricket khelta hoon', 'main weekend par cricket khelta hoon'],
  ];
  for (const [m, s] of cases) it(m, () => expectTier1(m, s));
});

describe('T-UNIT-05 tier-1 rule — near-misses (tier 2)', () => {
  it('multi-clause: the trigger is in another clause', () => {
    expectTier2(
      'Remember to call mom. Also I hate cilantro',
      'I hate cilantro',
      'no_trigger_in_clause',
    );
    expectTier2('माँ को फ़ोन करना याद रखना। और मुझे धनिया पसंद नहीं', 'मुझे धनिया पसंद नहीं');
    expectTier2(
      'mummy ko call karna yaad rakhna. aur mujhe dhaniya pasand nahi',
      'mujhe dhaniya pasand nahi',
    );
    expectTier2('Please remember my cab; I am in Delhi this week', 'I am in Delhi this week');
  });
  it('negation scoping the trigger', () => {
    expectTier2("You don't need to remember this, but I'm in Delhi", "I'm in Delhi");
    expectTier2("No need to remember it: I'm in Delhi", "I'm in Delhi", 'negated');
    expectTier2('Do not remember that I live in Pune', 'I live in Pune', 'negated');
    expectTier2('याद रखने की ज़रूरत नहीं, मैं दिल्ली में हूँ', 'मैं दिल्ली में हूँ', 'negated');
    expectTier2(
      'yaad rakhne ki zarurat nahi, main Delhi mein hoon',
      'main Delhi mein hoon',
      'negated',
    );
    expectTier2('ye yaad mat rakhna, main Delhi mein hoon', 'main Delhi mein hoon');
    expectTier2('ये याद मत रखना, मैं दिल्ली में हूँ', 'मैं दिल्ली में हूँ');
  });
  it('questions', () => {
    expectTier2("do you remember I'm vegetarian?", "I'm vegetarian", 'question');
    expectTier2('Remember when I said I live in Pune?', 'I live in Pune', 'question');
    expectTier2('Do you remember that I prefer tea', 'I prefer tea', 'question');
    expectTier2('क्या तुम्हें याद है कि मैं शाकाहारी हूँ?', 'मैं शाकाहारी हूँ');
    expectTier2('kya yaad rakhoge ki main shakahari hoon?', 'main shakahari hoon', 'question');
    expectTier2('yaad hai na main Pune mein rehta hoon?', 'main Pune mein rehta hoon');
  });
  it('remind me is not remember', () => {
    expectTier2("remind me that I'm in Delhi", "I'm in Delhi");
    expectTier2('Please remember to remind me that I am in Delhi', 'I am in Delhi', 'reminder');
    expectTier2('mujhe yaad dilana ki main Delhi mein hoon', 'main Delhi mein hoon');
    expectTier2('मुझे याद दिलाना कि मैं दिल्ली में हूँ', 'मैं दिल्ली में हूँ');
  });
  it('a statement without any trigger', () => {
    expectTier2("By the way, I'm vegetarian.", "I'm vegetarian", 'no_trigger_in_clause');
    expectTier2('waise, main shakahari hoon', 'main shakahari hoon', 'no_trigger_in_clause');
  });
  it('the trigger word inside the span does not count', () => {
    expectTier2('I remember everything about Pune', 'I remember everything about Pune');
  });
  it('condition 5: subject, ask-before-saving and the model flag are all required', () => {
    const m = "Remember that I'm vegetarian";
    const s = "I'm vegetarian";
    const base = {
      message: m,
      span: s,
      subject: 'self' as const,
      askBeforeSaving: false,
      modelExplicit: true,
    };
    expect(decideTier1(base)).toEqual({ tier1: true });
    expect(decideTier1({ ...base, subject: 'third_party' })).toEqual({
      tier1: false,
      failure: 'third_party',
    });
    expect(decideTier1({ ...base, askBeforeSaving: true })).toEqual({
      tier1: false,
      failure: 'ask_before_saving',
    });
    expect(decideTier1({ ...base, modelExplicit: false })).toEqual({
      tier1: false,
      failure: 'model_flag_false',
    });
    expect(decideTier1({ ...base, span: 'not in the message' })).toEqual({
      tier1: false,
      failure: 'span_not_found',
    });
  });
});
