import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';

/**
 * Visual primitives for the "deep space" theme. Gradients, glows and blur use React Native's
 * New Architecture style props (experimental_backgroundImage, boxShadow, filter) — no extra
 * native dependencies. They degrade to solid colours where unsupported.
 */

/** Full-screen space background: navy gradient with soft blue/violet light. */
export function SpaceBackground() {
  const t = useTheme();
  const dark = t.scheme === 'dark';
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: t.colors.background,
        experimental_backgroundImage: dark
          ? 'radial-gradient(circle at 15% 0%, rgba(37,99,235,0.35) 0%, transparent 55%), radial-gradient(circle at 100% 100%, rgba(139,92,246,0.35) 0%, transparent 55%), linear-gradient(180deg, #0B1230 0%, #060A1C 100%)'
          : 'radial-gradient(circle at 15% 0%, rgba(37,99,235,0.14) 0%, transparent 55%), radial-gradient(circle at 100% 100%, rgba(139,92,246,0.14) 0%, transparent 55%)',
      }}
    />
  );
}

export function Screen({ children, padded = true }: { children: ReactNode; padded?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <SpaceBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: padded ? t.spacing.xl : 0, gap: t.spacing.lg }}>
          {children}
        </View>
      </SafeAreaView>
    </View>
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

/** Frosted glass surface (cards, quick actions, input bars). */
export function GlassCard({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.glass.fill,
          borderColor: t.glass.border,
          borderWidth: 1,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Small glass pill with a glowing dot, e.g. "Personal AI life agent". */
export function Badge({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.sm,
        paddingHorizontal: t.spacing.md,
        paddingVertical: 6,
        borderRadius: t.radius.pill,
        backgroundColor: t.glass.fill,
        borderColor: t.glass.border,
        borderWidth: 1,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: t.colors.highlight,
          boxShadow: `0 0 8px ${t.colors.highlight}`,
        }}
      />
      <Text style={{ color: t.colors.textPrimary, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Screen-reader hint, e.g. why the button is disabled. */
  hint?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        borderRadius: t.radius.pill,
        backgroundColor: t.colors.accent,
        experimental_backgroundImage: `linear-gradient(180deg, ${t.brand.buttonGradient[0]}, ${t.brand.buttonGradient[1]})`,
        boxShadow: disabled ? undefined : '0 12px 28px -8px rgba(37,99,235,0.6)',
        opacity: disabled ? 0.55 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: t.spacing.xl,
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

/** The KAREN AI orb: glowing blue sphere used for voice / "Ask KAREN". Decorative. */
export function Orb({ size = 140, children }: { size?: number; children?: ReactNode }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1D4ED8',
        experimental_backgroundImage:
          'radial-gradient(circle at 35% 30%, #E0F2FE 0%, #93C5FD 12%, transparent 40%), radial-gradient(circle at 50% 55%, #3B82F6 0%, #1D4ED8 45%, #0B2A8F 75%, #071A5C 100%)',
        boxShadow: '0 0 40px 8px rgba(59,130,246,0.55), 0 0 100px 24px rgba(37,99,235,0.3)',
      }}
    >
      {children}
    </View>
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
      <ActivityIndicator color={t.colors.highlight} />
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
