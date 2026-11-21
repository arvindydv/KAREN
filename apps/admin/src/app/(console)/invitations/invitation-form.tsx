'use client';

import { STAFF_ROLES, type StaffInvitation } from '@karen/api-contracts';
import { Button } from '@karen/ui/web';
import { useState, type FormEvent } from 'react';
import { Field, Input, Notice } from '@/components/fields';
import { useStepUpAction } from '@/components/step-up';
import { bffFetch, describeError } from '@/lib/client/bff-client';
import { formText } from '@/lib/client/form';
import { buildEnrollmentLink } from '@/lib/enrollment';

interface Issued {
  link: string;
  expiresAt: string;
}

export function InvitationForm() {
  const runSensitive = useStepUpAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held in memory only: shown once, gone on navigation or dismissal.
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const roles = form.getAll('roles').map(String);
    if (roles.length === 0) return setError('Choose at least one role.');
    setBusy(true);
    setError(null);
    const result = await runSensitive(() =>
      bffFetch<StaffInvitation>('/api/staff/invitations', {
        body: {
          email: formText(form, 'email'),
          display_name: formText(form, 'displayName'),
          roles,
        },
      }),
    );
    setBusy(false);
    if (!result.ok) return setError(describeError(result));
    formElement.reset();
    setCopied(false);
    setIssued({
      link: buildEnrollmentLink(window.location.origin, result.data.enrollment_token),
      expiresAt: result.data.expires_at,
    });
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.link);
      setCopied(true);
    } catch {
      setError('Copy failed — select the link and copy it manually.');
    }
  };

  if (issued) {
    return (
      <div className="space-y-3">
        <Notice tone="success">
          Invitation created. This link is shown <strong>only once</strong> and expires{' '}
          {issued.expiresAt}.
        </Notice>
        <Notice tone="info">
          Deliver it <strong>out of band</strong> (in person or a verified direct channel) to the
          invitee only. Never paste it into tickets, chat channels or e-mail threads.
        </Notice>
        <Input
          readOnly
          value={issued.link}
          aria-label="Enrollment link"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="flex gap-2">
          <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</Button>
          <Button variant="secondary" onClick={() => setIssued(null)}>
            Done — hide link
          </Button>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Work e-mail">
        <Input name="email" type="email" required maxLength={320} disabled={busy} />
      </Field>
      <Field label="Display name">
        <Input name="displayName" required maxLength={120} disabled={busy} />
      </Field>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Standing roles (least privilege)</legend>
        {STAFF_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="roles" value={role} disabled={busy} /> {role}
          </label>
        ))}
      </fieldset>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create invitation'}
      </Button>
    </form>
  );
}
