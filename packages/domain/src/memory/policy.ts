/**
 * Deterministic write policy (arch §7.3): clause splitter, tier-1 rule (V10, H1), minors (V6) and
 * sensitive categories (V7). Pure functions; the model's flags are advisory only.
 */
import {
  CHILD_TERMS,
  CONNECTORS,
  INTERROGATIVES,
  INTERROGATIVE_STARTERS,
  NEGATIONS,
  REMINDERS,
  SENSITIVE_CATEGORIES,
  SENSITIVE_LEXICON,
  TRIGGERS,
  findPhrases,
  tokensOf,
  type PhraseHit,
  type SensitiveCategory,
} from './lexicons.js';
import { matchTokens, normaliseWhitespace, offsetTokens, type OffsetToken } from './normalise.js';

// ------------------------------------------------------------------------------------------
// Clause splitting (rule 1)
// ------------------------------------------------------------------------------------------

/**
 * Clause text: NFC; whitespace runs containing a newline become '\n' (a boundary), all other runs
 * a single space; trimmed. Offsets returned by the functions below refer to this string.
 */
export function clauseText(message: string): string {
  return message
    .normalize('NFC')
    .replace(/\s+/gu, (ws) => (ws.includes('\n') ? '\n' : ' '))
    .trim();
}

const BOUNDARY_CHARS = new Set(['.', '!', '?', '।', '॥', ';', '\n']);

export interface ClauseBoundary {
  /** Offset of the boundary (the punctuation char, or the connector's first char). */
  readonly at: number;
  /** End offset of the boundary marker. */
  readonly end: number;
  readonly char: string;
}

