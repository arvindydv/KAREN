'use client';

import { Button } from '@karen/ui/web';
import { bff, hardNavigate } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { FormAlert } from '../forms';
import { useAction } from './use-action';

export function CancelDeletionButton({ requestId }: { requestId: string }) {
  const action = useAction();
  async function cancel() {
    const res = await action.run(
      () => bff(`/api/v1/me/data-rights/${requestId}/cancel`, { method: 'POST' }),
      { refresh: false },
    );
    if (res.ok) hardNavigate('/app');
  }
  return (
    <div className="space-y-2">
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      <Button onClick={() => void cancel()} disabled={action.pending} aria-busy={action.pending}>
        {action.pending ? 'Cancelling…' : 'Cancel deletion and keep my account'}
      </Button>
    </div>
  );
}
