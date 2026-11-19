import 'server-only';
import type { Permission } from '@karen/api-contracts';
import { redirect } from 'next/navigation';

export interface StaffSession {
  userId: string;
  /** Fetched from the API (`GET /v1/me`), never decoded from a client-held token. */
  permissions: Permission[];
  accessToken: string;
}

/**
 * Server-side staff session boundary. No staff identity provider is configured yet
 * (ADR-0004), so this always redirects to sign-in. Every admin data call must still go
 * through the API, which enforces permissions and writes audit events.
 */
export function getStaffSession(): Promise<StaffSession | null> {
  return Promise.resolve(null);
}

export async function requireStaffSession(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect('/sign-in');
  return session;
}
