import { useState } from 'react';
import { View } from 'react-native';
import { useApi } from '../auth/services';
import {
  Banner,
  Body,
  Caption,
  DeniedState,
  ErrorState,
  LoadingState,
  ToggleRow,
} from '../components/primitives';
import { ApiRequestError, describeError, isDenied, unwrap } from '../lib/api-error';
import {
  idempotencyKey,
  ifMatch,
  pickNotice,
  qk,
  useInvalidate,
  useMyConsents,
  useNotices,
  usePurposes,
} from '../lib/queries';

type Source = 'onboarding' | 'settings' | 'in_context';

/**
 * Purpose-specific consent toggles. Everything defaults OFF (`not_asked` = off). Purposes the
 * catalog marks `not_yet_available` are shown as "Coming later" and are NOT toggleable. Each
 * decision is sent with the privacy-notice version shown, `If-Match` of the purpose version and
 * a fresh Idempotency-Key.
 */
export function ConsentToggles({
  source,
  purposes: only,
}: {
  source: Source;
  /** Restrict to these purposes (onboarding shows only memory & proactivity). */
  purposes?: readonly string[];
}) {
  const api = useApi();
  const invalidate = useInvalidate();
  const catalog = usePurposes();
  const mine = useMyConsents();
  const notices = useNotices();
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ purpose: string; message: string } | null>(null);

  const queries = [catalog, mine, notices];
  if (queries.some((q) => q.isPending)) return <LoadingState label="Loading privacy choices" />;
  const failed = queries.find((q) => q.isError);
  if (failed?.error) {
    if (isDenied(failed.error)) return <DeniedState />;
    return (
      <ErrorState
        message={describeError(failed.error)}
        onRetry={() => queries.forEach((q) => void q.refetch())}
      />
    );
  }
  if (!catalog.data || !mine.data || !notices.data) return null;

  const notice = pickNotice(notices.data.items, 'privacy_notice');
  const states = new Map(mine.data.items.map((s) => [s.purpose, s]));
  const granted = (p: string) => states.get(p as never)?.decision === 'granted';
  const items = catalog.data.items.filter((p) => !only || only.includes(p.purpose));
  const titleOf = (p: string) => catalog.data.items.find((i) => i.purpose === p)?.title ?? p;

  const decide = async (purpose: string, next: boolean) => {
    if (!notice) return;
    const current = states.get(purpose as never);
    const decision = next ? 'grant' : current?.decision === 'granted' ? 'revoke' : 'deny';
    setBusy(purpose);
    setRowError(null);
    try {
      await unwrap(
        api.PUT('/v1/me/consents/{purpose}', {
          params: {
            path: { purpose },
            header: {
              'If-Match': ifMatch(current?.version ?? 0),
              'Idempotency-Key': idempotencyKey(),
            },
          },
          body: { decision, notice_version: notice.version, source },
        }),
      );
    } catch (err) {
      setRowError({ purpose, message: describeError(err) });
      if (!(err instanceof ApiRequestError && err.code === 'PRECONDITION_FAILED')) return;
    } finally {
      setBusy(null);
    }
    // Success (or stale version): reload, because revocations can cascade to dependants.
    await invalidate(qk.consents, qk.consentHistory);
  };

  return (
    <View style={{ gap: 12 }}>
      {!notice ? (
        <Banner tone="warning">
          The privacy notice isn’t available right now, so choices can’t be changed. Try again
          later.
        </Banner>
      ) : notice.state === 'draft' ? (
        <Banner tone="warning">Draft — not legally reviewed. Shown for testing only.</Banner>
      ) : null}
      {items.map((p) => {
        if (p.availability === 'not_yet_available') {
          return (
            <View
              key={p.purpose}
              accessible
              accessibilityLabel={`${p.title}. Coming later.`}
              style={{ gap: 2 }}
            >
              <Body>{p.title}</Body>
              <Caption>{p.description}</Caption>
              <Caption>Coming later — not available to turn on yet.</Caption>
            </View>
          );
        }
        const on = granted(p.purpose);
        const missing = p.depends_on.filter((d) => !granted(d));
        const blocked = !on && missing.length > 0;
        return (
          <View key={p.purpose} style={{ gap: 4 }}>
            <ToggleRow
              label={p.title}
              description={p.description}
              value={on}
              disabled={!notice || busy !== null || blocked}
              {...(blocked
                ? { disabledReason: `Turn on ${missing.map(titleOf).join(', ')} first.` }
                : {})}
              onChange={(next) => void decide(p.purpose, next)}
            />
            {rowError?.purpose === p.purpose ? <ErrorState message={rowError.message} /> : null}
          </View>
        );
      })}
    </View>
  );
}
