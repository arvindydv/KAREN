import { View } from 'react-native';
import { Body, Heading, PrimaryButton, Screen } from '../src/components/primitives';
import { mobileEnv } from '../src/lib/env';

/** Launch screen. Product screens (onboarding, chat, tasks) arrive with their features. */
export default function LaunchScreen() {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <Heading>KAREN</Heading>
        <Body>Your life. Understood. Taken care of.</Body>
        <Body muted>Pre-release foundation build · {mobileEnv.EXPO_PUBLIC_APP_ENV}</Body>
      </View>
      <PrimaryButton label="Get started (coming soon)" onPress={() => undefined} disabled />
    </Screen>
  );
}
