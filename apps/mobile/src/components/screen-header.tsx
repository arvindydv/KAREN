import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Heading, TextButton } from './primitives';

/** Title with an accessible Back control (hidden when there is nowhere to go back to). */
export function ScreenHeader({ title, back = true }: { title: string; back?: boolean }) {
  const router = useRouter();
  return (
    <View style={{ gap: 4 }}>
      {back && router.canGoBack() ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextButton
            label="‹ Back"
            hint="Go to the previous screen"
            onPress={() => router.back()}
          />
        </View>
      ) : null}
      <Heading>{title}</Heading>
    </View>
  );
}
