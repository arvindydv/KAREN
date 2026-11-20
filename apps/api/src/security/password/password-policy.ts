import {
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
  type PasswordRejection,
} from '@karen/api-contracts';

/**
 * Password policy per NIST SP 800-63B-4 §3.1.1.2 (passwords as a single authentication factor):
 *  - ≥ 15 characters, ≥ 64 supported (we accept up to 256 code points);
 *  - all printable ASCII, space and Unicode accepted; NO composition rules;
 *  - Unicode normalized (NFKC) before hashing so the same password typed on different
 *    keyboards verifies; length counted in code points after normalization;
 *  - checked against commonly-used / expected / compromised values and context-specific
 *    words (service name, the user's own e-mail);
 *  - no periodic expiry (rotation only on evidence of compromise — handled elsewhere).
 *
 * LIMITATION (documented in docs/PHASE_01_PLAN.md): the bundled check catches common base
 * words, repetition, sequences and context words. A comprehensive breached-password corpus
 * (e.g. an offline Pwned Passwords dataset or the k-anonymity range API) is NOT yet wired in;
 * that needs a data-licensing / external-call decision.
 */

/** Stored with each hash so normalization can evolve without breaking existing credentials. */
export const PASSWORD_NORMALIZATION = 'nfkc-v1';

export type PasswordEvaluation =
  { ok: true; normalized: string } | { ok: false; reasons: PasswordRejection[] };

export interface PasswordContext {
  /** Canonical e-mail of the account; its local part is a context-specific word. */
  email?: string;
}

/** Normalization shared by registration, change and verification. Never log the result. */
export function normalizePassword(raw: string): string | null {
  // Lone surrogates have no stable normalization; refuse rather than hash garbage.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(raw)) {
    return null;
  }
  return raw.normalize('NFKC');
}

// Commonly used base words. Passwords whose letters reduce to concatenations of these (after
// removing digits, symbols and spaces) are rejected: "Password@12345678", "iloveyouiloveyou".
const COMMON_BASE_WORDS = [
  'password',
  'passw0rd',
  'pass',
  'iloveyou',
  'love',
  'qwerty',
  'asdf',
  'zxcv',
  'welcome',
  'letmein',
  'admin',
  'administrator',
  'login',
  'user',
  'monkey',
  'dragon',
  'master',
  'shadow',
  'football',
  'baseball',
  'cricket',
  'soccer',
  'sunshine',
  'princess',
  'superman',
  'batman',
  'trustno',
  'secret',
  'hello',
  'freedom',
  'whatever',
  'computer',
  'internet',
  'abc',
  'india',
  'bharat',
  'mumbai',
  'delhi',
  'bangalore',
  'hyderabad',
  'chennai',
  'kolkata',
  'pune',
  'krishna',
  'ganesh',
  'jaishreeram',
  'sairam',
  'omnamahshivaya',
  'changeme',
  'default',
  'test',
  'karen',
  'god',
  'jesus',
  'mother',
  'father',
  'family',
  'baby',
  'angel',
  'summer',
  'winter',
  'spring',
  'autumn',
  'january',
  'december',
  'qazwsx',
  'starwars',
  'pokemon',
  'naruto',
  'iphone',
  'samsung',
  'google',
  'facebook',
  'instagram',
  'whatsapp',
];
// Well-known long passphrases that appear in breach corpora and tutorials.
const COMMON_PHRASES = new Set([
  'correcthorsebatterystaple',
  'thequickbrownfoxjumpsoverthelazydog',
  'loremipsumdolorsitamet',
  'tobeornottobethatisthequestion',
  'maytheforcebewithyou',
  'onetwothreefourfivesix',
]);
const SEQUENCE_SOURCES = [
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  'qwertyuiopasdfghjklzxcvbnm',
  'qwertzuiopasdfghjklyxcvbnm',
  'azertyuiopqsdfghjklmwxcvbn',
  '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p',
  '!@#$%^&*()_+',
].flatMap((s) => {
  const repeated = s.repeat(4);
  return [repeated, [...repeated].reverse().join('')];
});

