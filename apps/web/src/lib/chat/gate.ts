import 'server-only';
import type { ConsentStateList, Notice, NoticeList, Preferences } from '@karen/api-contracts';
import type { ChatGateProps } from '@/components/chat/chat-view';
import { serverGet } from '../server-api';

/** Latest notice of a kind for a locale (by effective date). */
function latest(items: NoticeList['items'], kind: string, locale = 'en-IN') {
  return (
    items
      .filter((n) => n.kind === kind && n.locale === locale)
      .sort((a, b) => (b.effective_from ?? '').localeCompare(a.effective_from ?? ''))[0] ?? null
  );
}

/** Server-side data the chat needs before rendering: consent, notices, motion preference. */
export async function loadChatGate(): Promise<ChatGateProps> {
  const [consents, notices, prefs] = await Promise.all([
    serverGet<ConsentStateList>('v1/me/consents'),
    serverGet<NoticeList>('v1/consent/notices'),
    serverGet<Preferences>('v1/me/preferences'),
  ]);
  const ai = consents.ok
    ? consents.data.items.find((c) => c.purpose === 'AI_PROCESSING')
    : undefined;
  const items = notices.ok ? notices.data.items : [];
  const privacy = latest(items, 'privacy_notice');
  const disclosureSummary = latest(items, 'ai_disclosure');
  const disclosure = disclosureSummary
    ? await serverGet<Notice>(
        `v1/consent/notices/ai_disclosure/${encodeURIComponent(disclosureSummary.version)}?locale=${disclosureSummary.locale}`,
      )
    : null;
  return {
    // Unknown consent state is treated as "not granted": the API enforces it anyway.
    consentGranted: ai?.decision === 'granted',
    consentVersion: ai?.version ?? 0,
    privacyNoticeVersion: privacy?.version ?? null,
    reducedMotionPreference: prefs.ok ? prefs.data.reduced_motion : false,
    aiDisclosure: disclosure?.ok
      ? {
          version: disclosure.data.version,
          content: disclosure.data.content,
          draft: disclosure.data.state === 'draft',
        }
      : null,
  };
}
