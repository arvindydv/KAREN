import 'server-only';
import { staffMeSchema, type StaffMe } from '@karen/api-contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { staffApi } from './api';
import { serverEnv } from './env';
import { sessionCookie } from './security/cookies';

export interface StaffSession {
  /** From `GET /v1/staff/auth/me` — never decoded from a client-held value. */
  me: StaffMe;
  /** Opaque `kst_` bearer for server-side API calls. Never render or log it. */
  token: string;
}

type Lookup = { kind: 'none' } | { kind: 'expired' } | { kind: 'ok'; session: StaffSession };

/** One `me` round trip per request (layout + page share it). */
const lookup = cache(async (): Promise<Lookup> => {
  const token = (await cookies()).get(sessionCookie(serverEnv()).name)?.value;
  if (!token) return { kind: 'none' };
  const { data, response } = await staffApi(token).GET('/v1/staff/auth/me');
  if (response.status === 401) return { kind: 'expired' };
  if (!data) {
    // Fail closed and visibly (error boundary) — never treat an API failure as signed in.
    throw new Error(`Staff session check failed (status ${response.status})`);
  }
  return { kind: 'ok', session: { me: staffMeSchema.parse(data), token } };
});

/** The current staff session, or null when signed out / rejected by the API. */
export async function getStaffSession(): Promise<StaffSession | null> {
  const result = await lookup();
  return result.kind === 'ok' ? result.session : null;
}

/**
 * Gate for every console page. A 401 from the API goes through `/api/session/expired`, which
 * clears the dead cookie (Server Components cannot) and continues to sign-in.
 */
export async function requireStaffSession(): Promise<StaffSession> {
  const result = await lookup();
  if (result.kind === 'ok') return result.session;
  redirect(result.kind === 'expired' ? '/api/session/expired' : '/sign-in');
}

/** For server-side page fetches: a 401 mid-request means the session just ended. */
export function onUnauthenticated(status: number): void {
  if (status === 401) redirect('/api/session/expired');
}
