/**
 * Pure helpers for talking to KAREN (ADR-0029 / ADR-0030), shared by web and mobile:
 *
 * - echo / barge-in guard: is what the microphone heard the USER, or KAREN's own voice leaking
 *   from the speaker? Should it interrupt her?
 * - wake phrase: did the user say "Hey KAREN" (and maybe the question in the same breath)?
 *
 * No I/O, no platform APIs, so both apps use the same tested rules.
 */

/**
 * After KAREN stops speaking, transcripts are still checked against her words for this long:
 * recognition reports the end of a turn ~1 s after the audio, so an echoed sentence can arrive
 * after playback has already ended.
 */
export const ECHO_TAIL_MS = 3_000;

/** Short commands that should interrupt KAREN even as a single word (en / Hinglish / hi). */
const STOP_WORDS = new Set([
  'stop',
  'wait',
  'pause',
  'enough',
  'cancel',
  'ruko',
  'ruk',
  'bas',
  'chup',
  'रुको',
  'रुक',
  'बस',
]);

/** Lower-case word tokens; keeps Devanagari and Latin letters/digits, drops punctuation. */
export function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFC')
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  );
}

/**
 * True when `heard` is (mostly) a fragment of what KAREN is saying. A transcript of echoed
 * playback reuses KAREN's words; a real interruption brings new ones.
 */
export function isLikelyEcho(heard: string, spoken: string | null | undefined): boolean {
  if (!spoken) return false;
  const heardWords = words(heard);
  if (heardWords.length === 0) return false;
  const spokenWords = new Set(words(spoken));
  if (spokenWords.size === 0) return false;
  const overlap = heardWords.filter((w) => spokenWords.has(w)).length;
  // One- or two-word fragments need a full match; longer ones tolerate ASR differences.
  const needed = heardWords.length <= 2 ? heardWords.length : Math.ceil(heardWords.length * 0.7);
  return overlap >= needed;
}

/** True when `heard` contains a stop word that is not just KAREN's own voice. */
export function isStopCommand(heard: string, spoken: string | null | undefined): boolean {
  return words(heard).some((w) => STOP_WORDS.has(w)) && !isLikelyEcho(heard, spoken);
}

/**
 * Should this partial transcript interrupt KAREN (stop speaking / stop the running answer)?
 * Not on a bare "speech started" (a cough, a door), not on echo; yes on two or more new words
 * or a stop word.
 */
export function shouldInterrupt(heard: string, spoken: string | null | undefined): boolean {
  const heardWords = words(heard);
  if (heardWords.length === 0) return false;
  if (isLikelyEcho(heard, spoken)) return false;
  return heardWords.length >= 2 || heardWords.some((w) => STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------------- wake phrase

/** Greetings that must come right before the name ("hey KAREN", "ok KAREN", "हे करेन"). */
const WAKE_GREETINGS = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'हे', 'है', 'हाय', 'ओके']);
/**
 * How speech recognisers commonly spell "KAREN" (English and Devanagari). A greeting is
 * required, so ordinary sentences mentioning someone called Karan do not wake KAREN.
 */
const WAKE_NAMES = new Set([
  'karen',
  'karan',
  'kiran',
  'karin',
  'karine',
  'caren',
  'carin',
  'caron',
  'keren',
  'kerin',
  'करेन',
  'करन',
  'कैरन',
  'केरन',
  'किरन',
  'करिन',
]);
/** Fused forms recognisers sometimes emit ("heykaren"). */
const FUSED = new Set([...WAKE_NAMES].map((n) => `hey${n}`));

/** Phrases to bias the recogniser towards (where the platform supports biasing). */
export const WAKE_HINTS = ['Hey KAREN', 'KAREN'] as const;

export interface WakeMatch {
  /** Whatever was said after the wake phrase in the same utterance ("" if nothing). */
  rest: string;
}

const tokenWord = (token: string): string => words(token).join('');

/**
 * Finds "Hey KAREN" in a transcript. Returns the text after it (the question said in the same
 * breath), or null when the wake phrase is absent.
 */
export function matchWakePhrase(transcript: string): WakeMatch | null {
  const tokens = transcript.split(/\s+/).filter(Boolean);
  const normal = tokens.map(tokenWord);
  for (let i = 0; i < normal.length; i++) {
    const word = normal[i]!;
    let after = -1;
    if (FUSED.has(word)) after = i + 1;
    else if (WAKE_GREETINGS.has(word) && WAKE_NAMES.has(normal[i + 1] ?? '')) after = i + 2;
    if (after >= 0) {
      const rest = tokens
        .slice(after)
        .join(' ')
        .replace(/^[\s,.!?।:;-]+/u, '')
        .trim();
      return { rest };
    }
  }
  return null;
}

/**
 * Removes wake words at the START of a live turn: the conversation starts recording the instant
 * the wake phrase is heard, so a turn can begin with its tail ("KAREN, what's the time?", or just
 * "KAREN"). Returns the rest ("" when the turn was only wake words). Mid-sentence names stay.
 */
export function stripLeadingWakeWords(transcript: string): string {
  const tokens = transcript.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const w = tokenWord(tokens[i]!);
    if (w === '' || WAKE_GREETINGS.has(w) || WAKE_NAMES.has(w) || FUSED.has(w)) i++;
    else break;
  }
  // Only a greeting with no name ("hello, how are you") is a normal sentence: keep it.
  const removed = tokens.slice(0, i).map(tokenWord);
  if (!removed.some((w) => WAKE_NAMES.has(w) || FUSED.has(w))) return transcript.trim();
  return tokens
    .slice(i)
    .join(' ')
    .replace(/^[\s,.!?।:;-]+/u, '')
    .trim();
}

/** A same-breath question needs a few words to be worth sending ("Hey KAREN, what's up" → yes). */
export function isUsableQuestion(text: string): boolean {
  return words(text).length >= 2;
}
