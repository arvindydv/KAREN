import 'server-only';
import { redirect } from 'next/navigation';

export interface Session {
  userId: string;
}

/**
 * Server-side session boundary for the authenticated area. The OIDC provider is not chosen
 * yet (ADR-0004), so there is no session source and this always redirects. Authorisation is
 * still enforced by the API on every request; this only controls navigation.
 */
export function getSession(): Promise<Session | null> {
  return Promise.resolve(null);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  return session;
}
