'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { bff, hardNavigate } from '@/lib/api';
import { errorMessage, type ApiErrorBody } from '@/lib/errors';
import { FormAlert, SubmitButton, TextField, formString } from '../forms';

export function ForgotForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await bff('/api/auth/forgot-password', {
      method: 'POST',
      json: { email: formString(form, 'email', '') },
    });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    // Same response whether or not the address has an account (enumeration resistance).
    hardNavigate('/reset-password');
  }

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
      />
      <SubmitButton pending={pending} pendingLabel="Sending…">
        Send reset code
      </SubmitButton>
      <p className="text-sm text-muted">
        Remembered it?{' '}
        <Link href="/sign-in" className="underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