const SERVICE_WORDS = ['karen'];

/** True if `letters` is entirely a concatenation of words from `dictionary`. */
function isWordConcatenation(letters: string, dictionary: readonly string[]): boolean {
  if (letters.length === 0) return false;
  const reachable = new Array<boolean>(letters.length + 1).fill(false);
  reachable[0] = true;
  for (let i = 0; i < letters.length; i++) {
    if (!reachable[i]) continue;
    for (const word of dictionary) {
      if (letters.startsWith(word, i)) reachable[i + word.length] = true;
    }
  }
  return reachable[letters.length] === true;
}

function isRepetitiveOrSequential(compact: string): boolean {
  const codePoints = [...compact];
  if (new Set(codePoints).size <= 3) return true; // "aaaaaaaaaaaaaaab", "abababababababab"
  if (/^(.{1,6})\1+.{0,6}$/su.test(compact)) return true; // short unit repeated
  return SEQUENCE_SOURCES.some((source) => source.includes(compact));
}

/** Removes `words` from `text`; returns how many code points of other content remain. */
function residualAfterRemoving(text: string, words: readonly string[]): number {
  let residual = text;
  for (const w of words) if (w.length >= 3) residual = residual.split(w).join('');
  return [...residual.replace(/[^\p{L}\p{N}]/gu, '')].length;
}

/** Upper bound on raw input (UTF-16 units) before any normalization work is done. */
export const PASSWORD_RAW_MAX_UNITS = 1024;

export function evaluatePassword(raw: string, context: PasswordContext = {}): PasswordEvaluation {
  // Bound work first: never normalize or scan megabytes of attacker input.
  if (raw.length > PASSWORD_RAW_MAX_UNITS) return { ok: false, reasons: ['TOO_LONG'] };
  const normalized = normalizePassword(raw);
  if (normalized === null || /\p{Cc}/u.test(normalized)) {
    return { ok: false, reasons: ['INVALID_CHARACTERS'] };
  }
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_CODE_POINTS) return { ok: false, reasons: ['TOO_SHORT'] };
  if (length > PASSWORD_MAX_CODE_POINTS) return { ok: false, reasons: ['TOO_LONG'] };

  const reasons: PasswordRejection[] = [];
  const lower = normalized.toLowerCase();
  const compact = lower.replace(/\s+/gu, '');
  const letters = lower.replace(/[^\p{L}]/gu, '');

  if (
    COMMON_PHRASES.has(letters) ||
    isWordConcatenation(letters, COMMON_BASE_WORDS) ||
    // Digits/symbols only (e.g. "123456789012345!") carry no dictionary word but are common.
    (letters.length === 0 && /^[\p{N}\p{P}\p{S}]+$/u.test(compact) && new Set(compact).size < 8)
  ) {
    reasons.push('COMMONLY_USED');
  }
  if (isRepetitiveOrSequential(compact)) reasons.push('REPETITIVE_OR_SEQUENTIAL');

  const localPart = context.email?.split('@')[0]?.toLowerCase();
  const contextWords = [...SERVICE_WORDS];
  if (context.email && localPart) {
    contextWords.push(context.email.toLowerCase());
    if (localPart.length >= 4) contextWords.push(localPart);
    // Name fragments of the local part ("asha.rao" → "asha", "rao").
    contextWords.push(...localPart.split(/[._+-]/).filter((t) => t.length >= 3));
  }
  // Longest first, so "asha.rao" is removed before its fragment "asha".
  contextWords.sort((a, b) => b.length - a.length);
  // Context words are fine inside a long passphrase; reject only when little else remains.
  if (
    contextWords.some((w) => compact.includes(w)) &&
    residualAfterRemoving(compact, contextWords) < 8
  ) {
    reasons.push('CONTEXT_SPECIFIC');
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, normalized };
}
