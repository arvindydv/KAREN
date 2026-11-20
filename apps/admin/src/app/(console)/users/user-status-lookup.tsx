'use client';

import type { UserStatusLookup as Lookup } from '@karen/api-contracts';
import { Button } from '@karen/ui/web';
import { useState, type FormEvent } from 'react';
import { Field, Input, Notice, TextArea } from '@/components/fields';
import { bffFetch, describeError } from '@/lib/client/bff-client';
import { formText } from '@/lib/client/form';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- mirrors the API's "no control characters" rule
const REASON = /^[^\u0000-\u001f\u007f-\u009f]{10,300}$/;

export function UserStatusLookup() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Lookup | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = formText(form, 'userId').trim();
    const reason = formText(form, 'reason').trim();
    if (!UUID.test(userId)) return setError('Enter a valid user id (UUID).');
    if (!REASON.test(reason)) return setError('An access reason of 10–300 characters is required.');
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await bffFetch<Lookup>(
      `/api/staff/users/${encodeURIComponent(userId)}/status`,
      {
        method: 'GET',
        headers: { 'x-access-reason': reason },
      },
    );
    setBusy(false);
    if (!response.ok) {
      return setError(
        response.status === 404 ? 'No account with that id.' : describeError(response),
      );
    }
    setResult(response.data);
  };

  return (
    <div className="space-y-4">
      <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
        <Field label="User id">
          <Input name="userId" required disabled={busy} />
        </Field>
        <Field
          label="Access reason"
          hint="Mandatory (10–300 characters), e.g. the support ticket and why."
        >
          <TextArea
            name="reason"
            required
            minLength={10}
            maxLength={300}
            rows={2}
            disabled={busy}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? 'Looking up…' : 'Look up status'}
        </Button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        <Notice tone="info">
          <dl className="grid grid-cols-[8rem_1fr] gap-1">
            <dt className="text-muted">User id</dt>
            <dd className="font-mono">{result.user_id}</dd>
            <dt className="text-muted">Status</dt>
            <dd>{result.status}</dd>
            <dt className="text-muted">Created</dt>
            <dd>{result.created_at}</dd>
          </dl>
        </Notice>
      ) : null}
    </div>
  );
}
