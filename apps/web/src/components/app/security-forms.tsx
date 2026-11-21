'use client';

import type { DeviceList, PasswordChanged, SessionList } from '@karen/api-contracts';
import { Button, StatusBadge } from '@karen/ui/web';
import { useState, type FormEvent } from 'react';
import { bff } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { FormAlert, PasswordField, SubmitButton, formString } from '../forms';
import { localPasswordError, passwordHint } from '../auth/sign-up-form';
import { EmptyState } from './states';
import { useAction } from './use-action';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

const clientLabel = { web: 'Web browser', ios: 'iPhone / iPad', android: 'Android' } as const;

export function PasswordChangeForm() {
  const action = useAction();
  const [localError, setLocalError] = useState<string | undefined>();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const next = formString(f, 'new_password', '');
    const err = localPasswordError(next);
    setLocalError(err);
    if (err) return;
    const res = await action.run(() =>
      bff<PasswordChanged>('/api/v1/me/password', {
        method: 'POST',
        json: { current_password: formString(f, 'current_password', ''), new_password: next },
      }),
    );
    if (res.ok) {
      form.reset();
      action.setSuccess(
        `Password changed. ${res.data.revoked_sessions} other session${res.data.revoked_sessions === 1 ? '' : 's'} signed out.`,
      );
    }
  }
  const fields = fieldErrors(action.error);
  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      {action.success ? <FormAlert tone="success">{action.success}</FormAlert> : null}
      <PasswordField
        label="Current password"
        name="current_password"
        autoComplete="current-password"
        required
        maxLength={1024}
      />
      <PasswordField
        label="New password"
        name="new_password"
        autoComplete="new-password"
        required
        maxLength={1024}
        hint={passwordHint}
        error={localError ?? fields.new_password}
      />
      <SubmitButton pending={action.pending} pendingLabel="Changing…">
        Change password
      </SubmitButton>
    </form>
  );
}

export function SessionsList({ sessions }: { sessions: SessionList['items'] }) {
  const action = useAction();
  if (sessions.length === 0) return <EmptyState>No active sessions.</EmptyState>;
  return (
    <div className="space-y-3">
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      <ul className="divide-y divide-[var(--karen-border)]">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="space-y-0.5 text-sm">
              <p className="flex items-center gap-2 font-medium">
                {s.device_name ?? clientLabel[s.client]}
                {s.current ? <StatusBadge tone="success" label="This session" /> : null}
              </p>
              <p className="text-xs text-muted">
                Signed in {fmt(s.created_at)} · last active {fmt(s.last_seen_at)} · expires{' '}
                {fmt(s.expires_at)}
              </p>
            </div>
            {s.current ? null : (
              <Button
                variant="secondary"
                disabled={action.pending}
                onClick={() =>
                  void action.run(() => bff(`/api/v1/me/sessions/${s.id}`, { method: 'DELETE' }))
                }
                aria-label={`Sign out session started ${fmt(s.created_at)}`}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DevicesList({ devices }: { devices: DeviceList['items'] }) {
  const action = useAction();
  if (devices.length === 0) return <EmptyState>No devices yet.</EmptyState>;
  return (
    <div className="space-y-3">
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      <ul className="divide-y divide-[var(--karen-border)]">
        {devices.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="space-y-0.5 text-sm">
              <p className="flex items-center gap-2 font-medium">
                {d.name ?? clientLabel[d.platform]}
                {d.current ? <StatusBadge tone="success" label="This device" /> : null}
              </p>
              <p className="text-xs text-muted">
                First seen {fmt(d.first_seen_at)} · last seen {fmt(d.last_seen_at)} ·{' '}
                {d.active_sessions} active session
                {d.active_sessions === 1 ? '' : 's'}
              </p>
            </div>
            {d.current ? null : (
              <Button
                variant="secondary"
                disabled={action.pending}
                onClick={() =>
                  void action.run(() => bff(`/api/v1/me/devices/${d.id}`, { method: 'DELETE' }))
                }
                aria-label={`Remove device ${d.name ?? clientLabel[d.platform]}`}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
