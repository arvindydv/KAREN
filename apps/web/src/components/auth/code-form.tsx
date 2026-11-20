'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { bff, hardNavigate } from '@/lib/api';
import { errorMessage, fieldErrors, type ApiErrorBody } from '@/lib/errors';
import { FormAlert, PasswordField, SubmitButton, TextField, formString } from '../forms';
import { localPasswordError, passwordHint } from './sign-up-form';

/**
 * Enter-the-code form for e-mail verification and password reset. The challenge handle lives
 * in an HttpOnly cookie set by the BFF — this component never sees it.
 */
export function CodeForm({ mode }: { mode: 'verify' | 'reset' }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [localError, setLocalError] = useState<string | undefined>();
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const code = formString(form, 'code', '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      setLocalError('Enter the 6-digit code from the e-mail.');
      return;
    }
    let newPassword = '';
    if (mode === 'reset') {
      newPassword = formString(form, 'new_password', '');
      const pwError = localPasswordError(newPassword);
      if (pwError) {
        setLocalError(pwError);
        return;
      }
    }
    setLocalError(undefined);
    setPending(true);
    setError(null);
    const res =
      mode === 'verify'
        ? await bff('/api/auth/verify-email', { method: 'POST', json: { code } })
        : await bff('/api/auth/reset-password', {
            method: 'POST',
            json: { code, new_password: newPassword },
          });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    hardNavigate(`/sign-in?notice=${mode === 'verify' ? 'verified' : 'reset'}`);
  }

  async function resend() {
    setResending(true);
    setError(null);
    setResent(false);
    const res = await bff('/api/auth/resend', { method: 'POST', json: {} });
    setResending(false);
    if (res.ok) setResent(true);
    else setError(res.error);
  }

  const fields = fieldErrors(error);
  const restart = error?.code === 'CHALLENGE_INVALID';
  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
      {error ? (
        <FormAlert>
          {errorMessage(error)}
          {restart ? (
            <>
              {' '}
              <Link
                href={mode === 'verify' ? '/sign-in' : '/forgot-password'}
                className="underline"
              >
                {mode === 'verify' ? 'Sign in to get a new code' : 'Request a new code'}
              </Link>
            </>
          ) : null}
        </FormAlert>
      ) : null}
      {resent ? (
        <FormAlert tone="success">If the code could be sent, a new one is on its way.</FormAlert>
      ) : null}
      <TextField
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        error={mode === 'verify' ? localError : undefined}
      />
      {mode === 'reset' ? (
        <PasswordField
          label="New password"
          name="new_password"
          autoComplete="new-password"
          required
          maxLength={1024}
          hint={passwordHint}
          error={localError ?? fields.new_password}
        />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SubmitButton pending={pending} pendingLabel="Checking…">
          {mode === 'verify' ? 'Verify e-mail' : 'Set new password'}
        </SubmitButton>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resending}
          className="text-sm underline underline-offset-2 disabled:opacity-50"
        >
          {resending ? 'Sending…' : 'Send a new code'}
        </button>
      </div>
    </form>
  );
}
