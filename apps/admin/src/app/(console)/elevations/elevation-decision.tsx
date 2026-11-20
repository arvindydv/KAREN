'use client';

import { Button } from '@karen/ui/web';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useStepUpAction } from '@/components/step-up';
import { bffFetch, describeError } from '@/lib/client/bff-client';

/**
 * Approve/reject a pending elevation. Approve is hidden for your own request as a UX nicety;
 * the API (and a DB CHECK) enforce that approver ≠ requester regardless.
 */
export function ElevationDecision({ id, ownRequest }: { id: string; ownRequest: boolean }) {
  const router = useRouter();
  const runSensitive = useStepUpAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    const result = await runSensitive(() =>
      bffFetch(`/api/staff/elevations/${encodeURIComponent(id)}/decision`, { body: { decision } }),
    );
    setBusy(false);
    if (!result.ok) return setError(describeError(result));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {ownRequest ? (
          <span className="text-xs text-muted">Needs another admin</span>
        ) : (
          <Button onClick={() => void decide('approve')} disabled={busy}>
            Approve
          </Button>
        )}
        <Button variant="secondary" onClick={() => void decide('reject')} disabled={busy}>
          Reject
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-[var(--karen-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
