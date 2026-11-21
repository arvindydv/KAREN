import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useApi } from '../src/auth/services';
import { QueryView } from '../src/components/query-view';
import { Banner, Body, Caption, EmptyState, FormScreen } from '../src/components/primitives';
import { ScreenHeader } from '../src/components/screen-header';
import { unwrap } from '../src/lib/api-error';
import { pickNotice, qk, useNotices } from '../src/lib/queries';

const KINDS = ['privacy_notice', 'terms_of_service', 'ai_disclosure'] as const;
type Kind = (typeof KINDS)[number];
const TITLES: Record<Kind, string> = {
  privacy_notice: 'Privacy Notice',
  terms_of_service: 'Terms of Service',
  ai_disclosure: 'AI disclosure',
};

/** Public notice viewer. Kind/version are public identifiers, safe in the URL. */
export default function NoticeScreen() {
  const api = useApi();
  const params = useLocalSearchParams<{ kind?: string; version?: string }>();
  const kind: Kind = KINDS.includes(params.kind as Kind) ? (params.kind as Kind) : 'privacy_notice';
  const list = useNotices();
  const version =
    params.version ?? (list.data ? pickNotice(list.data.items, kind)?.version : undefined);
  const notice = useQuery({
    queryKey: qk.notice(kind, version ?? ''),
    enabled: Boolean(version),
    queryFn: () =>
      unwrap(
        api.GET('/v1/consent/notices/{kind}/{version}', {
          params: { path: { kind, version: version ?? '' } },
        }),
      ),
  });

  return (
    <FormScreen>
      <ScreenHeader title={TITLES[kind]} />
      {!params.version && !list.isSuccess ? (
        <QueryView query={list}>{() => null}</QueryView>
      ) : !version ? (
        <EmptyState title="This notice isn’t published yet." />
      ) : (
        <QueryView query={notice} loadingLabel="Loading notice">
          {(n) => (
            <>
              {n.state === 'draft' ? (
                <Banner tone="warning">
                  Draft — not legally reviewed. This text is a placeholder for testing.
                </Banner>
              ) : null}
              <Caption>
                Version {n.version} · {n.locale}
                {n.effective_from
                  ? ` · effective ${new Date(n.effective_from).toLocaleDateString()}`
                  : ''}
              </Caption>
              <Body>{n.content}</Body>
            </>
          )}
        </QueryView>
      )}
    </FormScreen>
  );
}
