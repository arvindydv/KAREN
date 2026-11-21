import type { Profile } from '@karen/api-contracts';
import { timezoneOptions } from '@/components/app/options';
import { EmailChangeForm, ProfileForm } from '@/components/app/profile-forms';
import { LoadError, PageHeader, SectionCard } from '@/components/app/states';
import { serverGet } from '@/lib/server-api';

export const metadata = { title: 'Profile' };

export default async function ProfileSettingsPage() {
  const profile = await serverGet<Profile>('v1/me/profile');
  return (
    <div className="space-y-6">
      <PageHeader title="Profile" intro="How KAREN addresses you, and your region settings." />
      {profile.ok ? (
        <>
          <SectionCard title="About you">
            <ProfileForm
              profile={profile.data}
              timezones={timezoneOptions(profile.data.timezone)}
            />
          </SectionCard>
          <SectionCard
            title="E-mail address"
            description="We confirm the new address with a 6-digit code before switching to it."
          >
            <EmailChangeForm currentEmail={profile.data.email} />
          </SectionCard>
        </>
      ) : (
        <LoadError what="your profile" error={profile.error} />
      )}
    </div>
  );
}
