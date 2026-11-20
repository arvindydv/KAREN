'use client';

import { STAFF_ROLES } from '@karen/api-contracts';
import { Button } from '@karen/ui/web';
import { useState, type FormEvent } from 'react';
import { Field, Input, Notice, Select, TextArea } from '@/components/fields';
import { useStepUpAction } from '@/components/step-up';
import { bffFetch, describeError } from '@/lib/client/bff-client';
import { formText } from '@/lib/client/form';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function StaffAccountActions() {
  const runSensitive = useStepUpAction();
  const [staffId, setStaffId] = useState('');
  const [role, setRole] = useState<string>(STAFF_ROLES[0]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const run = async (label: string, path: string, method: string, body?: unknown) => {
    const id = staffId.trim();
    if (!UUID.test(id)) {
      return setNotice({ tone: 'error', text: 'Enter a valid staff account id (UUID).' });
    }
    setBusy(true);
    setNotice(null);
    const result = await runSensitive(() =>
      bffFetch(`/api/staff/accounts/${encodeURIComponent(id)}/${path}`, { method, body }),
    );
    setBusy(false);
    setNotice(
      result.ok
        ? { tone: 'success', text: `${label}: done.` }
        : { tone: 'error', text: describeError(result) },
    );
  };

  const roleAction = (grant: boolean) =>
    void run(
      grant ? `Grant ${role}` : `Revoke ${role}`,
      `roles/${encodeURIComponent(role)}`,
      grant ? 'PUT' : 'DELETE',
    );

  const disable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = formText(new FormData(event.currentTarget), 'reason').trim();
    if (reason.length < 10) {
      return setNotice({ tone: 'error', text: 'Give a reason of at least 10 characters.' });
    }
    void run('Disable account', 'disable', 'POST', { reason });
  };

  return (
    <div className="space-y-6">
      <Field label="Staff account id">
        <Input
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          placeholder="00000000-0000-4000-8000-000000000000"
          disabled={busy}
        />
      </Field>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
            {STAFF_ROLES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => roleAction(true)} disabled={busy}>
          Grant role
        </Button>
        <Button variant="secondary" onClick={() => roleAction(false)} disabled={busy}>
          Revoke role
        </Button>
      </div>

      <form className="space-y-2" onSubmit={disable}>
        <Field label="Disable account — reason" hint="10–300 characters. Ends all their sessions.">
          <TextArea name="reason" rows={2} minLength={10} maxLength={300} disabled={busy} />
        </Field>
        <Button type="submit" variant="danger" disabled={busy}>
          Disable account
        </Button>
      </form>

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
    </div>
  );
}
