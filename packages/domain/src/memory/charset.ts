/**
 * The ONE shared character policy for memory text (M-01; arch §2.4, §4.3, §7.3 V4).
 *
 * Disallowed: every Cc (C0/C1 controls incl. \t \r \n and U+0085), Zl (U+2028), Zp (U+2029),
 * every Cf format character EXCEPT U+200C ZWNJ and U+200D ZWJ (needed in Devanagari conjuncts) —
 * i.e. bidi overrides/isolates, zero-width space, word joiner, BOM, soft hyphen — plus the
 * delimiter set < > ` { }. Lone surrogates are also rejected (they cannot be stored as UTF-8).
 *
 * The categories come from PINNED tables (`unicode-tables.ts`, Unicode MEMORY_UNICODE_VERSION),
 * not from the runtime's `\p{…}` support, so the TS policy, the generated PostgreSQL classes and
 * the reviewed migration agree on every Node/ICU version. Parity is tested over every BMP code point.
 */
import { LABEL_FIRST_RANGES, LABEL_REST_RANGES, TEXT_DISALLOWED_RANGES } from './unicode-tables.js';

export const MEMORY_TEXT_MAX_CHARS = 280;
export const MEMORY_LABEL_MAX_CHARS = 40;

type Ranges = ReadonlyArray<readonly [number, number]>;

function decode(table: string): Ranges {
  return table.split(',').map((part) => {
    const [a, b] = part.split('-');
    const lo = parseInt(a!, 16);
    return [lo, b === undefined ? lo : parseInt(b, 16)] as const;
  });
}

const TEXT_DISALLOWED = decode(TEXT_DISALLOWED_RANGES);
const LABEL_FIRST = decode(LABEL_FIRST_RANGES);
const LABEL_REST = decode(LABEL_REST_RANGES);

/** Binary search over sorted, non-overlapping inclusive ranges. */
function inRanges(ranges: Ranges, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** True when a single code point is allowed in memory text. */
export function isMemoryCodePointAllowed(cp: number): boolean {
  if (cp >= 0xd800 && cp <= 0xdfff) return false; // surrogates
  if (cp === 0) return false;
  return !inRanges(TEXT_DISALLOWED, cp);
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
export function isMemoryLabelAllowed(label: string): boolean {
  const cps = [...label].map((c) => c.codePointAt(0)!);
  if (cps.length < 1 || cps.length > MEMORY_LABEL_MAX_CHARS) return false;
  if (!inRanges(LABEL_FIRST, cps[0]!)) return false;
  return cps.slice(1).every((cp) => inRanges(LABEL_REST, cp));
}

/** Inclusive code-point ranges that are DISALLOWED, over U+0001…U+10FFFF (surrogates excluded). */
export function disallowedCodePointRanges(): Array<[number, number]> {
  return TEXT_DISALLOWED.map(([a, b]) => [a, b]);
}

function pgEscape(cp: number): string {
  return cp <= 0xffff
    ? `\\u${cp.toString(16).padStart(4, '0')}`
    : `\\U${cp.toString(16).padStart(8, '0')}`;
}

function pgClass(ranges: Ranges): string {
  return `[${ranges.map(([a, b]) => (a === b ? pgEscape(a) : `${pgEscape(a)}-${pgEscape(b)}`)).join('')}]`;
}

/**
 * PostgreSQL ARE bracket expression matching any disallowed code point. Used by the M2a
 * migration (`memory.text_allowed`). Generated, never hand-edited; parity-tested.
 */
export function memoryTextSqlCharClass(): string {
  return pgClass(TEXT_DISALLOWED);
}

/** Full SQL CHECK expression for a text column (length in code points + character class). */
export function memoryTextSqlCheck(column: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(column)) throw new Error('invalid column name');
  return (
    `(char_length(${column}) BETWEEN 1 AND ${MEMORY_TEXT_MAX_CHARS} ` +
    `AND btrim(${column}) <> '' AND ${column} !~ '${memoryTextSqlCharClass()}')`
  );
}

/**
 * PostgreSQL ARE anchored pattern equivalent to `isMemoryLabelAllowed` (PostgreSQL regexes have no
 * \p{L}, so letters and marks are explicit code-point classes). Generated; parity-tested.
 */
export function memoryLabelSqlPattern(): string {
  return `^${pgClass(LABEL_FIRST)}${pgClass(LABEL_REST)}{0,39}$`;
}
