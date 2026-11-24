import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useServices } from '../../../src/auth/services';
import { FormScreen, LinkRow, ListCard, SecondaryButton } from '../../../src/components/primitives';
import { ScreenHeader } from '../../../src/components/screen-header';
import { useSubmit } from '../../../src/lib/use-submit';

export default function SettingsScreen() {
  const router = useRouter();
  const { session } = useServices();
  const signOut = useSubmit(useCallback(() => session.logout(), [session]));
  return (
    <FormScreen>
      <ScreenHeader title="Settings" />
      <ListCard>
        <LinkRow
          label="Profile"
          description="Name, language, time zone, currency"
          onPress={() => router.push('/settings/profile')}
        />
        <LinkRow
          label="Preferences"
          description="Display, accessibility, notifications"
          onPress={() => router.push('/settings/preferences')}
        />
        <LinkRow
          label="Security"
          description="Sessions, devices, password, e-mail, app lock"
          onPress={() => router.push('/settings/security')}
        />
        <LinkRow
          label="Memory"
          description="What KAREN remembers about you, suggestions, export"
          onPress={() => router.push('/settings/memory')}
        />
        <LinkRow
          label="Privacy"
          description="Consents, legal, export or delete your data"
          onPress={() => router.push('/settings/privacy')}
        />
      </ListCard>
      <SecondaryButton
        label={signOut.busy ? 'Signing out…' : 'Sign out'}
        disabled={signOut.busy}
        onPress={() => signOut.run()}
      />
    </FormScreen>
  );
}
