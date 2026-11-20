import 'server-only';

/**
 * Minimal structured server log (stderr, one JSON line). Callers pass ONLY non-sensitive fields:
 * never tokens, passwords, enrollment tokens, credential payloads, e-mail addresses or bodies.
 */
type Field = string | number | boolean | null;

export function logEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, Field> = {},
) {
  process.stderr.write(
    `${JSON.stringify({ level, service: 'admin', event, time: new Date().toISOString(), ...fields })}\n`,
  );
}
