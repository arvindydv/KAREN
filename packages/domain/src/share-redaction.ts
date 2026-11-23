/**
 * Redaction for COPY/SHARE of chat content (F02-01 "copy/share redacted content").
 *
 * Masks common personal identifiers before text leaves KAREN through the share sheet or a
 * "copy redacted" action. Best effort, pattern-based — it reduces accidental disclosure, it
 * does not guarantee anonymity, and the UI must say so. Plain copy stays available.
 */
export interface ShareRedaction {
  text: string;
  /** Number of replaced spans (0 = nothing found). */
  redactions: number;
}

const RULES: readonly { label: string; re: RegExp }[] = [
  // e-mail and UPI-style handles (name@bank)
  { label: 'email', re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\b/g },
  // PAN (India): ABCDE1234F
  { label: 'pan', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  // Aadhaar-like 12 digits in 4-4-4 groups, or card-like 13–19 digit runs (spaces/dashes)
  { label: 'number', re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}(?:[ -]?\d{1,7})?\b/g },
  // Phone numbers: +91 / 0 prefixes, 10-digit Indian mobiles, generic international
  { label: 'phone', re: /(?:\+\d{1,3}[ -]?)?(?:\(?\d{2,5}\)?[ -]?)?\d{3,5}[ -]?\d{4,5}\b/g },
  // IFSC: ABCD0123456
  { label: 'ifsc', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
];

const digits = (s: string) => s.replace(/\D/g, '').length;

export function redactForSharing(input: string): ShareRedaction {
  let text = input;
  let redactions = 0;
  for (const { label, re } of RULES) {
    text = text.replace(re, (match) => {
      // Phones/numbers need enough digits to be identifiers (keeps "2026", "₹1,200", times).
      if ((label === 'phone' || label === 'number') && digits(match) < 10) return match;
      redactions++;
      return `[${label} hidden]`;
    });
  }
  return { text, redactions };
}
