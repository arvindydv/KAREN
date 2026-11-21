import { Redirect, Stack } from 'expo-router';
import { LoadingState, Screen } from '../../src/components/primitives';
import { useSessionStore } from '../../src/state/session-store';
import { useTheme } from '../../src/theme/theme';

/** Signed-out area. A signed-in user is sent to the app (or the deletion screen). */
export default function AuthLayout() {
  const t = useTheme();
  const status = useSessionStore((s) => s.status);
  const account = useSessionStore((s) => s.accountStatus);
  if (status === 'unknown') {
    return (
      <Screen>
        <LoadingState label="Starting KAREN" />
      </Screen>
    );
  }
  if (status === 'signed_in') {
    return <Redirect href={account === 'DELETION_REQUESTED' ? '/deletion-scheduled' : '/home'} />;
  }
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.background } }}
    />
  );
}
