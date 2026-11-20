/**
 * IANA time zone check. Uses the ICU resolver rather than `Intl.supportedValuesOf('timeZone')`,
 * which lists only ICU's canonical names (e.g. `Asia/Calcutta`) and would reject valid aliases
 * such as `Asia/Kolkata` — India's standard zone name.
 */
export function isValidTimeZone(tz: string): boolean {
  if (tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    // RangeError is the documented "unknown time zone" signal; reported as `false`.
    return false;
  }
}

export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf('currency').includes(code);
}
