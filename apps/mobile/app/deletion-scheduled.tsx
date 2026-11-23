import { Redirect } from 'expo-router';
import { useCallback } from 'react';
import { useServices } from '../src/auth/services';
import { QueryView } from '../src/components/query-view';
import {
  Banner,
  Body,
  ErrorState,
  FormScreen,
  Heading,
  PrimaryButton,
  SecondaryButton,
} from '../src/components/primitives';
import { describeError, unwrap } from '../src/lib/api-error';
import { qk, useDataRights, useInvalidate } from '../src/lib/queries';
import { useSubmit } from '../src/lib/use-submit';
import { useSessionStore } from '../src/state/session-store';
import { formatDateTime } from '../src/lib/format';

/**
 * Restricted session for an account in DELETION_REQUESTED: the server allows only viewing /
 * cancelling the deletion and signing out. Everything else would return ACCOUNT_INACTIVE.
 */
export default function DeletionScheduledScreen() {
  const status = useSessionStore((s) => s.status);
  const account = useSessionStore((s) => s.accountStatus);
  if (status === 'signed_out') return <Redirect href="/" />;
  if (status === 'signed_in' && account !== 'DELETION_REQUESTED')
    return <Redirect href="/chat/new" />;
  return <DeletionScheduledView />;
}

export function DeletionScheduledView() {
  const { api, session } = useServices();
  const invalidate = useInvalidate();
  const rights = useDataRights();
  const pending = rights.data?.items.find(
    (r) => r.kind === 'deletion' && (r.status === 'scheduled' || r.status === 'requested'),
  );

  const cancel = useSubmit(
    useCallback(async () => {
      if (!pending) return;
      await unwrap(
        api.POST('/v1/me/data-rights/{id}/cancel', { params: { path: { id: pending.id } } }),
      );
      await invalidate(qk.dataRights);
      await session.setAccountStatus('ACTIVE');
    }, [api, invalidate, pending, session]),
  );
  const signOut = useSubmit(useCallback(() => session.logout(), [session]));

  return (
    <FormScreen>
      <Heading>Deletion scheduled</Heading>
      <QueryView query={rights} loadingLabel="Loading deletion request">
        {() =>
          pending ? (
            <>
              <Body>
                Your account and data are scheduled to be deleted
                {pending.scheduled_for ? ` on ${formatDateTime(pending.scheduled_for)}` : ''}. Until
                then you can cancel and keep your account.
              </Body>
              {pending.retention_exceptions.length > 0 ? (
                <Banner>
                  Kept after deletion:{' '}
                  {pending.retention_exceptions
                    .map((e) => `${e.category} (${e.reason})`)
                    .join('; ')}
                </Banner>
              ) : null}
              {cancel.error ? <ErrorState message={describeError(cancel.error)} /> : null}
              <PrimaryButton
                label={cancel.busy ? 'Cancelling…' : 'Cancel deletion'}
                hint="Keeps your account and restores full access"
                disabled={cancel.busy}
                onPress={() => cancel.run()}
              />
            </>
          ) : (
            <Body muted>
              We couldn’t find an open deletion request. It may already be complete or cancelled.
              Sign out and sign in again to refresh.
            </Body>
          )
        }
      </QueryView>
      <SecondaryButton label="Sign out" disabled={signOut.busy} onPress={() => signOut.run()} />
    </FormScreen>
  );
}
