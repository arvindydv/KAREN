/**
 * Minimal structured server log for the BFF. Callers pass ONLY non-sensitive fields: route
 * templates, status codes, error names, correlation ids. Never tokens, passwords, codes,
 * e-mail addresses, request bodies or cookies.
 */
type Level = 'info' | 'warn' | 'error';
type Field = string | number | boolean | null | undefined;

export function bffLog(level: Level, event: string, fields: Record<string, Field> = {}): void {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ level, event, service: 'web-bff', ...fields });
  if (level === 'info') process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
}

/** A safe description of a thrown value: its name only (messages can embed URLs/inputs). */
export const errorName = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
