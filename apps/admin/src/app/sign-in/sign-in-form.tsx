'use client';

import { Button } from '@karen/ui/web';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, Input, Notice } from '@/components/fields';
import { bffFetch, describeError } from '@/lib/client/bff-client';
import { formText } from '@/lib/client/form';
import { describeWebAuthnError, getAssertion } from '@/lib/client/webauthn';

type Phase = 'idle' | 'password' | 'key' | 'finishing';

/** Password + security key on EVERY sign-in (ADR-0017). No OTP or e-mail fallback. */
export function SignInForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = formText(form, 'email');
    const password = formText(form, 'password');
    setError(null);
    setPhase('password');
    const start = await bffFetch<{ ceremony_handle: string; options: Record<string, unknown> }>(
      '/api/session/login/options',
      { body: { email, password } },
    );
    if (!start.ok) {
      setError(
        start.error?.code === 'INVALID_CREDENTIALS'
          ? 'E-mail or password is incorrect.'
          : describeError(start),
      );
      setPhase('idle');
      return;
    }
    setPhase('key');
    let credential: unknown;
    try {
      credential = await getAssertion(start.data.options);
    } catch (cause) {
      setError(describeWebAuthnError(cause));
      setPhase('idle');
      return;
    }
    setPhase('finishing');
    const finish = await bffFetch('/api/session/login/verify', {
      body: { ceremony_handle: start.data.ceremony_handle, credential },
    });
    if (!finish.ok) {
      setError(
        finish.error?.code === 'CHALLENGE_INVALID'
          ? 'The sign-in attempt expired. Start again.'
          : describeError(finish),
      );
      setPhase('idle');
      return;
    }
    router.replace('/account');
    router.refresh();
  };

  const busy = phase !== 'idle';
  return (
    <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Work e-mail">
        <Input
          name="email"
          type="email"
          autoComplete="username webauthn"
          required
          disabled={busy}
        />
      </Field>
      <Field label="Password">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={busy}
        />
      </Field>
      {phase === 'key' ? (
        <Notice tone="info">Touch your security key to finish signing in.</Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Signing in…' : 'Sign in with security key'}
      </Button>
    </form>
  );
}
