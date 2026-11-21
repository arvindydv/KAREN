'use client';

import type { DataRightsRequest } from '@karen/api-contracts';
import { Button, StatusBadge, type StatusTone } from '@karen/ui/web';
import { useState, type FormEvent } from 'react';
import { bff, hardNavigate } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { FormAlert, PasswordField, SubmitButton, formString } from '../forms';
import { EmptyState } from './states';
import { useAction } from './use-action';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

const STATUS_TONE: Record<DataRightsRequest['status'], StatusTone> = {
  requested: 'neutral',
  scheduled: 'warning',
  processing: 'neutral',
  ready: 'success',
  completed: 'success',
  cancelled: 'neutral',
  failed: 'danger',
  expired: 'neutral',
};

export function DataRequestsList({ items }: { items: DataRightsRequest[] }) {
  if (items.length === 0) return <EmptyState>No export or deletion requests yet.</EmptyState>;
  return (
    <ul className="divide-y divide-[var(--karen-border)]">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 font-medium">
              {r.kind === 'export' ? 'Data export' : 'Account deletion'}
              <StatusBadge tone={STATUS_TONE[r.status]} label={r.status} />
            </p>
            <p className="text-xs text-muted">
              Requested {fmt(r.requested_at)}
              {r.scheduled_for ? ` · scheduled for ${fmt(r.scheduled_for)}` : ''}
              {r.expires_at ? ` · link expires ${fmt(r.expires_at)}` : ''}
            </p>
          </div>
          {r.kind === 'export' && r.download_available ? (
            <a
              href={`/api/v1/me/data-rights/${r.id}/download`}
              download
              className="landing-btn-ghost h-10 !px-4 !py-0 text-sm"
            >
              Download (JSON)
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ExportButton({ hasOpenExport }: { hasOpenExport: boolean }) {
  const action = useAction();
  return (
    <div className="space-y-2">
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      {action.success ? <FormAlert tone="success">{action.success}</FormAlert> : null}
      <Button
        variant="secondary"
        disabled={action.pending || hasOpenExport}
        aria-busy={action.pending}
        onClick={() =>
          void action.run(() => bff('/api/v1/me/data-rights/export', { method: 'POST' }), {
            successMessage:
              'Export requested. We’ll prepare it — check back here for the download.',
          })
        }
      >
        {hasOpenExport
          ? 'Export in progress'
          : action.pending
            ? 'Requesting…'
            : 'Request a copy of my data'}
      </Button>
    </div>
  );
}

export function DeletionForm() {
  const action = useAction();
  const [confirmed, setConfirmed] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmed) return;
    const f = new FormData(e.currentTarget);
    const res = await action.run(
      () =>
        bff<DataRightsRequest>('/api/v1/me/data-rights/deletion', {
          method: 'POST',
          json: { current_password: formString(f, 'current_password', ''), confirm: true },
        }),
      { refresh: false },
    );
    if (res.ok) hardNavigate('/app/deletion-scheduled');
  }
  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
      <div className="space-y-2 text-sm text-muted">
        <p>
          <strong className="text-foreground">What happens:</strong> your account is scheduled for
          deletion and you can cancel during the waiting period shown after you confirm. Until then
          you can only view or cancel the deletion, or sign out.
        </p>
        <p>
          <strong className="text-foreground">What is kept:</strong> some records may be retained
          where the law or security requires it (for example audit and consent records). The exact
          categories and reasons are listed on the request once it is scheduled.
        </p>
        <p>Consider downloading a copy of your data first.</p>
      </div>
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      <PasswordField
        label="Current password"
        name="current_password"
        autoComplete="current-password"
        required
        maxLength={1024}
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--karen-danger)]"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          required
        />
        I understand my account and data will be deleted after the waiting period.
      </label>
      <SubmitButton pending={action.pending} pendingLabel="Scheduling…" variant="danger">
        Delete my account
      </SubmitButton>
    </form>
  );
}
