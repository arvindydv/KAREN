import { PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from '@karen/api-contracts';

/** Client-side UX checks only; the server is authoritative. */
export const codePointLength = (s: string): number => [...s.normalize('NFKC')].length;

export function passwordProblem(password: string): string | null {
  const n = codePointLength(password);
  if (n < PASSWORD_MIN_CODE_POINTS)
    return `Use at least ${PASSWORD_MIN_CODE_POINTS} characters (${n} so far).`;
  if (n > PASSWORD_MAX_CODE_POINTS) return `Use at most ${PASSWORD_MAX_CODE_POINTS} characters.`;
  return null;
}

export const looksLikeEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Intl unavailable: the server falls back to its default timezone; user can set it later.
    return undefined;
  }
}
