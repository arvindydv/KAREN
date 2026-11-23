import { useState } from 'react';
import { View } from 'react-native';
import { useApi } from '../../auth/services';
import {
  Banner,
  Body,
  Caption,
  ErrorState,
  GlassCard,
  PrimaryButton,
} from '../../components/primitives';
import { describeError, unwrap } from '../../lib/api-error';
import {
  idempotencyKey,
  ifMatch,
  pickNotice,
  qk,
  useInvalidate,
  useMyConsents,
  useNotices,
} from '../../lib/queries';

/** Whether AI_PROCESSING is actively granted (null while loading). */
export function useAiConsent(): boolean | null {
  const mine = useMyConsents();
  if (!mine.data) return null;
  return mine.data.items.some((s) => s.purpose === 'AI_PROCESSING' && s.decision === 'granted');
}

/**
 * Shown instead of the composer when AI processing is not allowed. Explains what happens to
 * messages and records consent against the privacy-notice version shown (receipt kept).
 */
export function ConsentRequired() {
  const api = useApi();
  const invalidate = useInvalidate();
  const mine = useMyConsents();
  const notices = useNotices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const notice = notices.data ? pickNotice(notices.data.items, 'privacy_notice') : undefined;
  const current = mine.data?.items.find((s) => s.purpose === 'AI_PROCESSING');

  const allow = async () => {
    if (!notice) return;
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.PUT('/v1/me/consents/{purpose}', {
          params: {
            path: { purpose: 'AI_PROCESSING' },
            header: {
              'If-Match': ifMatch(current?.version ?? 0),
              'Idempotency-Key': idempotencyKey(),
            },
          },
          body: { decision: 'grant', notice_version: notice.version, source: 'in_context' },
        }),
      );
      await invalidate(qk.consents);
    } catch (err) {
      setError(err);
      await invalidate(qk.consents);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard style={{ gap: 10 }}>
      <Body>Allow AI processing to chat</Body>
      <Caption>
        To answer, KAREN sends your messages in this conversation to an AI model run by a
        third-party provider. Nothing is sent until you allow it, and you can turn it off any time
        in Privacy settings. Your past conversations stay readable and deletable either way.
      </Caption>
      {notice?.state === 'draft' ? (
        <Banner tone="warning">Draft notice — not legally reviewed (test environment).</Banner>
      ) : null}
      {error ? <ErrorState message={describeError(error)} /> : null}
      <View>
        <PrimaryButton
          label={busy ? 'Saving…' : 'Allow AI processing'}
          disabled={busy || !notice}
          {...(!notice ? { hint: 'The privacy notice could not be loaded yet' } : {})}
          onPress={() => void allow()}
        />
      </View>
    </GlassCard>
  );
}
