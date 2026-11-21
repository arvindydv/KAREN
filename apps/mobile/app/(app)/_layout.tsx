import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';
import { useServices } from '../../src/auth/services';
import { Banner, LoadingState, Screen, TextButton } from '../../src/components/primitives';
import { useSessionStore } from '../../src/state/session-store';
import { useTheme } from '../../src/theme/theme';

/** Signed-in area. Gated on session status; a restricted (deletion) session goes elsewhere. */
export default function AppLayout() {
  const t = useTheme();
  const { session } = useServices();
  const status = useSessionStore((s) => s.status);
  const account = useSessionStore((s) => s.accountStatus);
  const refreshProblem = useSessionStore((s) => s.refreshProblem);
  if (status === 'unknown') {
    return (
      <Screen>
        <LoadingState label="Restoring your session" />
      </Screen>
    );
  }
  if (status === 'signed_out') return <Redirect href="/" />;
  if (account === 'DELETION_REQUESTED') return <Redirect href="/deletion-scheduled" />;
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      {refreshProblem ? (
        <View style={{ paddingTop: 48, paddingHorizontal: t.spacing.lg }}>
          <Banner tone="warning">
            Can’t reach KAREN right now. You’re still signed in; we’ll keep trying.
          </Banner>
          <TextButton label="Retry now" onPress={() => void session.refresh()} />
        </View>
      ) : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.background },
        }}
      />
    </View>
  );
}
