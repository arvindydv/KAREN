'use client';

import type {
  ConsentDecisionResult,
  ConsentState,
  LegalStatus,
  PurposeCatalog,
  ReceiptVerification,
} from '@karen/api-contracts';
import { Button, StatusBadge } from '@karen/ui/web';
import { useState } from 'react';
import { bff, newIdempotencyKey } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { FormAlert, Toggle } from '../forms';
import { useAction } from './use-action';

type Purpose = PurposeCatalog['items'][number];

/**
 * Purpose-specific consent switches. Default OFF: nothing is recorded unless the user flips a
 * switch. Purposes that are `not_yet_available` are shown (so users know they exist) but
 * cannot be toggled. Turning a granted purpose off records a revocation.
 */
export function ConsentToggles({
  purposes,
  states,
  noticeVersion,
  source,
  only,
}: {
  purposes: Purpose[];
  states: ConsentState[];
  noticeVersion: string | null;
  source: 'onboarding' | 'settings';
  only?: readonly Purpose['purpose'][];
}) {
  const action = useAction();
  const [local, setLocal] = useState(() => new Map(states.map((s) => [s.purpose, s])));
  const shown = only ? purposes.filter((p) => only.includes(p.purpose)) : purposes;

  async function decide(p: Purpose, on: boolean) {
    if (!noticeVersion) return;
    const current = local.get(p.purpose);
    const decision = on ? 'grant' : current?.decision === 'granted' ? 'revoke' : 'deny';
    const res = await action.run(
      () =>
        bff<ConsentDecisionResult>(`/api/v1/me/consents/${p.purpose}`, {
          method: 'PUT',
          json: { decision, notice_version: noticeVersion, source },
          version: current?.version ?? 0,
          idempotencyKey: newIdempotencyKey(),
        }),
      { successMessage: on ? `${p.title}: allowed.` : `${p.title}: turned off.` },
    );
    if (res.ok) {
      setLocal((m) => {
        const next = new Map(m);
        next.set(res.data.state.purpose, res.data.state);
        return next;
      });
    }
  }

  if (shown.length === 0)
    return <p className="text-sm text-muted">No optional features to configure yet.</p>;
  return (
    <div className="space-y-2">
      {!noticeVersion ? (
        <FormAlert tone="info">
          Consent choices can’t be recorded until a privacy notice is published. Everything stays
          off.
        </FormAlert>
      ) : null}
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      {action.success ? <FormAlert tone="success">{action.success}</FormAlert> : null}
      <div className="divide-y divide-[var(--karen-border)]">
        {shown.map((p) => {
          const available = p.availability === 'available';
          const granted = local.get(p.purpose)?.decision === 'granted';
          return (
            <Toggle
              key={p.purpose}
              label={p.title}
              description={
                <>
                  {p.description}
                  {p.depends_on.length > 0
                    ? ` Requires: ${p.depends_on.map((d) => purposes.find((x) => x.purpose === d)?.title ?? d).join(', ')}.`
                    : ''}
                </>
              }
              checked={granted}
              disabled={!available || !noticeVersion || action.pending}
              onChange={(on) => void decide(p, on)}
              badge={available ? null : <StatusBadge label="Not available yet" />}
            />
          );
        })}
      </div>
    </div>
  );
}

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

export function VerifyReceiptsButton() {
  const [result, setResult] = useState<ReceiptVerification | null>(null);
  const action = useAction();
  async function verify() {
    const res = await action.run(
      () => bff<ReceiptVerification>('/api/v1/me/consents/receipts/verify'),
      { refresh: false },
    );
    if (res.ok) setResult(res.data);
  }
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        onClick={() => void verify()}
        disabled={action.pending}
        aria-busy={action.pending}
      >
        {action.pending ? 'Verifying…' : 'Verify my receipts'}
      </Button>
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      {result ? (
        <FormAlert tone={result.valid ? 'success' : 'danger'}>
          {result.valid
            ? `All ${result.receipts_checked} receipts verified — the chain is intact.`
            : `Verification failed at receipt #${result.first_invalid_seq ?? '?'}. Please contact support.`}
        </FormAlert>
      ) : null}
    </div>
  );
}

export function LegalAcceptance({ items }: { items: LegalStatus['items'] }) {
  const action = useAction();
  return (
    <div className="space-y-3">
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      {action.success ? <FormAlert tone="success">{action.success}</FormAlert> : null}
      <ul className="divide-y divide-[var(--karen-border)]">
        {items.map((it) => (
          <li
            key={it.kind}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {it.kind === 'privacy_notice' ? 'Privacy notice' : 'Terms of service'}
              </p>
              <p className="text-xs text-muted">
                {it.accepted_version
                  ? `Acknowledged version ${it.accepted_version}${it.accepted_at ? ` on ${fmt(it.accepted_at)}` : ''}`
                  : 'Not acknowledged yet'}
                {it.current_version
                  ? ` · current version ${it.current_version}`
                  : ' · no current version published'}
              </p>
            </div>
            {it.up_to_date ? (
              <StatusBadge tone="success" label="Up to date" />
            ) : it.current_version ? (
              <Button
                variant="secondary"
                disabled={action.pending}
                onClick={() =>
                  void action.run(
                    () =>
                      bff('/api/v1/me/legal/acceptances', {
                        method: 'POST',
                        json: { kind: it.kind, version: it.current_version, locale: 'en-IN' },
                      }),
                    { successMessage: 'Thanks — acknowledgement recorded.' },
                  )
                }
              >
                Acknowledge version {it.current_version}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
