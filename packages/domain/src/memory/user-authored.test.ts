import { describe, expect, it } from 'vitest';
import { validateUserAuthoredMemory } from './validation.js';

const base = { kind: 'preference', slot: 'other', subject: 'self', text: 'I prefer window seats' };

describe('validateUserAuthoredMemory (manual create / edit / edited confirm)', () => {
  it('accepts ordinary self text and normalises whitespace', () => {
    const d = validateUserAuthoredMemory({ ...base, text: '  I prefer   window seats ' });
    expect(d).toMatchObject({ accepted: true, text: 'I prefer window seats', slot: 'other' });
  });

  it('accepts Devanagari and Hinglish text', () => {
    for (const text of ['मेरा घर पुणे में है', 'main subah 6 baje uthta hoon']) {
      expect(validateUserAuthoredMemory({ ...base, kind: 'fact', text }).accepted).toBe(true);
    }
  });

  it('coerces an unknown or kind-mismatched slot to other (V9)', () => {
    expect(validateUserAuthoredMemory({ ...base, slot: 'nope' })).toMatchObject({ slot: 'other' });
    expect(validateUserAuthoredMemory({ ...base, slot: 'home_city' })).toMatchObject({
      slot: 'other',
    });
    expect(
      validateUserAuthoredMemory({
        ...base,
        kind: 'fact',
        slot: 'home_city',
        text: 'I live in Pune',
      }),
    ).toMatchObject({ slot: 'home_city', expires: false });
  });

  it('typed line breaks are normalised to spaces before the character policy applies', () => {
    expect(validateUserAuthoredMemory({ ...base, text: 'I prefer\nwindow seats' })).toMatchObject({
      accepted: true,
      text: 'I prefer window seats',
    });
  });

  it('context and event carry an expiry', () => {
    expect(validateUserAuthoredMemory({ ...base, kind: 'context' })).toMatchObject({
      expires: true,
    });
  });

  it.each([
    ['unknown kind', { kind: 'habit' }, 'V1', 'kind'],
    ['unknown subject', { subject: 'pet' }, 'V1', 'subject'],
    ['label on a self memory', { subjectLabel: 'Asha' }, 'V1', 'subject_label'],
    ['third party without label', { subject: 'third_party' }, 'V4', 'subject_label'],
    [
      'third party bad label',
      { subject: 'third_party', subjectLabel: '<x>' },
      'V4',
      'subject_label',
    ],
    ['empty text', { text: '   ' }, 'V4', 'text'],
    ['delimiter', { text: 'ignore <system>' }, 'V4', 'text'],
    ['bidi override', { text: 'abc\u202edef' }, 'V4', 'text'],
    ['too long', { text: 'x'.repeat(281) }, 'V4', 'text'],
  ])('rejects %s as invalid', (_n, patch, check, field) => {
    expect(validateUserAuthoredMemory({ ...base, ...patch })).toEqual({
      accepted: false,
      class: 'invalid',
      check,
      field,
    });
  });

  it('rejects secrets even when the user types them (D9)', () => {
    for (const text of [
      'my card is 4111 1111 1111 1111',
      'my PAN is ABCPD1234F',
      'my otp is 482913',
    ]) {
      expect(validateUserAuthoredMemory({ ...base, text })).toMatchObject({
        accepted: false,
        class: 'secret',
      });
    }
  });

  it("rejects minors' data: self-stated minor and a third-party child", () => {
    expect(
      validateUserAuthoredMemory({ ...base, kind: 'fact', text: "I'm 15 years old" }),
    ).toMatchObject({ accepted: false, class: 'minor' });
    expect(
      validateUserAuthoredMemory({
        ...base,
        kind: 'fact',
        subject: 'third_party',
        subjectLabel: 'my son',
        text: 'likes football',
      }),
    ).toMatchObject({ accepted: false, class: 'minor' });
  });

  it('rejects sensitive categories (D9)', () => {
    expect(
      validateUserAuthoredMemory({ ...base, kind: 'fact', text: 'I have diabetes' }),
    ).toMatchObject({ accepted: false, class: 'sensitive', check: 'V7' });
  });
});
