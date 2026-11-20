'use client';

import { STAFF_ROLES } from '@karen/api-contracts';
import { Button } from '@karen/ui/web';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, Input, Notice, Select, TextArea } from '@/components/fields';
import { useStepUpAction } from '@/components/step-up';
import { bffFetch, describeError } from '@/lib/client/bff-client';
import { formText } from '@/lib/client/form';

export function ElevationRequestForm() {
  const router = useRouter();
  const runSensitive = useStepUpAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const reason = formText(form, 'reason').trim();
    const duration = Number(form.get('duration'));
    if (reason.length < 10) return setError('Give a reason of at least 10 characters.');
    if (!Number.isInteger(duration) || duration < 5 || duration > 240) {
      return setError('Duration must be a whole number of minutes between 5 and 240.');
    }
    setBusy(true);
    setError(null);
    setDone(false);
    const result = await runSensitive(() =>
      bffFetch('/api/staff/elevations', {
        body: {
          role: formText(form, 'role'),
          reason,
          ticket_ref: formText(form, 'ticket').trim(),
          duration_minutes: duration,
        },
      }),
    );
    setBusy(false);
    if (!result.ok) return setError(describeError(result));
    formElement.reset();
    setDone(true);
    router.refresh();
  };

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Role">
        <Select name="role" disabled={busy} defaultValue={STAFF_ROLES[0]}>
          {STAFF_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Duration (minutes)" hint="5–240">
        <Input
          name="duration"
          type="number"
          min={5}
          max={240}
          defaultValue={30}
          required
          disabled={busy}
        />
      </Field>
      <Field label="Ticket reference" hint="e.g. OPS-1234">
        <Input name="ticket" required pattern="[A-Za-z0-9._#\-]{3,64}" disabled={busy} />
      </Field>
      <Field label="Reason" hint="At least 10 characters. Recorded in the audit log.">
        <TextArea name="reason" required minLength={10} maxLength={500} rows={2} disabled={busy} />
      </Field>
      <div className="md:col-span-2 space-y-2">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {done ? <Notice tone="success">Elevation requested; awaiting approval.</Notice> : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Requesting…' : 'Request elevation'}
        </Button>
      </div>
    </form>
  );
}
