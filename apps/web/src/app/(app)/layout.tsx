import type { ReactNode } from 'react';

// Sessions are per-request; never prerender the authenticated area.
export const dynamic = 'force-dynamic';
import { requireSession } from '@/lib/session';

/** Authenticated area boundary. Everything under (app) requires a session (server-side). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <div className="space-y-6">{children}</div>;
}
