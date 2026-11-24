import { createHmac } from 'node:crypto';

/**
 * Paths pino will censor wherever they appear. Covers auth headers, cookies, tokens,
 * secrets and free-text fields that may hold private prompts (architecture §10, spec SEC-06).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-karen-signature"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.password',
  '*.secret',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  '*.api_key',
  '*.apiKey',
  '*.otp',
  '*.upi_pin',
  '*.card_number',
  '*.cvv',
  '*.prompt',
  '*.messages',
  '*.content',
  '*.email',
  '*.phone',
  // Phase 03 memory content (ADR-0036 §12.2): never in logs, whatever the object nesting.
  '*.value_text',
  '*.valueText',
  '*.source_excerpt',
  '*.sourceExcerpt',
  '*.source_span',
  '*.trigger_text',
  '*.memory_context',
  '*.message_text',
  '*.subject_label',
  '*.text',
] as const;

const PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  [/\b(?:sk|pk|whsec|vck|rk)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
  [/(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, '[REDACTED_PHONE]'],
  [/\b\d{12,19}\b/g, '[REDACTED_NUMBER]'],
];

/** Best-effort scrubbing for free text that must be logged (e.g. error messages). */
export function redactText(input: string): string {
  return PATTERNS.reduce((acc, [re, replacement]) => acc.replace(re, replacement), input);
}

/**
 * Stable pseudonymous user reference for logs/traces/analytics. HMAC (not a bare hash)
 * so references cannot be reversed by hashing candidate IDs without the key.
 */
export function pseudonymizeUserId(userId: string, key: string): string {
  return `usr_${createHmac('sha256', key).update(userId).digest('hex').slice(0, 24)}`;
}
