/**
 * Splits an assistant answer into speech segments while it is still being written (ADR-0031),
 * so KAREN starts speaking her first sentence instead of waiting for the whole answer.
 *
 * Deterministic: segment N's boundaries depend only on the text up to its end, so a client can
 * request segment 0, 1, 2 … in separate calls (mobile) or one stream can chain them (web), and
 * both see the same sentences. A boundary is a sentence end (. ! ? । ॥, optional closing quote
 * or bracket) followed by whitespace, or a line break. While the answer is still streaming a
 * sentence end at the very end of the text is not trusted yet ("3." may become "3.5").
 */

export interface SegmentOptions {
  /** Minimum characters in the FIRST segment (small, so KAREN starts speaking quickly). */
  firstMinChars: number;
  /**
   * The first segment may also end at a comma once it is this long: a long opening sentence
   * then starts playing at its first natural pause instead of waiting for the full stop.
   */
  firstCommaMinChars: number;
  /** Minimum characters in later segments (bigger: fewer requests, steadier speech). */
  nextMinChars: number;
  /** Nothing beyond this many characters of the answer is spoken. */
  maxTotalChars: number;
}

export const DEFAULT_SEGMENTS: SegmentOptions = {
  firstMinChars: 12,
  // ADR-0033: phones play whole sentence clips (synthesised at about real time), so a short
  // first clip is what makes KAREN start speaking quickly.
  firstCommaMinChars: 24,
  nextMinChars: 80,
  maxTotalChars: 4_000,
};

export type SegmentResult =
  | { kind: 'segment'; text: string; start: number; end: number }
  /** Not enough text yet: ask again when more of the answer has arrived. */
  | { kind: 'wait' }
  /** There is no segment N (the answer is finished and shorter). */
  | { kind: 'done' };

// Colons and semicolons count too: spoken, they are natural pauses ("तीन बातें: …").
const SENTENCE_END = /[.!?।॥:;]+["'”’)\]]*|\n+/gu;
/** The first segment's boundaries: sentence ends, plus a comma (checked against its own minimum). */
const FIRST_SEGMENT_END = /[.!?।॥:;]+["'”’)\]]*|\n+|[,،]/gu;

const COMMA = /[,،]/gu;

/** End index of the segment starting at `start`, or null when it is not decidable yet. */
function segmentEnd(
  text: string,
  start: number,
  minChars: number,
  final: boolean,
  commaMinChars: number | null,
): number | null {
  const limit = text.length;
  const pattern = commaMinChars === null ? SENTENCE_END : FIRST_SEGMENT_END;
  pattern.lastIndex = start;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const end = m.index + m[0].length;
    COMMA.lastIndex = 0;
    const isComma = COMMA.test(m[0]);
    if (end - start < (isComma ? commaMinChars! : minChars)) continue;
    if (m[0].startsWith('\n')) return end;
    if (end < limit) {
      if (/\s/u.test(text[end]!)) return end;
      continue; // "3.5", "e.g" — not a sentence end
    }
    // Sentence end at the very end of the text: only trusted once the answer is final.
    return final ? end : null;
  }
  return final ? limit : null;
}

/**
 * Segment `index` of `text`. `final` = the answer is finished (completed, incomplete, failed or
 * cancelled), so the remainder is the last segment.
 */
export function speechSegment(
  text: string,
  index: number,
  final: boolean,
  options: SegmentOptions = DEFAULT_SEGMENTS,
): SegmentResult {
  const body = text.length > options.maxTotalChars ? text.slice(0, options.maxTotalChars) : text;
  const isFinal = final || body.length < text.length;
  let start = 0;
  for (let i = 0; ; i++) {
    // Skip leading whitespace so no segment is blank.
    while (start < body.length && /\s/u.test(body[start]!)) start++;
    if (start >= body.length) return isFinal ? { kind: 'done' } : { kind: 'wait' };
    const min = i === 0 ? options.firstMinChars : options.nextMinChars;
    const end = segmentEnd(body, start, min, isFinal, i === 0 ? options.firstCommaMinChars : null);
    if (end === null) return { kind: 'wait' };
    if (i === index) {
      return { kind: 'segment', text: body.slice(start, end).trim(), start, end };
    }
    start = end;
  }
}
