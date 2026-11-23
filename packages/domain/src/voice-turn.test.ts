import { describe, expect, it } from 'vitest';
import {
  isLikelyEcho,
  isStopCommand,
  isUsableQuestion,
  matchWakePhrase,
  shouldInterrupt,
  stripLeadingWakeWords,
  words,
} from './voice-turn.js';

const SPOKEN =
  'Kal subah office jaane se pehle ye 3 kaam kar sakte ho: raat ko kapde tayyar rakho, paani piyo.';

describe('echo + barge-in guard', () => {
  it('tokenises Latin and Devanagari, dropping punctuation', () => {
    expect(words('Hello, KAREN! नमस्ते—रुको.')).toEqual(['hello', 'karen', 'नमस्ते', 'रुको']);
  });

  it('treats fragments of what KAREN is saying as echo', () => {
    expect(isLikelyEcho('office jaane se pehle', SPOKEN)).toBe(true);
    expect(isLikelyEcho('ye teen kaam kar sakte ho', SPOKEN)).toBe(true);
    expect(isLikelyEcho('what about the weather tomorrow', SPOKEN)).toBe(false);
    expect(isLikelyEcho('office jaane se pehle', null)).toBe(false);
  });

  it('interrupts on two new words or a stop word, never on echo or noise', () => {
    expect(shouldInterrupt('', SPOKEN)).toBe(false);
    expect(shouldInterrupt('hmm', SPOKEN)).toBe(false);
    expect(shouldInterrupt('office jaane', SPOKEN)).toBe(false);
    expect(shouldInterrupt('no wait', SPOKEN)).toBe(true);
    expect(shouldInterrupt('रुको', null)).toBe(true);
  });

  it('a stop word KAREN herself says is not a stop command', () => {
    expect(isStopCommand('ruko', null)).toBe(true);
    expect(isStopCommand('bas itna hi', 'Bas itna hi, aur kuch?')).toBe(false);
    expect(isStopCommand('please continue', null)).toBe(false);
  });
});

describe('wake phrase', () => {
  it.each([
    ['Hey KAREN', ''],
    ['hey karen', ''],
    ['Hey, Karen.', ''],
    ['ok Karan', ''],
    ['Hi Kiran what is the time', 'what is the time'],
    ['heykaren kal ka plan batao', 'kal ka plan batao'],
    ['हे करेन मुझे कल की याद दिलाओ', 'मुझे कल की याद दिलाओ'],
    ['so umm hey Karen, book nothing just tell me a joke', 'book nothing just tell me a joke'],
  ])('wakes on %j', (said, rest) => {
    expect(matchWakePhrase(said)).toEqual({ rest });
  });

  it.each([
    'Karan is coming tomorrow',
    'I told Karen about it',
    'hey there',
    '',
    'they caring for her',
  ])('does not wake on %j', (said) => {
    expect(matchWakePhrase(said)).toBeNull();
  });

  it('needs at least two words for a same-breath question', () => {
    expect(isUsableQuestion('time')).toBe(false);
    expect(isUsableQuestion('what time')).toBe(true);
  });
});

describe('stripLeadingWakeWords', () => {
  it('drops the wake phrase tail at the start of a turn', () => {
    expect(stripLeadingWakeWords('Karen')).toBe('');
    expect(stripLeadingWakeWords('hey karen')).toBe('');
    expect(stripLeadingWakeWords('Karen, what is the time?')).toBe('what is the time?');
    expect(stripLeadingWakeWords('करेन कल का मौसम')).toBe('कल का मौसम');
  });

  it('keeps normal sentences', () => {
    expect(stripLeadingWakeWords('hello, how are you')).toBe('hello, how are you');
    expect(stripLeadingWakeWords('call Karan tomorrow')).toBe('call Karan tomorrow');
    expect(stripLeadingWakeWords('what is the time')).toBe('what is the time');
  });
});
