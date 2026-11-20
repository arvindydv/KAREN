import type { ReactNode } from 'react';

// Sessions are per-request; never prerender the authenticated area.
export const dynamic = 'force-dynamic';
import { requireSession } from '@/lib/session';

/** Authenticated area boundary. Everything under (app) requires a session (server-side). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <div className="mx-auto max-w-5xl space-y-6 px-6 pt-28 pb-12">{children}</div>;
}
