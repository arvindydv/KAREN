import 'server-only';
import type {
  ConsentStateList,
  LegalStatus,
  Notice,
  NoticeList,
  PurposeCatalog,
} from '@karen/api-contracts';
import { serverGet, type ApiResult } from './server-api';

export interface PrivacyData {
  purposes: ApiResult<PurposeCatalog>;
  consents: ApiResult<ConsentStateList>;
  legal: ApiResult<LegalStatus>;
  /** Current notices (privacy + terms), en-IN, with content. */
  notices: Notice[];
  /** Privacy-notice version a consent decision is recorded against (null: none published). */
  privacyNoticeVersion: string | null;
}

/** Latest notice per kind for a locale (by effective date, then list order). */
function latest(list: NoticeList['items'], kind: string, locale = 'en-IN') {
  const candidates = list.filter((n) => n.kind === kind && n.locale === locale);
  return (
    candidates.sort((a, b) => (b.effective_from ?? '').localeCompare(a.effective_from ?? ''))[0] ??
    null
  );
}

/** Loads what consent/legal UIs need (settings → privacy, onboarding → memory & privacy). */
export async function loadPrivacyData(): Promise<PrivacyData> {
  const [purposes, consents, legal, noticeList] = await Promise.all([
    serverGet<PurposeCatalog>('v1/consent/purposes'),
    serverGet<ConsentStateList>('v1/me/consents'),
    serverGet<LegalStatus>('v1/me/legal'),
    serverGet<NoticeList>('v1/consent/notices'),
  ]);
  const items = noticeList.ok ? noticeList.data.items : [];
  const wanted = ['privacy_notice', 'terms_of_service']
    .map((k) => latest(items, k))
    .filter((n): n is NonNullable<typeof n> => n !== null);
  const notices = (
    await Promise.all(
      wanted.map((n) =>
        serverGet<Notice>(
          `v1/consent/notices/${encodeURIComponent(n.kind)}/${encodeURIComponent(n.version)}?locale=${n.locale}`,
        ),
      ),
    )
  ).flatMap((r) => (r.ok ? [r.data] : []));
  return {
    purposes,
    consents,
    legal,
    notices,
    privacyNoticeVersion: wanted.find((n) => n.kind === 'privacy_notice')?.version ?? null,
  };
}
