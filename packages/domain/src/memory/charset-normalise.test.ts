/**
 * T-UNIT-03 (character policy parity), T-UNIT-04 (span/value checks), T-UNIT-07 (normaliser).
 */
import { describe, expect, it } from 'vitest';
import { MEMORY_UNICODE_VERSION } from './unicode-tables.js';
import {
  disallowedCodePointRanges,
  firstDisallowedCodePoint,
  isMemoryCodePointAllowed,
  isMemoryLabelAllowed,
  isMemoryTextAllowed,
  memoryTextSqlCharClass,
  memoryTextSqlCheck,
} from './charset.js';
import {
  MEMORY_TOKENIZER_VERSION,
  memoryValueKeyMaterial,
  normaliseMemoryValue,
  tokenizeForSearch,
} from './normalise.js';
import { validateCandidate } from './validation.js';

/** Parse the generated PostgreSQL bracket class back into inclusive ranges. */
function parseSqlClass(cls: string): Array<[number, number]> {
  expect(cls.startsWith('[') && cls.endsWith(']')).toBe(true);
  const body = cls.slice(1, -1);
  const re = /\\(?:u([0-9a-f]{4})|U([0-9a-f]{8}))(?:-\\(?:u([0-9a-f]{4})|U([0-9a-f]{8})))?/g;
  const out: Array<[number, number]> = [];
  let consumed = 0;
  for (const m of body.matchAll(re)) {
    expect(m.index).toBe(consumed); // nothing but escapes in the class
    consumed = m.index + m[0].length;
    const a = parseInt(m[1] ?? m[2]!, 16);
    const b = (m[3] ?? m[4]) ? parseInt(m[3] ?? m[4]!, 16) : a;
    out.push([a, b]);
  }
  expect(consumed).toBe(body.length);
  return out;
}

