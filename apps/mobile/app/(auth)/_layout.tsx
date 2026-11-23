import { Redirect, Stack } from 'expo-router';
import { LoadingState, Screen } from '../../src/components/primitives';
import { useChallengeStore } from '../../src/state/challenge-store';
import { useSessionStore } from '../../src/state/session-store';
import { useTheme } from '../../src/theme/theme';

/** Signed-out area. A signed-in user is sent to the app (or the deletion screen). */
export default function AuthLayout() {
  const t = useTheme();
  const status = useSessionStore((s) => s.status);
  const account = useSessionStore((s) => s.accountStatus);
  const afterSignIn = useChallengeStore((s) => s.afterSignIn);
  if (status === 'unknown') {
    return (
      <Screen>
        <LoadingState label="Starting KAREN" />
      </Screen>
    );
  }
  if (status === 'signed_in') {
    if (account === 'DELETION_REQUESTED') return <Redirect href="/deletion-scheduled" />;
    return <Redirect href={afterSignIn ?? '/chat/new'} />;
  }
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        contentStyle: { backgroundColor: t.colors.background },
      }}
    />
  );
}
