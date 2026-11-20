import type { DataRightsList } from '@karen/api-contracts';
import { Card } from '@karen/ui/web';
import { CancelDeletionButton } from '@/components/app/cancel-deletion';
import { SignOutButton } from '@/components/app/sign-out-button';
import { LoadError } from '@/components/app/states';
import { serverGet } from '@/lib/server-api';
import { requireDeletionPendingSession } from '@/lib/session';

export const metadata = { title: 'Deletion scheduled' };
export const dynamic = 'force-dynamic';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));

/**
 * Restricted page for accounts with a pending deletion: the API allows only viewing/cancelling
 * the deletion and signing out (@AllowDeletionPending). Lives outside the (app) layout, which
 * requires an ACTIVE session.
 */
export default async function DeletionScheduledPage() {
  const { token } = await requireDeletionPendingSession();
  const rights = await serverGet<DataRightsList>('v1/me/data-rights', token);
  const pending = rights.ok
    ? rights.data.items.find(
        (r) => r.kind === 'deletion' && ['requested', 'scheduled'].includes(r.status),
      )
    : undefined;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-28 pb-12 sm:px-6">
      <Card className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold">Your account is scheduled for deletion</h1>
        {!rights.ok ? <LoadError what="your deletion request" error={rights.error} /> : null}
        {pending ? (
          <>
            <p className="text-sm text-muted">
              {pending.scheduled_for
                ? `It will be deleted on ${fmt(pending.scheduled_for)}. Until then you can cancel and keep using KAREN.`
                : 'You can cancel the deletion and keep using KAREN until it starts.'}
            </p>
            {pending.retention_exceptions.length > 0 ? (
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Kept after deletion</h2>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                  {pending.retention_exceptions.map((r) => (
                    <li key={r.category}>
                      <span className="font-medium text-foreground">{r.category}</span> — {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <CancelDeletionButton requestId={pending.id} />
              <SignOutButton />
            </div>
          </>
        ) : rights.ok ? (
          <>
            <p className="text-sm text-muted">
              We couldn’t find an open deletion request. It may already be processing.
            </p>
            <SignOutButton />
          </>
        ) : (
          <SignOutButton />
        )}
      </Card>
    </div>
  );
}