describe('T-UNIT-03 character policy', () => {
  it('uses pinned, sorted, non-overlapping Unicode tables (independent of the runtime ICU)', () => {
    expect(MEMORY_UNICODE_VERSION).toBe('16.0');
    const r = disallowedCodePointRanges();
    for (let i = 0; i < r.length; i++) {
      expect(r[i]![0]).toBeLessThanOrEqual(r[i]![1]);
      if (i > 0) expect(r[i]![0]).toBeGreaterThan(r[i - 1]![1] + 1);
    }
  });
  it('generated SQL class classifies every BMP code point exactly like the TS policy', () => {
    const ranges = parseSqlClass(memoryTextSqlCharClass());
    const inSql = (cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);
    let checked = 0;
    for (let cp = 1; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // not representable in PostgreSQL text
      expect(inSql(cp), `U+${cp.toString(16)}`).toBe(!isMemoryCodePointAllowed(cp));
      checked++;
    }
    expect(checked).toBe(0xffff - 0x800);
  });
  it('supplementary planes agree too (spot range walk)', () => {
    const ranges = disallowedCodePointRanges();
    for (let cp = 0x10000; cp <= 0x10ffff; cp += 97) {
      const inRanges = ranges.some(([a, b]) => cp >= a && cp <= b);
      expect(inRanges, `U+${cp.toString(16)}`).toBe(!isMemoryCodePointAllowed(cp));
    }
  });
  it('allows Devanagari with ZWNJ/ZWJ, Latin, digits, emoji', () => {
    for (const s of ['क्‍ष', 'क्‌ष', 'मैं शाकाहारी हूँ', "I'm vegetarian", '6 am', 'चाय ☕', '😀']) {
      expect(isMemoryTextAllowed(s), s).toBe(true);
    }
  });
  it('rejects controls, separators, bidi/format characters and delimiters', () => {
    const bad = [
      '\n',
      '\r',
      '\t',
      '\u0085',
      ' ',
      ' ',
      '‮',
      '⁦',
      '​',
      '⁠',
      '﻿',
      '­',
      '<',
      '>',
      '`',
      '{',
      '}',
      '\ud800',
    ];
    for (const ch of bad) {
      expect(isMemoryTextAllowed(`a${ch}b`), JSON.stringify(ch)).toBe(false);
      expect(firstDisallowedCodePoint(`a${ch}b`)).toBe(ch.codePointAt(0));
    }
  });
  it('length is in code points, 1–280, not blank', () => {
    expect(isMemoryTextAllowed('')).toBe(false);
    expect(isMemoryTextAllowed('   ')).toBe(false);
    expect(isMemoryTextAllowed('a'.repeat(280))).toBe(true);
    expect(isMemoryTextAllowed('a'.repeat(281))).toBe(false);
    expect(isMemoryTextAllowed('😀'.repeat(280))).toBe(true); // 560 UTF-16 units, 280 code points
  });
  it('label rule', () => {
    for (const ok of ['Ravi', "D'Souza", 'Anna-Marie', 'Dr. Rao', 'माँ', 'O’Brien']) {
      expect(isMemoryLabelAllowed(ok), ok).toBe(true);
    }
    for (const bad of ['', '1Ravi', 'Ravi<script>', 'x'.repeat(41), ' Ravi']) {
      expect(isMemoryLabelAllowed(bad), bad).toBe(false);
    }
  });
  it('SQL CHECK expression is well-formed and rejects bad column names', () => {
    expect(memoryTextSqlCheck('value_text')).toMatch(
      /^\(char_length\(value_text\) BETWEEN 1 AND 280 /,
    );
    expect(() => memoryTextSqlCheck('x; drop table')).toThrow();
  });
});

describe('T-UNIT-04 span/value checks', () => {
  const base = {
    kind: 'preference',
    slot: 'diet',
    subject: 'self',
    explicit_request: true,
    sensitivity: 'none',
  };
  const message = "Remember  that\nI'm vegetarian";
  it('value ⊆ span ⊆ message after NFC/whitespace normalisation', () => {
    const d = validateCandidate(
      { ...base, source_span: "that I'm vegetarian", value_text: "I'm vegetarian" },
      { message, askBeforeSaving: false },
    );
    expect(d).toMatchObject({ accepted: true, text: "I'm vegetarian" });
  });
  it('model-authored text (not in the message) is rejected as invalid', () => {
    expect(
      validateCandidate(
        { ...base, source_span: 'vegetarian diet', value_text: 'vegetarian diet' },
        { message, askBeforeSaving: false },
      ),
    ).toMatchObject({ accepted: false, class: 'invalid', check: 'V2' });
    expect(
      validateCandidate(
        { ...base, source_span: "I'm vegetarian", value_text: 'Vegetarian diet' },
        { message, askBeforeSaving: false },
      ),
    ).toMatchObject({ accepted: false, class: 'invalid', check: 'V3' });
  });
  it('NFC: a decomposed span matches a composed message', () => {
    const composed = 'Remember that I live in Malmö';
    const span = 'I live in Malmö';
    expect(
      validateCandidate(
        { ...base, kind: 'fact', slot: 'home_city', source_span: span, value_text: span },
        { message: composed, askBeforeSaving: false },
      ),
    ).toMatchObject({ accepted: true });
  });
});

describe('T-UNIT-07 normaliser / tokeniser', () => {
  it('is versioned', () => {
    expect(MEMORY_TOKENIZER_VERSION).toMatch(/^mt-\d+$/);
  });
  it('Hinglish spelling variants fold together', () => {
    const t = (s: string) => tokenizeForSearch(s);
    expect(t('khana')).toEqual(t('khaana'));
    expect(t('khane')).toEqual(t('khaana'));
    expect(t('shaadi')).toEqual(t('shadi'));
    expect(t('nahin')).toEqual(t('nahi'));
    expect(t('shakahari')).toEqual(t('shaakahaari'));
  });
  it('keeps Devanagari matras and chandrabindu; folds nukta and Devanagari digits', () => {
    expect(tokenizeForSearch('शाकाहारी')).toEqual(['शाकाहारी']);
    expect(tokenizeForSearch('हूँ बात')).toEqual(['बात']); // हूँ is a stop word
    expect(tokenizeForSearch('ज़रूरत')).toEqual(tokenizeForSearch('जरूरत'));
    expect(tokenizeForSearch('१२ बजे')).toEqual(tokenizeForSearch('12 बजे'));
  });
  it('drops stop words and punctuation, de-duplicates and sorts', () => {
    expect(tokenizeForSearch("What's the weather in Pune? Pune!")).toEqual(['pune', 'weather']);
    expect(tokenizeForSearch('main Pune mein rehta hoon')).toEqual(['pune', 'reht']);
  });
  it('caste keeps its final vowel (does not collide with cast)', () => {
    expect(tokenizeForSearch('caste')).not.toEqual(tokenizeForSearch('cast'));
  });
  it('value normalisation for dedupe', () => {
    expect(normaliseMemoryValue("  I'm   Vegetarian. ")).toBe("i'm vegetarian");
    expect(normaliseMemoryValue('मैं शाकाहारी हूँ।')).toBe('मैं शाकाहारी हूँ');
    expect(
      memoryValueKeyMaterial({
        kind: 'preference',
        slot: 'diet',
        subject: 'self',
        text: "I'm Vegetarian",
      }),
    ).toBe("preference|diet|self||i'm vegetarian");
  });
});
