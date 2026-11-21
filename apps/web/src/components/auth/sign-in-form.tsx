'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { bff, hardNavigate } from '@/lib/api';
import { errorMessage, type ApiErrorBody } from '@/lib/errors';
import { safeNextPath } from '@/lib/safe-redirect';
import { FormAlert, PasswordField, SubmitButton, TextField, formString } from '../forms';

type LoginResult =
  | { result: 'signed_in'; account_status: string; next: string | null }
  | { result: 'verification_required' };

export function SignInForm({ next, notice }: { next: string | null; notice: string | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await bff<LoginResult>('/api/auth/login', {
      method: 'POST',
      json: { email: formString(form, 'email', ''), password: formString(form, 'password', '') },
    });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    if (res.data.result === 'verification_required') {
      hardNavigate('/verify-email?from=sign-in');
      return;
    }
    // Full navigation so server components pick up the new HttpOnly session cookie.
    hardNavigate(res.data.next ?? safeNextPath(next));
  }

  const resetSuggested = error?.next_options?.includes('RESET_PASSWORD');
  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
      {error ? (
        <FormAlert>
          {errorMessage(error)}
          {resetSuggested ? (
            <>
              {' '}
              <Link href="/forgot-password" className="underline">
                Reset your password
              </Link>
            </>
          ) : null}
        </FormAlert>
      ) : null}
      <TextField
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={320}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        required
        maxLength={1024}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SubmitButton pending={pending} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
        <Link href="/forgot-password" className="text-sm underline underline-offset-2">
          Forgot password?
        </Link>
      </div>
      <p className="text-sm text-muted">
        New to KAREN?{' '}
        <Link href="/sign-up" className="underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </form>
  );
}
