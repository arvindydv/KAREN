import type { OnboardingState, Preferences, Profile } from '@karen/api-contracts';
import { OnboardingWizard } from '@/components/app/onboarding-wizard';
import { timezoneOptions } from '@/components/app/options';
import { LoadError } from '@/components/app/states';
import { loadPrivacyData } from '@/lib/privacy-data';
import { serverGet } from '@/lib/server-api';

export const metadata = { title: 'Set up KAREN' };

/** Resumable onboarding: progress lives server-side (M5), so it continues on any device. */
export default async function OnboardingPage() {
  const [state, profile, prefs, privacy] = await Promise.all([
    serverGet<OnboardingState>('v1/me/onboarding'),
    serverGet<Profile>('v1/me/profile'),
    serverGet<Preferences>('v1/me/preferences'),
    loadPrivacyData(),
  ]);
  if (!state.ok) return <LoadError what="your setup progress" error={state.error} />;
  if (!profile.ok) return <LoadError what="your profile" error={profile.error} />;
  if (!prefs.ok) return <LoadError what="your preferences" error={prefs.error} />;
  return (
    <OnboardingWizard
      state={state.data}
      profile={profile.data}
      prefs={prefs.data}
      timezones={timezoneOptions(profile.data.timezone)}
      purposes={privacy.purposes.ok ? privacy.purposes.data.items : []}
      consents={privacy.consents.ok ? privacy.consents.data.items : []}
      noticeVersion={privacy.privacyNoticeVersion}
      notices={privacy.notices}
      legal={privacy.legal.ok ? privacy.legal.data.items : []}
    />
  );
}
