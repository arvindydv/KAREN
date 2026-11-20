import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
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
  const t = useTheme();
  return (
    <View accessibilityRole="alert" style={{ gap: 12 }}>
      <Text
        style={{
          color: t.colors.danger,
          fontSize: t.typography.scale.body.size,
          lineHeight: t.typography.scale.body.lineHeight,
        }}
      >
        {message}
      </Text>
      {onRetry ? <SecondaryButton label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

/** Nothing to show yet — say so plainly. */
export function EmptyState({ title, message }: { title: string; message?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs, paddingVertical: t.spacing.md }}>
      <Body>{title}</Body>
      {message ? <Body muted>{message}</Body> : null}
    </View>
  );
}

/** The server refused this for the signed-in user (403). */
export function DeniedState({ message }: { message?: string }) {
  return (
    <View accessibilityRole="alert" style={{ gap: 8 }}>
      <Body>You don’t have access to this.</Body>
      <Body muted>{message ?? 'If you think this is a mistake, contact support.'}</Body>
    </View>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={{ color: t.colors.textSecondary, fontSize: 13, lineHeight: 18 }}>{children}</Text>
  );
}

/** Inline notice. `warning` for e.g. "Draft — not legally reviewed"; `success` for confirmations. */
export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'success';
  children: ReactNode;
}) {
  const t = useTheme();
  const color =
    tone === 'warning'
      ? t.colors.warning
      : tone === 'success'
        ? t.colors.success
        : t.colors.highlight;
  return (
    <View
      accessibilityRole={tone === 'info' ? 'text' : 'alert'}
      style={{
        borderLeftWidth: 4,
        borderLeftColor: color,
        backgroundColor: t.glass.fill,
        borderRadius: t.radius.md,
        padding: t.spacing.md,
      }}
    >
      <Text style={{ color: t.colors.textPrimary, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  hint,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  hint?: string;
  destructive?: boolean;
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
        minHeight: Math.max(48, t.minTouchTarget),
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: destructive ? t.colors.danger : t.glass.border,
        backgroundColor: t.glass.fill,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: t.spacing.lg,
      })}
    >
      <Text
        style={{
          color: destructive ? t.colors.danger : t.colors.textPrimary,
          fontSize: t.typography.scale.body.size,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Text-styled button (links between screens). Keeps a 44pt touch target. */
export function TextButton({
  label,
  onPress,
  hint,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  hint?: string;
  disabled?: boolean;
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
      hitSlop={8}
      style={{ minHeight: t.minTouchTarget, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: t.colors.highlight, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  hint,
  secure = false,
  ...input
}: Omit<TextInputProps, 'secureTextEntry' | 'style'> & {
  label: string;
  error?: string | null;
  hint?: string;
  secure?: boolean;
}) {
  const t = useTheme();
  const [hidden, setHidden] = useState(true);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.colors.textPrimary, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={t.colors.textSecondary}
          secureTextEntry={secure && hidden}
          autoCorrect={false}
          {...input}
          style={{
            flex: 1,
            minHeight: Math.max(48, t.minTouchTarget),
            borderRadius: t.radius.md,
            borderWidth: 1,
            borderColor: error ? t.colors.danger : t.glass.border,
            backgroundColor: t.glass.fill,
            color: t.colors.textPrimary,
            paddingHorizontal: t.spacing.md,
            fontSize: t.typography.scale.body.size,
          }}
        />
        {secure ? (
          <TextButton
            label={hidden ? 'Show' : 'Hide'}
            hint={hidden ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
            onPress={() => setHidden((h) => !h)}
          />
        ) : null}
      </View>
      {hint ? <Caption>{hint}</Caption> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: t.colors.danger, fontSize: 13 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Scrollable, keyboard-safe screen for forms and long content. */
export function FormScreen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <SpaceBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: t.spacing.xl, gap: t.spacing.lg, flexGrow: 1 }}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled = false,
  disabledReason,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        minHeight: t.minTouchTarget,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{label}</Body>
        {description ? <Caption>{description}</Caption> : null}
        {disabled && disabledReason ? <Caption>{disabledReason}</Caption> : null}
      </View>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={disabled ? disabledReason : undefined}
        accessibilityState={{ checked: value, disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: t.colors.accent, false: t.colors.border }}
      />
    </View>
  );
}

/** Single-choice group with radio semantics. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 8 }}>
      <Text style={{ color: t.colors.textPrimary, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(o.value)}
              style={{
                minHeight: t.minTouchTarget,
                minWidth: t.minTouchTarget,
                justifyContent: 'center',
                paddingHorizontal: t.spacing.md,
                borderRadius: t.radius.pill,
                borderWidth: 1,
                borderColor: selected ? t.colors.accent : t.glass.border,
                backgroundColor: selected ? t.colors.accent : t.glass.fill,
              }}
            >
              <Text
                style={{
                  color: selected ? t.colors.accentText : t.colors.textPrimary,
                  fontWeight: '600',
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Tappable list row for navigation (settings menus). */
export function LinkRow({
  label,
  description,
  onPress,
}: {
  label: string;
  description?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: Math.max(52, t.minTouchTarget),
        paddingVertical: t.spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{label}</Body>
        {description ? <Caption>{description}</Caption> : null}
      </View>
      <Text style={{ color: t.colors.textSecondary, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}
