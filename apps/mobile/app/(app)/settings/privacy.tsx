import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { useApi } from '../../../src/auth/services';
import {
  Banner,
  Body,
  Caption,
  EmptyState,
  ErrorState,
  FormScreen,
  GlassCard,
  Heading,
  LinkRow,
  SecondaryButton,
} from '../../../src/components/primitives';
import { QueryView } from '../../../src/components/query-view';
import { ScreenHeader } from '../../../src/components/screen-header';
import { ConsentToggles } from '../../../src/features/consent-toggles';
import { LegalDocuments } from '../../../src/features/legal-documents';
import { describeError, unwrap } from '../../../src/lib/api-error';
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
      <Heading>Your choices</Heading>
      <Caption>
        Optional uses of your data. Off unless you turn them on; you can change them any time.
      </Caption>
      <ConsentToggles source="settings" />
      <GlassCard>
        <LinkRow
          label="Consent history"
          description="Every decision, with tamper-evident receipts"
          onPress={() => router.push('/settings/consent-history')}
        />
      </GlassCard>

      <Heading>Legal documents</Heading>
      <LegalDocuments />

      <Heading>Your data</Heading>
      <DataExport />
      <GlassCard>
        <LinkRow
          label="Delete account"
          description="Schedule deletion of your account and data"
          onPress={() => router.push('/settings/delete-account')}
        />
      </GlassCard>
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
          <View style={{ gap: 8 }}>
            <Body>Export a copy of your data</Body>
            {exports.length === 0 ? (
              <EmptyState title="No exports requested yet." />
            ) : (
              exports.map((r) => (
                <Caption key={r.id}>
                  Requested {new Date(r.requested_at).toLocaleString()} ·{' '}
                  {STATUS_TEXT[r.status] ?? r.status}
                  {r.expires_at && r.status === 'ready'
                    ? ` · available until ${new Date(r.expires_at).toLocaleString()}`
                    : ''}
                </Caption>
              ))
            )}
            {exports.some((r) => r.download_available) ? (
              <Banner>
                Your export is ready. Downloading it in the mobile app isn’t supported in this build
                yet.
              </Banner>
            ) : null}
            {request.error ? <ErrorState message={describeError(request.error)} /> : null}
            <SecondaryButton
              label={request.busy ? 'Requesting…' : open ? 'Export in progress' : 'Request export'}
              disabled={request.busy || open}
              onPress={() => request.run()}
            />
            <SecondaryButton label="Refresh status" onPress={() => void rights.refetch()} />
          </View>
        );
      }}
    </QueryView>
  );
}
