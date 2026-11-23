import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { useApi } from '../../../src/auth/services';
import {
  Caption,
  CardTitle,
  ErrorState,
  FormScreen,
  GlassCard,
  LinkRow,
  ListCard,
  Pill,
  SecondaryButton,
  SectionTitle,
  TextButton,
} from '../../../src/components/primitives';
import { QueryView } from '../../../src/components/query-view';
import { ScreenHeader } from '../../../src/components/screen-header';
import { ConsentToggles } from '../../../src/features/consent-toggles';
import { LegalDocuments } from '../../../src/features/legal-documents';
import { describeError, unwrap } from '../../../src/lib/api-error';
import { formatDate, formatDateTime } from '../../../src/lib/format';
import { qk, useDataRights } from '../../../src/lib/queries';
import { useSubmit } from '../../../src/lib/use-submit';

const STATUS_TEXT: Record<string, string> = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  processing: 'Being prepared',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed — please request again',
  expired: 'Expired',
};

export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <FormScreen>
      <ScreenHeader title="Privacy" />
      <SectionTitle>Your choices</SectionTitle>
      <Caption>
        Optional uses of your data. Off unless you turn them on; you can change them any time.
      </Caption>
      <ConsentToggles source="settings" />
      <ListCard>
        <LinkRow
          label="Consent history"
          description="Every decision, with tamper-evident receipts"
          onPress={() => router.push('/settings/consent-history')}
        />
      </ListCard>

      <SectionTitle>Legal documents</SectionTitle>
      <LegalDocuments />

      <SectionTitle>Your data</SectionTitle>
      <DataExport />
      <ListCard>
        <LinkRow
          label="Delete account"
          description="Schedule deletion of your account and data"
          onPress={() => router.push('/settings/delete-account')}
        />
      </ListCard>
    </FormScreen>
  );
}

function DataExport() {
  const api = useApi();
  const client = useQueryClient();
  const rights = useDataRights();
  const request = useSubmit(
    useCallback(async () => {
      await unwrap(api.POST('/v1/me/data-rights/export'));
      await client.invalidateQueries({ queryKey: qk.dataRights });
    }, [api, client]),
  );
  return (
    <QueryView query={rights} loadingLabel="Loading data requests">
      {(d) => {
        const exports = d.items.filter((r) => r.kind === 'export');
        const open = exports.some((r) =>
          ['requested', 'scheduled', 'processing'].includes(r.status),
        );
        return (
          <GlassCard style={{ gap: 10 }}>
            <CardTitle>Export a copy of your data</CardTitle>
            {exports.length === 0 ? (
              <Caption>No exports requested yet.</Caption>
            ) : (
              exports.map((r) => (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Caption>
                      Requested {formatDateTime(r.requested_at)}
                      {r.expires_at && r.status === 'ready'
                        ? ` · available until ${formatDate(r.expires_at)}`
                        : ''}
                    </Caption>
                  </View>
                  <Pill
                    label={STATUS_TEXT[r.status] ?? r.status}
                    tone={r.status === 'ready' ? 'accent' : 'neutral'}
                  />
                </View>
              ))
            )}
            {exports.some((r) => r.download_available) ? (
              <Caption>
                Downloading your export in the mobile app isn’t supported in this build yet.
              </Caption>
            ) : null}
            {request.error ? <ErrorState message={describeError(request.error)} /> : null}
            {exports.length === 0 ? (
              <SecondaryButton
                label={request.busy ? 'Requesting…' : 'Request export'}
                disabled={request.busy}
                onPress={() => request.run()}
              />
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 20 }}>
                <TextButton
                  label={
                    request.busy
                      ? 'Requesting…'
                      : open
                        ? 'Export in progress'
                        : 'Request a new export'
                  }
                  disabled={request.busy || open}
                  onPress={() => request.run()}
                />
                <TextButton label="Refresh status" onPress={() => void rights.refetch()} />
              </View>
            )}
          </GlassCard>
        );
      }}
    </QueryView>
  );
}
