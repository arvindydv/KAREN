import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';

export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flex: 1, padding: t.spacing.xl, gap: t.spacing.lg }}>{children}</View>
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: t.colors.textPrimary,
        fontSize: t.typography.scale.headline.size,
        lineHeight: t.typography.scale.headline.lineHeight,
        fontWeight: '600',
      }}
    >
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: muted ? t.colors.textSecondary : t.colors.textPrimary,
        fontSize: t.typography.scale.body.size,
        lineHeight: t.typography.scale.body.lineHeight,
      }}
    >
      {children}
    </Text>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: t.minTouchTarget,
        borderRadius: t.radius.md,
        backgroundColor: t.colors.accent,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: t.spacing.lg,
      })}
    >
      <Text
        style={{
          color: t.colors.accentText,
          fontSize: t.typography.scale.body.size,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ padding: t.spacing.lg }}
    >
      <ActivityIndicator color={t.colors.accent} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View accessibilityRole="alert" style={{ gap: 12 }}>
      <Body>{message}</Body>
      {onRetry ? <PrimaryButton label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}
