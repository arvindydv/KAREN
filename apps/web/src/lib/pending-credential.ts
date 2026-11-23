/**
 * Browser-memory hand-off of what the user just typed at sign-up (or at a sign-in that needed
 * e-mail verification), so the verify-email page can sign them straight in once the code is
 * accepted instead of sending them back to /sign-in.
 *
 * - A module variable only: never localStorage/sessionStorage, cookies or URLs. It survives
 *   client-side navigation and is lost on reload, in which case the user signs in normally.
 * - Single use (`take` always clears) and expires after HOLD_MS.
 */
export const HOLD_MS = 15 * 60_000;

export interface HeldSignIn {
  email: string;
  password: string;
  /** Where to land after the automatic sign-in (new accounts → onboarding). */
  next: string;
}

let held: (HeldSignIn & { until: number }) | null = null;

export function holdSignIn(value: HeldSignIn, now = Date.now()): void {
  held = { ...value, until: now + HOLD_MS };
}

export function takeSignIn(now = Date.now()): HeldSignIn | null {
  const h = held;
  held = null;
  if (!h || now > h.until) return null;
  return { email: h.email, password: h.password, next: h.next };
}
