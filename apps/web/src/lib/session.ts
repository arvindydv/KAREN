import 'server-only';
import type { MeResponse } from '@karen/api-contracts';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeRelativePath } from './safe-redirect';
import { readSessionToken, serverGet } from './server-api';

export type SessionState =
  | { status: 'active'; me: MeResponse; token: string }
  | { status: 'deletion_pending'; token: string }
  | { status: 'signed_out'; hadCookie: boolean };

/** Thrown when the API cannot be reached; rendered by the error boundary. */
export class SessionUnavailableError extends Error {
  constructor() {
    super('KAREN is temporarily unavailable. Please try again shortly.');
    this.name = 'SessionUnavailableError';
  }
}

/**
 * Resolves the session server-side: the HttpOnly cookie is sent to `GET /v1/me` as a bearer
 * token. Authorisation is still enforced by the API on every request; this controls navigation.
 */
export async function getSession(): Promise<SessionState> {
  const token = await readSessionToken();
  if (!token) return { status: 'signed_out', hadCookie: false };
  const res = await serverGet<MeResponse>('v1/me', token);
  if (res.ok) return { status: 'active', me: res.data, token };
  if (res.status === 401) return { status: 'signed_out', hadCookie: true };
  if (
    res.status === 403 &&
    res.error?.code === 'ACCOUNT_INACTIVE' &&
    res.error.next_options?.includes('CANCEL_DELETION')
  ) {
    return { status: 'deletion_pending', token };
  }
  if (res.status === 403) return { status: 'signed_out', hadCookie: true };
  throw new SessionUnavailableError();
}

async function currentPath(): Promise<string> {
  return safeRelativePath((await headers()).get('x-karen-pathname')) ?? '/app';
}

function signInUrl(next: string, expired: boolean): string {
  // A stale cookie is cleared by the session-ended route (server components cannot set cookies).
  const base = expired ? '/auth/session-ended' : '/sign-in';
  return `${base}?next=${encodeURIComponent(next)}`;
}

/** Full-access area: active sessions only. */
export async function requireSession(): Promise<Extract<SessionState, { status: 'active' }>> {
  const session = await getSession();
  if (session.status === 'active') return session;
  if (session.status === 'deletion_pending') redirect('/app/deletion-scheduled');
  redirect(signInUrl(await currentPath(), session.hadCookie));
}

/** Restricted area (deletion scheduled): pending-deletion sessions only. */
export async function requireDeletionPendingSession(): Promise<
  Extract<SessionState, { status: 'deletion_pending' }>
> {
  const session = await getSession();
  if (session.status === 'deletion_pending') return session;
  if (session.status === 'active') redirect('/app');
  redirect(signInUrl('/app', session.hadCookie));
}
