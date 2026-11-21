import type { Preferences } from '@karen/api-contracts';
import { PreferencesForm } from '@/components/app/preferences-form';
import { LoadError, PageHeader, SectionCard } from '@/components/app/states';
import { serverGet } from '@/lib/server-api';

export const metadata = { title: 'Preferences' };

export default async function PreferencesSettingsPage() {
  const prefs = await serverGet<Preferences>('v1/me/preferences');
  return (
    <div className="space-y-6">
      <PageHeader title="Preferences" intro="Language, display, accessibility and notifications." />
      {prefs.ok ? (
        <SectionCard title="Your preferences">
          <PreferencesForm prefs={prefs.data} />
        </SectionCard>
      ) : (
        <LoadError what="your preferences" error={prefs.error} />
      )}
    </div>
  );
}
