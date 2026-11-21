'use client';

import { PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from '@karen/api-contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { bff, hardNavigate } from '@/lib/api';
import { errorMessage, fieldErrors, type ApiErrorBody } from '@/lib/errors';
import { FormAlert, PasswordField, SubmitButton, TextField, formString } from '../forms';

const codePoints = (s: string) => [...s].length;

export const passwordHint = `${PASSWORD_MIN_CODE_POINTS}–${PASSWORD_MAX_CODE_POINTS} characters. No special-character rules — a few unrelated words work well.`;

/** Local length check only for UX; the server's policy is authoritative. */
export function localPasswordError(pw: string): string | undefined {
  const n = codePoints(pw);
  if (n === 0) return 'Enter a password.';
  if (n < PASSWORD_MIN_CODE_POINTS)
    return `Use at least ${PASSWORD_MIN_CODE_POINTS} characters (${n} so far).`;
  if (n > PASSWORD_MAX_CODE_POINTS) return `Use at most ${PASSWORD_MAX_CODE_POINTS} characters.`;
  return undefined;
}

export function SignUpForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [localError, setLocalError] = useState<string | undefined>();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = formString(form, 'password', '');
    const pwError = localPasswordError(password);
    setLocalError(pwError);
    if (pwError) return;
    setPending(true);
    setError(null);
    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timezone = undefined; // the API defaults the timezone; the user can set it in onboarding
    }
    const res = await bff('/api/auth/register', {
      method: 'POST',
      json: {
        email: formString(form, 'email', ''),
        password,
        locale: 'en-IN',
        ...(timezone ? { timezone } : {}),
      },
    });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    hardNavigate('/verify-email');
  }

  const fields = fieldErrors(error);
  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
      {error ? <FormAlert>{errorMessage(error)}</FormAlert> : null}
      <TextField
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={320}
        error={fields.email}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        required
        maxLength={1024}
        hint={passwordHint}
        error={localError ?? fields.password}
      />
      <p className="text-xs text-muted">
        We’ll e-mail you a 6-digit code to confirm the address. KAREN never sends, buys, books or
        shares anything without asking you first.
      </p>
      <SubmitButton pending={pending} pendingLabel="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-sm text-muted">
        Already have an account?{' '}
        <Link href="/sign-in" className="underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
