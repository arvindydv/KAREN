import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Body, Chevron, Heading } from './primitives';

/** Round Back control; renders nothing when there is nowhere to go back to. */
export function BackButton() {
  const t = useTheme();
  const router = useRouter();
  if (!router.canGoBack()) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      accessibilityHint="Go to the previous screen"
      onPress={() => router.back()}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: t.glass.border,
        backgroundColor: pressed ? t.colors.surfaceRaised : t.glass.fill,
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: 3,
      })}
    >
      <Chevron color={t.colors.textPrimary} direction="left" />
    </Pressable>
  );
}

/** Title (+ optional subtitle) with a round Back control, hidden when there is nowhere to go. */
export function ScreenHeader({
  title,
  subtitle,
  back = true,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
}) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ gap: t.spacing.sm, marginBottom: t.spacing.xs }}>
      {back && router.canGoBack() ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Go to the previous screen"
          onPress={() => router.back()}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: t.glass.border,
            backgroundColor: pressed ? t.colors.surfaceRaised : t.glass.fill,
            alignItems: 'center',
            justifyContent: 'center',
            paddingLeft: 3,
            marginBottom: t.spacing.md,
          })}
        >
          <Chevron color={t.colors.textPrimary} direction="left" />
        </Pressable>
      ) : null}
      <Heading>{title}</Heading>
      {subtitle ? <Body muted>{subtitle}</Body> : null}
    </View>
  );
}
