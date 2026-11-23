/**
 * SECRET detectors (arch §7.3 V5). Run on the WHOLE message and on the span; any hit rejects every
 * candidate from that message, even on an explicit request. Deterministic, no I/O. Part of
 * MEMORY_POLICY_VERSION.
 *
 * Near-misses that must NOT trigger: phone numbers, order ids, pin codes, Luhn-invalid digit runs.
 */

export const SECRET_KINDS = [
  'card',
  'cvv',
  'pin',
  'otp',
  'password',
  'upi_pin',
  'aadhaar',
  'pan',
  'passport',
  'voter_id',
  'driving_licence',
  'bank_account',
  'api_key',
  'recovery_code',
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** Devanagari digits → ASCII so formats match in Hindi text. */
function asciiDigits(text: string): string {
  return text.replace(/[०-९]/gu, (d) => String(d.charCodeAt(0) - 0x0966));
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Verhoeff checksum (Aadhaar's last digit). */
export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const rev = [...digits].reverse();
  for (let i = 0; i < rev.length; i++) {
    c = VD[c]![VP[i % 8]![rev[i]!.charCodeAt(0) - 48]!]!;
  }
  return c === 0;
}

interface DigitRun {
  /** As written (with separators). */
  readonly raw: string;
  /** Digits only. */
  readonly digits: string;
  /** Preceded by '+' (international phone prefix). */
  readonly plus: boolean;
}

/** Digit runs of 8–23 digits allowing single spaces or hyphens between groups. */
function digitRuns(text: string): DigitRun[] {
  const out: DigitRun[] = [];
  for (const m of text.matchAll(/(?<![\p{N}\p{L}])\d(?:[ -]?\d){7,22}(?![\p{N}\p{L}])/gu)) {
    out.push({
      raw: m[0],
      digits: m[0].replace(/[ -]/g, ''),
      plus: text[m.index - 1] === '+',
    });
  }
  return out;
}

/** Card numbers are written contiguously or in 4-digit groups (Amex 4-6-5). Order ids are not. */
function cardShaped(raw: string): boolean {
  const groups = raw.split(/[ -]/);
  if (groups.length === 1) return true;
  const sizes = groups.map((g) => g.length).join('-');
  return (
    /^4-4-4-[1-7]$/.test(sizes) ||
    /^4-4-4-4-[1-3]$/.test(sizes) ||
    sizes === '4-6-5' ||
    sizes === '4-6-4'
  );
}

/** Aadhaar is written as 12 contiguous digits or 4-4-4; a +91 mobile number is not Aadhaar. */
function aadhaarShaped(run: DigitRun): boolean {
  if (run.plus) return false;
  const sizes = run.raw
    .split(/[ -]/)
    .map((g) => g.length)
    .join('-');
  if (sizes !== '12' && sizes !== '4-4-4') return false;
  if (sizes === '12' && /^91[6-9]\d{9}$/.test(run.digits)) return false;
  return true;
}

const KW = {
  cvv: /\b(?:cvv|cvc|cvv2|card security code)\b|सीवीवी/iu,
  pin: /\b(?:atm|debit|credit|card|bank)?\s*pin\b(?!\s*-?\s*code)(?!code)|पिन(?!\s*कोड)/iu,
  otp: /\b(?:otp|one[- ]time password|verification code|o\.t\.p)\b|ओटीपी/iu,
  upi: /\bupi\s*pin\b|यूपीआई\s*पिन/iu,
  password:
    /\b(?:password|passcode|passwd|pass word|pwd|login pin|wifi password)\b|पासवर्ड|पासकोड/iu,
  recovery: /\b(?:recovery|backup|2fa|two[- ]factor)\s*codes?\b|रिकवरी\s*कोड|बैकअप\s*कोड/iu,
  passport: /\bpassport\b|पासपोर्ट/iu,
  voter: /\b(?:voter\s*id|epic)\b|वोटर\s*आईडी|मतदाता/iu,
  licence:
    /\b(?:driving\s*licen[cs]e|dl\s*(?:no|number)?|licen[cs]e\s*(?:no|number))\b|ड्राइविंग\s*लाइसेंस/iu,
  account: /\b(?:a\/c|acct|account|khata)\b|खाता|अकाउंट/iu,
};

/** A short number (3–8 digits) within `window` characters after a keyword match. */
function keywordNearDigits(text: string, kw: RegExp, min: number, max: number): boolean {
  const re = new RegExp(kw.source, kw.flags.includes('g') ? kw.flags : `${kw.flags}g`);
  for (const m of text.matchAll(re)) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const before = text.slice(Math.max(0, m.index - 25), m.index);
    const num = new RegExp(`(?<![\\d])\\d{${min},${max}}(?![\\d])`, 'u');
    if (num.test(tail) || num.test(before)) return true;
  }
  return false;
}

/** A password keyword followed by a value that looks like a password (has a digit or symbol). */
function passwordValue(text: string): boolean {
  const re = new RegExp(KW.password.source, 'giu');
  for (const m of text.matchAll(re)) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    for (const tok of tail.split(/\s+/u).slice(0, 5)) {
      if (tok.length >= 6 && /[\d!@#$%^&*_+=?~]/u.test(tok) && /[A-Za-z]/u.test(tok)) return true;
    }
  }
  return false;
}

const PAN_RE = /(?<![A-Za-z0-9])[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z](?![A-Za-z0-9])/u;
const IFSC_RE = /(?<![A-Za-z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Za-z0-9])/u;
// Keyword-gated, so any leading letter is accepted (Indian format excludes Q/X/Z; foreign ones do not).
const PASSPORT_RE = /(?<![A-Za-z0-9])[A-Z]{1,2}\s?\d{6,8}(?![A-Za-z0-9])/u;
const VOTER_RE = /(?<![A-Za-z0-9])[A-Z]{3}\d{7}(?![A-Za-z0-9])/u;
const DL_RE = /(?<![A-Za-z0-9])[A-Z]{2}[- ]?\d{2}[- ]?(?:19|20)\d{2}\d{7}(?![A-Za-z0-9])/u;
const API_KEY_RES = [
  /\bsk-(?:proj-|live_|test_)?[A-Za-z0-9_-]{20,}/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/u,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u,
  /\b(?:api[_ -]?key|secret[_ -]?key|access[_ -]?token|bearer)\b[^\n]{0,12}?[A-Za-z0-9_\-.]{24,}/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
];
const RECOVERY_GROUP_RE =
  /(?<![A-Za-z0-9])[A-Za-z0-9]{4,5}(?:-[A-Za-z0-9]{4,5}){2,}(?![A-Za-z0-9])/u;

/**
 * All secret kinds found in `text`. Empty array = no secret. Order is stable (SECRET_KINDS order).
 */
export function detectSecrets(input: string): SecretKind[] {
  const text = asciiDigits(input.normalize('NFC'));
  const found = new Set<SecretKind>();
  const runs = digitRuns(text);

  for (const run of runs) {
    const d = run.digits;
    if (
      d.length >= 13 &&
      d.length <= 19 &&
      cardShaped(run.raw) &&
      luhnValid(d) &&
      !/^(\d)\1+$/.test(d)
    ) {
      found.add('card');
    }
    if (d.length === 12 && /^[2-9]/.test(d) && aadhaarShaped(run) && verhoeffValid(d)) {
      found.add('aadhaar');
    }
  }
  if (keywordNearDigits(text, KW.cvv, 3, 4)) found.add('cvv');
  if (keywordNearDigits(text, KW.upi, 4, 6)) found.add('upi_pin');
  else if (keywordNearDigits(text, KW.pin, 4, 6)) found.add('pin');
  if (keywordNearDigits(text, KW.otp, 4, 8)) found.add('otp');
  if (passwordValue(text)) found.add('password');
  if (PAN_RE.test(text)) found.add('pan');
  if (PASSPORT_RE.test(text) && KW.passport.test(text)) found.add('passport');
  if (VOTER_RE.test(text) && KW.voter.test(text)) found.add('voter_id');
  if (DL_RE.test(text)) found.add('driving_licence');
  if (IFSC_RE.test(text) && runs.some((r) => r.digits.length >= 9 && r.digits.length <= 18)) {
    found.add('bank_account');
  } else if (KW.account.test(text) && keywordNearDigits(text, KW.account, 9, 18)) {
    found.add('bank_account');
  }
  if (API_KEY_RES.some((re) => re.test(text))) found.add('api_key');
  if (KW.recovery.test(text) && RECOVERY_GROUP_RE.test(text)) found.add('recovery_code');

  return SECRET_KINDS.filter((k) => found.has(k));
}
