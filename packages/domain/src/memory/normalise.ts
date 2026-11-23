/**
 * Deterministic text normalisation and tokenisation for memory (arch §4.6, §6.3 F2).
 *
 * The API writes `search_lexemes` from `tokenizeForSearch` on every insert/update and builds the
 * query tokens with the same function, so matching is locale-independent (does not depend on the
 * database LC_CTYPE, Q2). Any behaviour change MUST bump MEMORY_TOKENIZER_VERSION (a
 * re-tokenisation job then rewrites stored lexemes).
 */

/** v1: NFC; Latin case-fold; split on non letter/mark/number; EN/HI/Hinglish stop-lists;
 *  Latin vowel folding (aa→a, ee→i, oo→u), `-hin`→`-hi`, English plural `-s` fold (len ≥ 4),
 *  one final vowel dropped on words of length ≥ 5 (Hinglish inflection);
 *  Devanagari digits → ASCII; Devanagari nukta folded (ज़→ज), matras and chandrabindu kept;
 *  ZWNJ/ZWJ ignored for matching. */
export const MEMORY_TOKENIZER_VERSION = 'mt-1';

/** NFC + collapse all whitespace runs to one space + trim. Used by span checks (V2/V3). */
export function normaliseWhitespace(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * Value normalisation for dedupe (arch §4.6): NFC → trim → collapse whitespace → case-fold Latin
 * → strip trailing punctuation.
 */
export function normaliseMemoryValue(text: string): string {
  return normaliseWhitespace(text)
    .replace(/\p{Script=Latin}+/gu, (m) => m.toLowerCase())
    .replace(/[\p{P}\s]+$/u, '');
}

/**
 * The material hashed into `value_key = sha256(kind|slot|subject|subject_label|normalised)`
 * (arch §4.6). Hashing happens in the API (node crypto); this keeps the definition in one place.
 */
export function memoryValueKeyMaterial(input: {
  kind: string;
  slot: string;
  subject: string;
  subjectLabel?: string | null;
  text: string;
}): string {
  const label = input.subjectLabel ? normaliseMemoryValue(input.subjectLabel) : '';
  return [input.kind, input.slot, input.subject, label, normaliseMemoryValue(input.text)].join('|');
}

const STOP_EN = (
  'a an the i im me my mine you your we our us he she it its they them their is am are was ' +
  'were be been being do does did have has had to of in on at for from with by and or but ' +
  'so if that this these those what which who whom when where why how can could should ' +
  'would will shall may might must please any some there here about into as than then too ' +
  'very just also not no yes up out get got like want need tell know let make find give ' +
  'today now ok okay re ve ll d s t m'
).split(' ');
const STOP_HG = (
  'main mai mein me mera meri mere mujhe mujhse hum tum aap hai hain hu hun ho tha thi the ' +
  'ka ki ke ko se par pe aur ya bhi to toh na kya koi kuch ye yeh woh wo is us ek ne liye ' +
  'wala wali wale karo kar karna do de dena batao bata please hi ji yaar abhi aaj apna apni ' +
  'apne jo'
).split(' ');
const STOP_HI = (
  'मैं मे में मेरा मेरी मेरे मुझे मुझसे हम तुम आप है हैं हूँ हूं हो था थी थे का की के को से ' +
  'पर और या भी तो ना क्या कोई कुछ ये यह वह वो इस उस एक ने लिए वाला वाली वाले करो कर करना दो ' +
  'दे देना बताओ बता जी अभी आज अपना अपनी अपने जो कि'
).split(' ');

/** Words whose final vowel is meaningful for policy matching ("caste" must not become "cast"). */
const KEEP_FINAL_VOWEL = new Set(['caste']);

/** Fold a Latin (romanised Hindi / English) token: vowel runs, -hin, plural -s, final vowel. */
function foldLatin(token: string): string {
  let t = token.replace(/aa+/g, 'a').replace(/ee+/g, 'i').replace(/oo+/g, 'u');
  if (t.length > 3 && t.endsWith('hin')) t = t.slice(0, -1);
  if (t.length >= 4 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  // Hinglish inflection (khana/khane/khaane, shaadi/shadi): drop one final vowel on longer words.
  if (t.length >= 5 && /[aeio]$/.test(t) && !KEEP_FINAL_VOWEL.has(t)) t = t.slice(0, -1);
  return t;
}

const NUKTA = /़/gu;

/** Fold one raw token (Latin case/vowel/plural folding; Devanagari nukta). */
export function foldToken(raw: string): string {
  const r = raw
    .replace(/[\u200c\u200d]/gu, '')
    .replace(/[\u0966-\u096f]/gu, (d) => String(d.charCodeAt(0) - 0x0966));
  if (/^[\p{Script=Latin}\p{N}]+$/u.test(r)) return foldLatin(r.toLowerCase());
  return r.replace(NUKTA, '');
}

const STOP = new Set<string>([
  ...STOP_EN.map(foldLatin),
  ...STOP_HG.map(foldLatin),
  ...STOP_HI.map((w) => w.normalize('NFC').replace(NUKTA, '')),
]);

/** Raw tokens (NFC, split on anything that is not a letter, mark or number). No folding. */
export function rawTokens(text: string): string[] {
  return text
    .normalize('NFC')
    .replace(/[\u200c\u200d]/gu, '')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Search tokens: folded, stop words removed, de-duplicated, sorted (stable lexeme sets).
 * Single Latin letters and pure punctuation never survive.
 */
export function tokenizeForSearch(text: string): string[] {
  const out = new Set<string>();
  for (const raw of rawTokens(text)) {
    const t = foldToken(raw);
    if (t.length < 2 && !/\p{N}/u.test(t)) continue;
    if (STOP.has(t)) continue;
    out.add(t);
  }
  return [...out].sort();
}

/** Folded tokens WITHOUT stop-word removal, in order (used by lexicon phrase matching). */
export function matchTokens(text: string): string[] {
  return rawTokens(text).map(foldToken);
}

export interface OffsetToken {
  /** Folded token (same folding as search tokens; stop words kept). */
  readonly tok: string;
  /** Code-unit offsets into the NFC-normalised, whitespace-collapsed text. */
  readonly start: number;
  readonly end: number;
}

/** Tokens with offsets into `normaliseWhitespace(text)` (callers must use that same string). */
export function offsetTokens(normalised: string): OffsetToken[] {
  const out: OffsetToken[] = [];
  for (const m of normalised.matchAll(/[\p{L}\p{M}\p{N}\u200c\u200d]+/gu)) {
    const tok = foldToken(m[0]);
    if (tok.length === 0) continue;
    out.push({ tok, start: m.index, end: m.index + m[0].length });
  }
  return out;
}
