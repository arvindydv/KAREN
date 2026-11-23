import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useApi } from '../auth/services';
import {
  Banner,
  Body,
  Caption,
  DeniedState,
  ErrorState,
  LinkRow,
  ListCard,
  LoadingState,
  Pill,
  SecondaryButton,
  TextButton,
} from '../components/primitives';
import { describeError, isDenied, unwrap } from '../lib/api-error';
import { pickNotice, qk, useLegal, useNotices } from '../lib/queries';
import { formatDate } from '../../src/lib/format';

const LABEL = { privacy_notice: 'Privacy Notice', terms_of_service: 'Terms of Service' } as const;

/** Legal documents with read links and versioned acceptance (Privacy Notice + Terms). */
export function LegalDocuments() {
  const api = useApi();
  const router = useRouter();
  const client = useQueryClient();
  const legal = useLegal();
  const notices = useNotices();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (legal.isPending || notices.isPending) return <LoadingState label="Loading legal documents" />;
  const failed = legal.error ?? notices.error;
  if (failed || !legal.data || !notices.data) {
    if (isDenied(failed)) return <DeniedState />;
    return (
      <ErrorState
        message={describeError(failed)}
        onRetry={() => {
          void legal.refetch();
          void notices.refetch();
        }}
      />
    );
  }

  const accept = async (
    kind: 'privacy_notice' | 'terms_of_service',
    version: string,
    locale: 'en-IN' | 'hi-IN',
  ) => {
    setBusy(kind);
    setError(null);
    try {
      const status = await unwrap(
        api.POST('/v1/me/legal/acceptances', { body: { kind, version, locale } }),
      );
      client.setQueryData(qk.legal, status);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const anyDraft = notices.data.items.some((n) => n.state === 'draft');
  const ai = pickNotice(notices.data.items, 'ai_disclosure');
  return (
    <View style={{ gap: 12 }}>
      {anyDraft ? (
        <Banner tone="warning">
          Draft — not legally reviewed. These notices are placeholders.
        </Banner>
      ) : null}
      <ListCard>
        {legal.data.items.map((item) => {
          const notice = pickNotice(notices.data.items, item.kind);
          const version = item.current_version ?? notice?.version ?? null;
          const accepted = item.up_to_date && item.accepted_version;
          return (
            <View key={item.kind} style={{ gap: 6 }}>
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
              >
                <Body>{LABEL[item.kind]}</Body>
                {version ? (
                  <Pill
                    label={accepted ? 'Accepted' : 'Needs your OK'}
                    tone={accepted ? 'neutral' : 'accent'}
                  />
                ) : null}
              </View>
              <Caption>
                {accepted
                  ? `Version ${item.accepted_version}${item.accepted_at ? ` · accepted ${formatDate(item.accepted_at)}` : ''}`
                  : version
                    ? `Version ${version}`
                    : 'Not published yet.'}
              </Caption>
              {version ? (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: 20,
                  }}
                >
                  <TextButton
                    label={`Read the ${LABEL[item.kind]}`}
                    onPress={() =>
                      router.push(
                        `/notice?kind=${item.kind}&version=${encodeURIComponent(version)}`,
                      )
                    }
                  />
                </View>
              ) : null}
              {version && !item.up_to_date ? (
                <SecondaryButton
                  label={busy === item.kind ? 'Saving…' : `Accept ${LABEL[item.kind]}`}
                  hint={`Records that you accepted version ${version}`}
                  disabled={busy !== null}
                  onPress={() => void accept(item.kind, version, notice?.locale ?? 'en-IN')}
                />
              ) : null}
            </View>
          );
        })}
        {ai ? (
          <LinkRow
            label="How KAREN uses AI"
            onPress={() =>
              router.push(`/notice?kind=ai_disclosure&version=${encodeURIComponent(ai.version)}`)
            }
          />
        ) : null}
      </ListCard>
      {error ? <ErrorState message={describeError(error)} /> : null}
    </View>
  );
}
