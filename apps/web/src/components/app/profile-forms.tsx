'use client';

import type { EmailChanged, Profile, ProfilePatch } from '@karen/api-contracts';
import { Button } from '@karen/ui/web';
import { useState, type FormEvent } from 'react';
import { bff } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import {
  FormAlert,
  PasswordField,
  SelectField,
  SubmitButton,
  TextField,
  formString,
} from '../forms';
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS, LOCALE_OPTIONS } from './options';
import { useAction } from './use-action';

const orNull = (v: FormDataEntryValue | null): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
};

export function ProfileForm({
  profile,
  timezones,
}: {
  profile: Profile;
  timezones: { value: string; label: string }[];
}) {
  const action = useAction();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch: ProfilePatch = {
      display_name: orNull(f.get('display_name')),
      preferred_name: orNull(f.get('preferred_name')),
      locale: formString(f, 'locale') as Profile['locale'],
      timezone: formString(f, 'timezone'),
      country: orNull(f.get('country')),
      currency: orNull(f.get('currency')),
    };
    await action.run(
      () =>
        bff<Profile>('/api/v1/me/profile', {
          method: 'PATCH',
          json: patch,
          version: profile.version,
        }),
      { successMessage: 'Profile saved.' },
    );
  }
  const fields = fieldErrors(action.error);
  // `key` on version: a refreshed profile (e.g. after 412) resets the uncontrolled inputs.
  return (
    <form
      method="post"
      key={profile.version}
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-4"
      noValidate
    >
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      {action.success ? <FormAlert tone="success">{action.success}</FormAlert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Full name"
          name="display_name"
          defaultValue={profile.display_name ?? ''}
          maxLength={120}
          autoComplete="name"
          error={fields.display_name}
        />
        <TextField
          label="What should KAREN call you?"
          name="preferred_name"
          defaultValue={profile.preferred_name ?? ''}
          maxLength={60}
          autoComplete="nickname"
          error={fields.preferred_name}
        />
        <SelectField
          label="Language & region"
          name="locale"
          defaultValue={profile.locale}
          options={LOCALE_OPTIONS}
        />
        <SelectField
          label="Time zone"
          name="timezone"
          defaultValue={profile.timezone}
          options={timezones}
        />
        <SelectField
          label="Country"
          name="country"
          defaultValue={profile.country ?? ''}
          options={COUNTRY_OPTIONS}
        />
        <SelectField
          label="Currency"
          name="currency"
          defaultValue={profile.currency ?? ''}
          options={CURRENCY_OPTIONS}
        />
      </div>
      <SubmitButton pending={action.pending} pendingLabel="Saving…">
        Save profile
      </SubmitButton>
    </form>
  );
}

/** Two-step e-mail change: password + new address → code sent to the NEW address → confirm. */
export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const action = useAction();
  // The handle is bound to this session server-side; kept only in memory, never in the URL.
  const [handle, setHandle] = useState<string | null>(null);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await action.run(
      () =>
        bff<{ challenge_handle: string }>('/api/v1/me/email-change', {
          method: 'POST',
          json: {
            new_email: formString(f, 'new_email', ''),
            current_password: formString(f, 'current_password', ''),
          },
        }),
      { refresh: false },
    );
    if (res.ok) setHandle(res.data.challenge_handle);
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await action.run(
      () =>
        bff<EmailChanged>('/api/v1/me/email-change/confirm', {
          method: 'POST',
          json: { challenge_handle: handle, code: formString(f, 'code', '').trim() },
        }),
      { successMessage: 'Your e-mail address was changed.' },
    );
    if (res.ok) setHandle(null);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Current address: <span className="font-medium text-foreground">{currentEmail}</span>
      </p>
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      {action.success ? <FormAlert tone="success">{action.success}</FormAlert> : null}
      {handle ? (
        <form method="post" onSubmit={(e) => void confirm(e)} className="space-y-4" noValidate>
          <FormAlert tone="info">
            If the new address can receive mail, we sent it a 6-digit code.
          </FormAlert>
          <TextField
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
          <div className="flex flex-wrap gap-3">
            <SubmitButton pending={action.pending} pendingLabel="Confirming…">
              Confirm new e-mail
            </SubmitButton>
            <Button variant="ghost" onClick={() => setHandle(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <form method="post" onSubmit={(e) => void start(e)} className="space-y-4" noValidate>
          <TextField
            label="New e-mail"
            name="new_email"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
          />
          <PasswordField
            label="Current password"
            name="current_password"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
          <SubmitButton pending={action.pending} pendingLabel="Sending code…" variant="secondary">
            Change e-mail
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