/** Sentence punctuation (not a '.' inside a number) and connector words, in offset order. */
export function clauseBoundaries(text: string, tokens = offsetTokens(text)): ClauseBoundary[] {
  const out: ClauseBoundary[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (!BOUNDARY_CHARS.has(ch)) continue;
    if (ch === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;
    out.push({ at: i, end: i + 1, char: ch });
  }
  for (const hit of findPhrases(tokensOf(tokens), CONNECTORS)) {
    out.push({ at: tokens[hit.from]!.start, end: tokens[hit.to - 1]!.end, char: '' });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Split into clause strings (trimmed, non-empty). Exposed for tests and the mock extractor. */
export function splitClauses(message: string): string[] {
  const text = clauseText(message);
  const bounds = clauseBoundaries(text);
  const out: string[] = [];
  let from = 0;
  for (const b of bounds) {
    out.push(text.slice(from, b.at));
    from = b.end;
  }
  out.push(text.slice(from));
  return out.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// ------------------------------------------------------------------------------------------
// Tier-1 rule (V10, H1)
// ------------------------------------------------------------------------------------------

export type Tier1Failure =
  | 'third_party'
  | 'ask_before_saving'
  | 'model_flag_false'
  | 'span_not_found'
  | 'no_trigger_in_clause'
  | 'negated'
  | 'question'
  | 'reminder';

export interface Tier1Input {
  message: string;
  /** Verified source span (already passed V2). */
  span: string;
  subject: 'self' | 'third_party';
  askBeforeSaving: boolean;
  /** The model's `explicit_request` flag — necessary, never sufficient. */
  modelExplicit: boolean;
}

export type Tier1Decision = { tier1: true } | { tier1: false; failure: Tier1Failure };

const NEGATION_WINDOW_AFTER_TRIGGER = 3;

function overlaps(a: PhraseHit, from: number, to: number): boolean {
  return a.from < to && from < a.to;
}

/**
 * Decide whether a candidate may be stored without confirmation. Every condition is required;
 * any failure → tier 2 (a suggestion), never a rejection. The most specific failure for the best
 * trigger is reported (for tests and content-free metrics).
 */
export function decideTier1(input: Tier1Input): Tier1Decision {
  if (input.subject !== 'self') return { tier1: false, failure: 'third_party' };
  if (input.askBeforeSaving) return { tier1: false, failure: 'ask_before_saving' };
  if (!input.modelExplicit) return { tier1: false, failure: 'model_flag_false' };

  const text = clauseText(input.message);
  const span = normaliseWhitespace(input.span);
  const spanStart = span.length > 0 ? text.indexOf(span) : -1;
  if (spanStart < 0) return { tier1: false, failure: 'span_not_found' };
  const spanEnd = spanStart + span.length;

  const tokens = offsetTokens(text);
  const toks = tokensOf(tokens);
  const bounds = clauseBoundaries(text, tokens);
  // Token index range of the span.
  const sFrom = tokens.findIndex((t) => t.end > spanStart);
  const sToEx = tokens.findIndex((t) => t.start >= spanEnd);
  const spanTokFrom = sFrom < 0 ? tokens.length : sFrom;
  const spanTokTo = sToEx < 0 ? tokens.length : sToEx;

  const triggers = findPhrases(toks, TRIGGERS)
    // longest match first at each position; drop triggers inside the span (the span's own words)
    .filter((h) => !overlaps(h, spanTokFrom, spanTokTo));
  if (triggers.length === 0) return { tier1: false, failure: 'no_trigger_in_clause' };

  const negations = findPhrases(toks, NEGATIONS);
  const reminders = findPhrases(toks, REMINDERS);
  const interrogatives = findPhrases(toks, INTERROGATIVES);

  let best: Tier1Failure = 'no_trigger_in_clause';
  const rank: Tier1Failure[] = ['no_trigger_in_clause', 'reminder', 'question', 'negated'];

  for (const trig of triggers) {
    const tStart = tokens[trig.from]!.start;
    const tEnd = tokens[trig.to - 1]!.end;
    const lo = Math.min(tStart, spanStart);
    const hi = Math.max(tEnd, spanEnd);
    // Boundaries strictly between trigger and span (boundaries inside the span are ignored).
    const outsideSpan = bounds.filter((b) => b.end <= spanStart || b.at >= spanEnd);
    if (outsideSpan.some((b) => b.at >= lo && b.end <= hi)) continue; // different clause
    // Clause extent around trigger+span.
    const before = outsideSpan.filter((b) => b.end <= lo);
    const after = outsideSpan.filter((b) => b.at >= hi);
    const clauseFrom = before.length ? before[before.length - 1]!.end : 0;
    const clauseEndBoundary = after[0];
    const clauseTo = clauseEndBoundary ? clauseEndBoundary.at : text.length;
    const inClause = (h: PhraseHit) =>
      tokens[h.from]!.start >= clauseFrom && tokens[h.to - 1]!.end <= clauseTo;

    let failure: Tier1Failure | null = null;
    if (reminders.some(inClause)) failure = 'reminder';
    const clauseTokIdx = tokens.findIndex((t) => t.start >= clauseFrom);
    const startsAsQuestion =
      clauseTokIdx >= 0 &&
      findPhrases(toks.slice(clauseTokIdx), INTERROGATIVE_STARTERS).some((h) => h.from === 0);
    if (
      clauseEndBoundary?.char === '?' ||
      interrogatives.some(inClause) ||
      startsAsQuestion ||
      (!clauseEndBoundary && text.trimEnd().endsWith('?'))
    ) {
      failure = 'question';
    }
    const negated = negations.some(
      (n) =>
        inClause(n) &&
        !overlaps(n, trig.from, trig.to) &&
        !overlaps(n, spanTokFrom, spanTokTo) &&
        (n.to <= trig.from ||
          (n.from >= trig.to && n.from < trig.to + NEGATION_WINDOW_AFTER_TRIGGER)),
    );
    if (negated) failure = 'negated';
    if (failure === null) return { tier1: true };
    if (rank.indexOf(failure) > rank.indexOf(best)) best = failure;
  }
  return { tier1: false, failure: best };
}

// ------------------------------------------------------------------------------------------
// Minors (V6, M-10) — scope pending legal review (OD-07)
// ------------------------------------------------------------------------------------------

const WORD_AGES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
};
const HI_ORDINAL_CLASS: Record<string, number> = {
  पहली: 1,
  दूसरी: 2,
  तीसरी: 3,
  चौथी: 4,
  पांचवीं: 5,
  पाँचवीं: 5,
  छठी: 6,
  सातवीं: 7,
  आठवीं: 8,
  नौवीं: 9,
  नवीं: 9,
  दसवीं: 10,
  ग्यारहवीं: 11,
  बारहवीं: 12,
};

function minorText(message: string): string {
  return message
    .normalize('NFC')
    .replace(/[०-९]/gu, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[’`]/gu, "'")
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

const isMinorAge = (n: number) => n >= 1 && n < 18;
const isSchoolClass = (n: number) => n >= 1 && n <= 12;

const AGE_FOLLOW_OK =
  /^(?:$|[.,!?;:)]|\s*(?:years?|yrs?|year|yo|y\/o|and|now|this|next|saal|sal)\b|\s*$)/u;

/** V6b: the USER states an age under 18 or a school class/grade (whole message). */
export function selfStatesMinor(message: string): boolean {
  const t = minorText(message);
  // EN: "I'm 15", "I am 13 years old", "I just turned 17", "I'm a 14 year old student"
  for (const m of t.matchAll(
    /\b(?:i'm|im|i am|i just turned|i turned|i will be|i'll be)\s+(\d{1,2}|[a-z]+teen|[a-z]+)\b/gu,
  )) {
    const v = m[1]!;
    const n = /^\d+$/.test(v) ? Number(v) : WORD_AGES[v];
    if (n === undefined || !isMinorAge(n)) continue;
    if (AGE_FOLLOW_OK.test(t.slice(m.index + m[0].length))) return true;
  }
  for (const m of t.matchAll(
    /\b(?:i'm|im|i am)\s+an?\s+(\d{1,2})[- ]?(?:years?|yrs?)[- ]?old\b/gu,
  )) {
    if (isMinorAge(Number(m[1]))) return true;
  }
  for (const m of t.matchAll(/\bin\s+(?:class|grade|std\.?|standard)\s+(\d{1,2})\b/gu)) {
    if (isSchoolClass(Number(m[1]))) return true;
  }
  for (const m of t.matchAll(
    /\bin\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\s+(?:class|grade|standard|std)\b/gu,
  )) {
    if (isSchoolClass(Number(m[1]))) return true;
  }
  for (const m of t.matchAll(
    /\b(?:i'm|im|i am|i study|studying|i'm studying)\s+in\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/gu,
  )) {
    if (isSchoolClass(Number(m[1]))) return true;
  }
  // Hinglish: "main 15 saal ka hoon", "meri umar 14 saal hai", "class 9 mein hoon", "10th mein"
  for (const m of t.matchAll(
    /\b(?:main|mai|mein)\s+(\d{1,2})\s*(?:(?:saal|sal)\s*(?:ka|ki|ke)|(?:years?|yrs?)\s*old)\b/gu,
  )) {
    if (isMinorAge(Number(m[1]))) return true;
  }
  for (const m of t.matchAll(/\b(?:umar|umr|umra|age)\s+(\d{1,2})\b/gu)) {
    if (isMinorAge(Number(m[1]))) return true;
  }
  for (const m of t.matchAll(/\bclass\s+(\d{1,2})\s+(?:mein|me|mai|mei)\b/gu)) {
    if (isSchoolClass(Number(m[1]))) return true;
  }
  for (const m of t.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:class\s+|standard\s+|std\s+)?(?:mein|me|mai|mei)\b/gu,
  )) {
    if (isSchoolClass(Number(m[1]))) return true;
  }
  // Devanagari: "मैं 15 साल का हूँ", "मेरी उम्र 14 साल", "9वीं में", "दसवीं कक्षा में"
  for (const m of t.matchAll(/(?:मैं|मै)\s*(\d{1,2})\s*(?:साल|वर्ष)\s*(?:का|की|के)/gu)) {
    if (isMinorAge(Number(m[1]))) return true;
  }
  for (const m of t.matchAll(/(?:उम्र|उमर|आयु)\s*(\d{1,2})/gu)) {
    if (isMinorAge(Number(m[1]))) return true;
  }
  for (const m of t.matchAll(/(\d{1,2})\s*(?:वीं|वी|वें|वाँ|वां|ठी|री|ली)\s*(?:(?:कक्षा|क्लास)\s*)?में/gu)) {
    if (isSchoolClass(Number(m[1]))) return true;
  }
  for (const [word, n] of Object.entries(HI_ORDINAL_CLASS)) {
    if (new RegExp(`${word}\\s*(?:(?:कक्षा|क्लास)\\s*)?में`, 'u').test(t) && isSchoolClass(n)) {
      return true;
    }
  }
  return false;
}

/** V6a: a third-party statement about a child (child term or an age under 18). */
export function mentionsChild(text: string, label?: string | null): boolean {
  for (const s of [text, label ?? '']) {
    if (!s) continue;
    if (findPhrases(matchTokens(s), CHILD_TERMS).length > 0) return true;
    const t = minorText(s);
    for (const m of t.matchAll(/(\d{1,2})[- ]?(?:years?|yrs?|year)[- ]?old\b/gu)) {
      if (isMinorAge(Number(m[1]))) return true;
    }
    for (const m of t.matchAll(/(\d{1,2})\s*(?:saal|sal|साल|वर्ष)\s*(?:ka|ki|ke|का|की|के)/gu)) {
      if (isMinorAge(Number(m[1]))) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------------------------------
// Sensitive categories (V7) — pending legal review (LEG-3)
// ------------------------------------------------------------------------------------------

/** Categories detected in a span (stable order). Empty = none. */
export function detectSensitive(text: string): SensitiveCategory[] {
  const toks = matchTokens(text);
  return SENSITIVE_CATEGORIES.filter((c) => findPhrases(toks, SENSITIVE_LEXICON[c]).length > 0);
}

export type { OffsetToken };
