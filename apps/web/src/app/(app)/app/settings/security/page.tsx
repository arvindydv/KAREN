import type { DeviceList, SessionList } from '@karen/api-contracts';
import { SignOutButton } from '@/components/app/sign-out-button';
import { DevicesList, PasswordChangeForm, SessionsList } from '@/components/app/security-forms';
import { LoadError, PageHeader, SectionCard } from '@/components/app/states';
import { serverGet } from '@/lib/server-api';

export const metadata = { title: 'Security' };

export default async function SecuritySettingsPage() {
  const [sessions, devices] = await Promise.all([
    serverGet<SessionList>('v1/me/sessions'),
    serverGet<DeviceList>('v1/me/devices'),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        intro="Your password, where you’re signed in, and your devices."
      />
      <SectionCard
        title="Password"
        description="Changing your password signs out your other sessions."
      >
        <PasswordChangeForm />
      </SectionCard>
      <SectionCard title="Active sessions">
        {sessions.ok ? (
          <SessionsList sessions={sessions.data.items} />
        ) : (
          <LoadError what="your sessions" error={sessions.error} />
        )}
      </SectionCard>
      <SectionCard title="Devices">
        {devices.ok ? (
          <DevicesList devices={devices.data.items} />
        ) : (
          <LoadError what="your devices" error={devices.error} />
        )}
      </SectionCard>
      <SectionCard
        title="Sign out everywhere"
        description="Ends every session, including this one."
      >
        <SignOutButton everywhere variant="danger" />
      </SectionCard>
    </div>
  );
}
