import type { ReactNode } from 'react';
import { AppNav } from '@/components/app/app-nav';
import { requireSession } from '@/lib/session';

// Sessions are per-request; never prerender the authenticated area.
export const dynamic = 'force-dynamic';

/**
 * Authenticated area boundary. Everything under (app) requires an ACTIVE session, checked
 * server-side against the API (GET /v1/me). Pending-deletion sessions go to the restricted page.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 pt-28 pb-12 sm:px-6">
      <AppNav />
      {children}
    </div>
  );
}
