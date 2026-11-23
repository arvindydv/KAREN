/**
 * The ONE shared character policy for memory text (M-01; arch §2.4, §4.3, §7.3 V4).
 *
 * Disallowed: every \p{Cc} (C0/C1 controls incl. \t \r \n and U+0085), \p{Zl} (U+2028),
 * \p{Zp} (U+2029), every \p{Cf} format character EXCEPT U+200C ZWNJ and U+200D ZWJ (needed in
 * Devanagari conjuncts) — i.e. bidi overrides/isolates, zero-width space, word joiner, BOM, soft
 * hyphen — plus the delimiter set < > ` { }. Lone surrogates are also rejected (they cannot be
 * stored as UTF-8 text). The same policy is emitted as an explicit code-point class for the
 * database CHECK (`memoryTextSqlCharClass`) and mirrored in Python (M4a); parity is tested.
 */

export const MEMORY_TEXT_MAX_CHARS = 280;
export const MEMORY_LABEL_MAX_CHARS = 40;

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const DELIMITERS = new Set([0x3c, 0x3e, 0x60, 0x7b, 0x7d]); // < > ` { }
const CONTROL_OR_FORMAT = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]$/u;

/** True when a single code point is allowed in memory text. */
export function isMemoryCodePointAllowed(cp: number): boolean {
  if (cp === ZWNJ || cp === ZWJ) return true;
  if (DELIMITERS.has(cp)) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false; // surrogates
  return !CONTROL_OR_FORMAT.test(String.fromCodePoint(cp));
}

/** Length in code points (matches PostgreSQL `char_length`). */
export function memoryTextLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** First disallowed code point, or null. Iterates code points, so lone surrogates are seen. */
export function firstDisallowedCodePoint(text: string): number | null {
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (!isMemoryCodePointAllowed(cp)) return cp;
    if (cp > 0xffff) i++;
  }
  return null;
}

/** Memory text rule: 1–280 code points, not blank, every code point allowed. */
export function isMemoryTextAllowed(text: string): boolean {
  if (text.trim().length === 0) return false;
  if (memoryTextLength(text) > MEMORY_TEXT_MAX_CHARS) return false;
  return firstDisallowedCodePoint(text) === null;
}

/**
 * Subject label rule (arch §2.4, §4.3): starts with a letter; letters, marks, space, apostrophe
 * (' and ’), period, hyphen; 1–40 characters.
 */
const LABEL_RE = /^\p{L}[\p{L}\p{M} '’.-]{0,39}$/u;
export function isMemoryLabelAllowed(label: string): boolean {
  return LABEL_RE.test(label);
}

/** Inclusive code-point ranges that are DISALLOWED, over U+0001…U+10FFFF (surrogates excluded). */
export function disallowedCodePointRanges(): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let cp = 1; cp <= 0x10ffff; cp++) {
    if (cp === 0xd800) {
      // PostgreSQL text cannot contain surrogates; close any open range and skip the block.
      if (start !== -1) ranges.push([start, cp - 1]);
      start = -1;
      cp = 0xdfff;
      continue;
    }
    const bad = !isMemoryCodePointAllowed(cp);
    if (bad && start === -1) start = cp;
    if (!bad && start !== -1) {
      ranges.push([start, cp - 1]);
      start = -1;
    }
  }
  if (start !== -1) ranges.push([start, 0x10ffff]);
  return ranges;
}

function pgEscape(cp: number): string {
  return cp <= 0xffff
    ? `\\u${cp.toString(16).padStart(4, '0')}`
    : `\\U${cp.toString(16).padStart(8, '0')}`;
}

/**
 * PostgreSQL ARE bracket expression matching any disallowed code point. Used by the M2a
 * migration as `CHECK (col !~ '<class>')`. Generated, never hand-edited; parity-tested.
 */
export function memoryTextSqlCharClass(): string {
  const parts = disallowedCodePointRanges().map(([a, b]) =>
    a === b ? pgEscape(a) : `${pgEscape(a)}-${pgEscape(b)}`,
  );
  return `[${parts.join('')}]`;
}

/** Full SQL CHECK expression for a text column (length in code points + character class). */
export function memoryTextSqlCheck(column: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(column)) throw new Error('invalid column name');
  return (
    `(char_length(${column}) BETWEEN 1 AND ${MEMORY_TEXT_MAX_CHARS} ` +
    `AND btrim(${column}) <> '' AND ${column} !~ '${memoryTextSqlCharClass()}')`
  );
}
