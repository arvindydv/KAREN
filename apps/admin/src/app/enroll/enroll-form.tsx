'use client';

import { Button } from '@karen/ui/web';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, Input, Notice } from '@/components/fields';
import { bffFetch, describeError } from '@/lib/client/bff-client';
import { formText } from '@/lib/client/form';
import { createCredential, describeWebAuthnError } from '@/lib/client/webauthn';
import {
  ENROLL_PATH,
  ENROLL_VERIFY_ENDPOINT,
  enrollmentOptionsRequest,
  passwordProblem,
  readEnrollmentTokenFromHash,
} from '@/lib/enrollment';

type TokenState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'ready'; token: string };

export function EnrollForm() {
  const router = useRouter();
  const [token, setToken] = useState<TokenState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = readEnrollmentTokenFromHash(window.location.hash);
    // Remove the token from the address bar and session history straight away.
    if (window.location.hash) window.history.replaceState(null, '', ENROLL_PATH);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state
    setToken(value ? { kind: 'ready', token: value } : { kind: 'missing' });
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (token.kind !== 'ready') return;
    const form = new FormData(event.currentTarget);
    const name = formText(form, 'keyName').trim();
    const password = formText(form, 'password');
    const confirm = formText(form, 'confirm');
    const problem = passwordProblem(password);
    if (!name) return setError('Name this security key (e.g. "YubiKey 5C").');
    if (problem) return setError(problem);
    if (password !== confirm) return setError('The passwords do not match.');

    setBusy(true);
    setError(null);
    const request = enrollmentOptionsRequest(token.token);
    const options = await bffFetch<{ ceremony_handle: string; options: Record<string, unknown> }>(
      request.url,
      request.init,
    );
    if (!options.ok) {
      setError(
        options.status === 400 || options.status === 404
          ? 'This enrollment link is invalid, expired or already used. Ask a security admin for a new one.'
          : describeError(options),
      );
      setBusy(false);
      return;
    }
    let credential: unknown;
    try {
      credential = await createCredential(options.data.options);
    } catch (cause) {
      setError(describeWebAuthnError(cause));
      setBusy(false);
      return;
    }
    const finish = await bffFetch(ENROLL_VERIFY_ENDPOINT, {
      body: { ceremony_handle: options.data.ceremony_handle, credential, name, password },
    });
    if (!finish.ok) {
      setError(
        finish.error?.code === 'WEAK_PASSWORD'
          ? 'That password is not allowed (too short, too long or too common). Choose another.'
          : describeError(finish),
      );
      setBusy(false);
      return;
    }
    router.replace('/sign-in?enrolled=1');
  };

  if (token.kind === 'loading') return <p className="mt-6 text-sm text-muted">Loading…</p>;
  if (token.kind === 'missing') {
    return (
      <div className="mt-6">
        <Notice tone="error">
          This page needs the full enrollment link you were given (including the part after “#”).
          Ask a security admin for a new link if you do not have it.
        </Notice>
      </div>
    );
  }
  return (
    <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Security key name" hint="Plain text, e.g. “YubiKey 5C (desk)”.">
        <Input name="keyName" maxLength={64} required disabled={busy} />
      </Field>
      <Field label="New password" hint="15–256 characters. A long passphrase is best.">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={15}
          maxLength={1024}
          required
          disabled={busy}
        />
      </Field>
      <Field label="Confirm password">
        <Input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          disabled={busy}
        />
      </Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Waiting for security key…' : 'Register security key'}
      </Button>
    </form>
  );
}
