import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { useApi } from '../../../src/auth/services';
import {
  Banner,
  Caption,
  EmptyState,
  ErrorState,
  FormScreen,
  GlassCard,
  Body,
  SecondaryButton,
} from '../../../src/components/primitives';
import { QueryView } from '../../../src/components/query-view';
import { ScreenHeader } from '../../../src/components/screen-header';
import { describeError, unwrap } from '../../../src/lib/api-error';
import { useConsentHistory, usePurposes } from '../../../src/lib/queries';

const DECISION = { granted: 'Turned on', denied: 'Declined', revoked: 'Turned off' } as const;

export default function ConsentHistoryScreen() {
  const api = useApi();
  const history = useConsentHistory();
  const purposes = usePurposes();
  const verify = useQuery({
    queryKey: ['me', 'consents', 'verify'],
    enabled: false,
    retry: false,
    queryFn: () => unwrap(api.GET('/v1/me/consents/receipts/verify')),
  });
  const title = (p: string) => purposes.data?.items.find((i) => i.purpose === p)?.title ?? p;

  return (
    <FormScreen>
      <ScreenHeader title="Consent history" />
      <SecondaryButton
        label={verify.isFetching ? 'Checking…' : 'Verify my receipts'}
        hint="Checks the receipt chain hasn’t been altered"
        disabled={verify.isFetching}
        onPress={() => void verify.refetch()}
      />
      {verify.data ? (
        verify.data.valid ? (
          <Banner tone="success">
            All {verify.data.receipts_checked} receipts verified — the history is intact.
          </Banner>
        ) : (
          <Banner tone="warning">
            Verification failed at receipt #{verify.data.first_invalid_seq ?? '?'}. Please contact
            support.
          </Banner>
        )
      ) : null}
      {verify.isError ? <ErrorState message={describeError(verify.error)} /> : null}
      <QueryView query={history} loadingLabel="Loading history">
        {(h) =>
          h.items.length === 0 ? (
            <EmptyState
              title="No decisions yet."
              message="Choices you make in Privacy appear here."
            />
          ) : (
            <View style={{ gap: 10 }}>
              {h.items.map((r) => (
                <GlassCard key={r.id} style={{ gap: 4 }}>
                  <Body>
                    {title(r.purpose)}: {DECISION[r.decision]}
                  </Body>
                  <Caption>
                    #{r.seq} · {new Date(r.occurred_at).toLocaleString()} · notice v
                    {r.notice_version} · via {r.source}
                    {r.method.startsWith('cascade:')
                      ? ' · automatically, because a required choice was turned off'
                      : ''}
                  </Caption>
                </GlassCard>
              ))}
              {h.next_cursor ? <Caption>Showing the most recent decisions.</Caption> : null}
            </View>
          )
        }
      </QueryView>
    </FormScreen>
  );
}
