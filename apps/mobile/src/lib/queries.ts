import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../auth/services';
import { unwrap } from './api-error';
import { newUuid } from './uuid';

/** Query keys + hooks for the signed-in API. All data comes from the typed client. */
export const qk = {
  profile: ['me', 'profile'] as const,
  preferences: ['me', 'preferences'] as const,
  onboarding: ['me', 'onboarding'] as const,
  sessions: ['me', 'sessions'] as const,
  devices: ['me', 'devices'] as const,
  consents: ['me', 'consents'] as const,
  consentHistory: ['me', 'consents', 'history'] as const,
  legal: ['me', 'legal'] as const,
  dataRights: ['me', 'data-rights'] as const,
  purposes: ['consent', 'purposes'] as const,
  voiceOptions: ['voice', 'options'] as const,
  notices: ['consent', 'notices'] as const,
  notice: (kind: string, version: string) => ['consent', 'notice', kind, version] as const,
};

/** `If-Match` value for a versioned resource. */
export const ifMatch = (version: number): string => `"${version}"`;

/** A fresh Idempotency-Key per user action (not per retry of the same action). */
export const idempotencyKey = (): string => newUuid();

export function useProfile() {
  const api = useApi();
  return useQuery({ queryKey: qk.profile, queryFn: () => unwrap(api.GET('/v1/me/profile')) });
}

export function usePreferences() {
  const api = useApi();
  return useQuery({
    queryKey: qk.preferences,
    queryFn: () => unwrap(api.GET('/v1/me/preferences')),
  });
}

/** What voice this deployment offers (voices, live availability) — ADR-0027. */
export function useVoiceOptions() {
  const api = useApi();
  return useQuery({
    queryKey: qk.voiceOptions,
    queryFn: () => unwrap(api.GET('/v1/voice/options')),
    staleTime: 10 * 60_000,
  });
}

export function useOnboarding() {
  const api = useApi();
  return useQuery({ queryKey: qk.onboarding, queryFn: () => unwrap(api.GET('/v1/me/onboarding')) });
}

export function useSessions() {
  const api = useApi();
  return useQuery({ queryKey: qk.sessions, queryFn: () => unwrap(api.GET('/v1/me/sessions')) });
}

export function useDevices() {
  const api = useApi();
  return useQuery({ queryKey: qk.devices, queryFn: () => unwrap(api.GET('/v1/me/devices')) });
}

export function usePurposes() {
  const api = useApi();
  return useQuery({
    queryKey: qk.purposes,
    queryFn: () => unwrap(api.GET('/v1/consent/purposes')),
  });
}

export function useMyConsents() {
  const api = useApi();
  return useQuery({ queryKey: qk.consents, queryFn: () => unwrap(api.GET('/v1/me/consents')) });
}

export function useConsentHistory() {
  const api = useApi();
  return useQuery({
    queryKey: qk.consentHistory,
    queryFn: () => unwrap(api.GET('/v1/me/consents/history')),
  });
}

export function useNotices() {
  const api = useApi();
  return useQuery({ queryKey: qk.notices, queryFn: () => unwrap(api.GET('/v1/consent/notices')) });
}

export function useLegal() {
  const api = useApi();
  return useQuery({ queryKey: qk.legal, queryFn: () => unwrap(api.GET('/v1/me/legal')) });
}

export function useDataRights() {
  const api = useApi();
  return useQuery({
    queryKey: qk.dataRights,
    queryFn: () => unwrap(api.GET('/v1/me/data-rights')),
  });
}

type NoticeKind = 'privacy_notice' | 'terms_of_service' | 'ai_disclosure';
type NoticeSummary = {
  kind: NoticeKind;
  locale: 'en-IN' | 'hi-IN';
  version: string;
  state: 'draft' | 'approved';
};

/** Pick the notice to show for a kind: preferred locale first, then any. */
export function pickNotice<T extends NoticeSummary>(
  items: readonly T[],
  kind: NoticeKind,
  locale: 'en-IN' | 'hi-IN' = 'en-IN',
): T | undefined {
  return (
    items.find((n) => n.kind === kind && n.locale === locale) ?? items.find((n) => n.kind === kind)
  );
}

export const useInvalidate = () => {
  const client = useQueryClient();
  return (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
};
