import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignOutButton } from '@/components/sign-out-button';
import { StepUpProvider } from '@/components/step-up';
import { visibleNav } from '@/lib/navigation';
import { requireStaffSession } from '@/lib/staff-session';

export const dynamic = 'force-dynamic';

/** Protected staff console shell. Navigation is filtered by permission for display only. */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const { me } = await requireStaffSession();
  return (
    <div className="grid min-h-dvh grid-cols-[14rem_1fr]">
      <nav aria-label="Console" className="border-r border-border p-4">
        <p className="mb-4 text-sm font-semibold">KAREN Ops</p>
        <ul className="space-y-1">
          {visibleNav(me.permissions).map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-3 py-2 text-sm hover:bg-surface"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <SignOutButton />
        </div>
      </nav>
      <main className="p-8">
        {/* Audit-friendly convention: every staff screen shows who is acting. */}
        <p className="mb-6 text-xs text-muted" data-testid="acting-identity">
          Acting as {me.display_name} ({me.email}, staff id {me.id}) · roles:{' '}
          {me.roles.join(', ') || 'none'}. All actions are audited.
        </p>
        <StepUpProvider>{children}</StepUpProvider>
      </main>
    </div>
  );
}
