/**
 * Typed reveal that is independent of token cadence: the visible prefix advances every frame
 * by a share of the backlog (so bursts catch up within ~250 ms and trickles look steady),
 * never by whole network chunks. Pure function; the hook drives it with requestAnimationFrame.
 */
export function nextRevealLength(shown: number, target: number, elapsedMs: number): number {
  if (shown >= target) return target;
  const backlog = target - shown;
  // At least ~200 chars/s (comfortable reading pace, no visible stall at the tail); large bursts
  // drain proportionally so the text never lags far behind what has arrived.
  const step = Math.max((200 * elapsedMs) / 1000, (backlog * elapsedMs) / 250);
  return Math.min(target, shown + Math.max(1, Math.round(step)));
}

/** Never cut a surrogate pair (emoji) or a Devanagari combining mark in half. */
export function safeSliceEnd(text: string, end: number): number {
  let e = Math.min(end, text.length);
  while (e < text.length && e > 0) {
    const code = text.charCodeAt(e);
    const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
    const isCombining =
      (code >= 0x0900 && code <= 0x0903) || // Devanagari signs
      (code >= 0x093a && code <= 0x094f) || // vowel signs, virama
      (code >= 0x0951 && code <= 0x0957) ||
      code === 0x0962 ||
      code === 0x0963 ||
      code === 0x200c || // ZWNJ
      code === 0x200d || // ZWJ
      (code >= 0x0300 && code <= 0x036f) || // combining diacritics
      (code >= 0xfe00 && code <= 0xfe0f); // variation selectors
    if (!isLowSurrogate && !isCombining) break;
    e++;
  }
  return e;
}
