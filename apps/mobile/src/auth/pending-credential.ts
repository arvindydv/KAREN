/**
 * Holds the password the user just typed (sign-up, or a sign-in that needed e-mail
 * verification) so we can sign them in automatically once their code is accepted, instead
 * of sending them back to the sign-in screen to type it again.
 *
 * - Memory only: a module variable — never Zustand (CLAUDE.md: UI state only), never
 *   SecureStore, never a route param. Lost on app restart; the user then signs in normally.
 * - Bound to the e-mail it was typed with and single use: `take` returns it once and wipes it.
 * - Expires after HOLD_MS even if never taken.
 */
export const HOLD_MS = 15 * 60_000;

let held: { email: string; password: string; until: number } | null = null;

export function holdCredential(email: string, password: string, now = Date.now()): void {
  held = { email: email.trim().toLowerCase(), password, until: now + HOLD_MS };
}

/** The held password for `email`, at most once. Always clears what was held. */
export function takeCredential(email: string, now = Date.now()): string | null {
  const h = held;
  held = null;
  if (!h || now > h.until || h.email !== email.trim().toLowerCase()) return null;
  return h.password;
}

export function clearCredential(): void {
  held = null;
}
