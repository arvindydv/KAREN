import { Children, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
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
import { Stagger, usePressScale } from './motion';

/**
 * Visual primitives for the softened "deep space" theme: navy gradient background, frosted
 * glass cards, one blue action colour. Gradients are static and there is NO blur filter
 * anywhere (blur is what cost frames on mid-range Android). Motion lives in ./motion.
 */

/** Full-screen space background: soft navy gradient with faint blue/violet light. Static. */
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
          ? 'radial-gradient(circle at 15% 0%, rgba(58,111,224,0.24) 0%, transparent 55%), radial-gradient(circle at 100% 100%, rgba(142,124,235,0.22) 0%, transparent 55%), linear-gradient(180deg, #111833 0%, #0A0F24 100%)'
          : 'radial-gradient(circle at 15% 0%, rgba(58,111,224,0.10) 0%, transparent 55%), radial-gradient(circle at 100% 100%, rgba(142,124,235,0.10) 0%, transparent 55%)',
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
        fontSize: 28,
        lineHeight: 34,
        fontWeight: '600',
        letterSpacing: -0.6,
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
          borderRadius: 20,
          padding: t.spacing.lg + 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** KAREN monogram: soft blue gradient tile with a "K". Decorative. */
export function Monogram({ size = 40 }: { size?: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: t.colors.accent,
        experimental_backgroundImage: `linear-gradient(135deg, #5A8BEA, ${t.colors.accent} 55%, ${t.brand.buttonGradient[1]})`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.45, fontWeight: '700' }}>K</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  hint,
  tone = 'default',
}: {
  label: string;
  onPress: () => void;
  /** `danger` for irreversible actions (delete account). */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Shows a spinner next to the label while work is in flight. */
  busy?: boolean;
  /** Screen-reader hint, e.g. why the button is disabled. */
  hint?: string;
}) {
  const t = useTheme();
  const off = disabled || busy;
  const press = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: off, busy }}
        disabled={off}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => ({
          minHeight: 54,
          borderRadius: t.radius.pill,
          // Disabled reads as a quiet, solid surface (a faded gradient looks muddy).
          backgroundColor: disabled
            ? t.colors.surfaceRaised
            : tone === 'danger'
              ? DANGER_FILL
              : t.colors.accent,
          experimental_backgroundImage:
            disabled || tone === 'danger'
              ? undefined
              : `linear-gradient(180deg, ${t.brand.buttonGradient[0]}, ${t.brand.buttonGradient[1]})`,
          borderWidth: disabled ? 1 : 0,
          borderColor: t.glass.border,
          boxShadow:
            off || tone === 'danger' ? undefined : '0 10px 24px -10px rgba(58,111,224,0.45)',
          opacity: busy ? 0.85 : pressed ? 0.92 : 1,
          flexDirection: 'row',
          gap: t.spacing.sm,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: t.spacing.xl,
        })}
      >
        {busy ? <ActivityIndicator size="small" color={t.colors.accentText} /> : null}
        <Text
          style={{
            color: disabled ? t.colors.textSecondary : '#FFFFFF',
            fontSize: t.typography.scale.body.size,
            fontWeight: '600',
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
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
          fontSize: 14,
          lineHeight: 20,
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
    <Text style={{ color: t.colors.textSecondary, fontSize: 13, lineHeight: 19 }}>{children}</Text>
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
        flexDirection: 'row',
        gap: t.spacing.md,
        alignItems: 'flex-start',
        backgroundColor: t.glass.fill,
        borderColor: t.glass.border,
        borderWidth: 1,
        borderRadius: 14,
        padding: t.spacing.md,
      }}
    >
      <View
        style={{ width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: color }}
      />
      <Text style={{ flex: 1, color: t.colors.textPrimary, fontSize: 14, lineHeight: 20 }}>
        {children}
      </Text>
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
  const press = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => ({
          minHeight: 54,
          borderRadius: t.radius.pill,
          borderWidth: 1,
          borderColor: destructive ? t.colors.danger : t.glass.border,
          backgroundColor: pressed ? t.colors.surfaceRaised : t.glass.fill,
          opacity: disabled ? 0.45 : 1,
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
    </Animated.View>
  );
}

/** Text-styled button (links between screens). Keeps a 44pt touch target. */
export function TextButton({
  label,
  onPress,
  hint,
  disabled = false,
  align = 'left',
}: {
  label: string;
  onPress: () => void;
  hint?: string;
  disabled?: boolean;
  align?: 'left' | 'center';
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
      style={({ pressed }) => ({
        minHeight: t.minTouchTarget,
        justifyContent: 'center',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: t.colors.highlight, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Eye / eye-off glyph drawn with plain Views (no icon dependency): an almond (a square with
 * two opposite corners fully rounded, turned 45°), a pupil, and a slash when hidden.
 */
export function EyeIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: 15,
          height: 15,
          borderWidth: 1.7,
          borderColor: color,
          borderTopLeftRadius: 15,
          borderBottomRightRadius: 15,
          borderTopRightRadius: 1.5,
          borderBottomLeftRadius: 1.5,
          transform: [{ rotate: '45deg' }],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
      {open ? null : (
        <View
          style={{
            position: 'absolute',
            width: 24,
            height: 1.8,
            borderRadius: 1,
            backgroundColor: color,
            transform: [{ rotate: '-40deg' }],
          }}
        />
      )}
    </View>
  );
}

export function TextField({
  label,
  error,
  hint,
  secure = false,
  inputRef,
  ...input
}: Omit<TextInputProps, 'secureTextEntry' | 'style'> & {
  label: string;
  error?: string | null;
  hint?: string;
  secure?: boolean;
  /** Lets a screen move focus here (e.g. "Next" on the e-mail keyboard). */
  inputRef?: Ref<ComponentRef<typeof TextInput>>;
}) {
  const t = useTheme();
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);
  // Same hairline as cards, code boxes and the back button, so every surface matches.
  const borderColor = error ? t.colors.danger : focused ? t.colors.highlight : t.glass.border;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: t.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 54,
          borderRadius: 14,
          borderWidth: 1,
          borderColor,
          backgroundColor: t.glass.fill,
        }}
      >
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityHint={hint}
          // Dimmer than labels so an example never reads as a filled-in value.
          placeholderTextColor={`${t.colors.textSecondary}80`}
          selectionColor={t.colors.highlight}
          cursorColor={t.colors.highlight}
          secureTextEntry={secure && hidden}
          autoCorrect={false}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={{
            flex: 1,
            minHeight: 52,
            color: t.colors.textPrimary,
            paddingHorizontal: t.spacing.lg,
            fontSize: t.typography.scale.body.size,
          }}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            accessibilityState={{ checked: !hidden }}
            onPress={() => setHidden((h) => !h)}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 48,
              height: 52,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <EyeIcon open={!hidden} color={t.colors.textSecondary} />
          </Pressable>
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: t.spacing.xl,
              paddingTop: t.spacing.lg,
              paddingBottom: t.spacing.xxl,
              gap: t.spacing.lg,
              flexGrow: 1,
            }}
          >
            <Stagger gap={t.spacing.lg}>{children}</Stagger>
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
        style={{ opacity: disabled ? 0.4 : 1 }}
        trackColor={{ true: t.colors.highlight, false: t.colors.border }}
        thumbColor={t.colors.textPrimary}
        ios_backgroundColor={t.colors.border}
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
      <Text style={{ color: t.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
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
              style={({ pressed }) => ({
                minHeight: t.minTouchTarget,
                minWidth: t.minTouchTarget,
                maxWidth: '100%',
                justifyContent: 'center',
                paddingHorizontal: t.spacing.lg,
                borderRadius: t.radius.pill,
                borderWidth: 1,
                borderColor: selected ? t.colors.accent : t.glass.border,
                backgroundColor: selected ? t.colors.accent : t.glass.fill,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{
                  color: selected ? '#FFFFFF' : t.colors.textPrimary,
                  fontWeight: '600',
                  flexShrink: 1,
                  textAlignVertical: 'center',
                  includeFontPadding: false,
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

/** Small chevron drawn with borders (no icon dependency). Decorative. */
export function Chevron({
  color,
  direction = 'right',
}: {
  color: string;
  direction?: 'left' | 'right';
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 9,
        height: 9,
        borderTopWidth: 1.8,
        borderRightWidth: 1.8,
        borderColor: color,
        transform: [{ rotate: direction === 'right' ? '45deg' : '-135deg' }],
      }}
    />
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
        minHeight: t.minTouchTarget,
        paddingVertical: 2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{label}</Body>
        {description ? <Caption>{description}</Caption> : null}
      </View>
      <Chevron color={t.colors.textSecondary} />
    </Pressable>
  );
}

/** Solid fill for destructive primary actions; white text on it is ≥ 4.5:1. */
const DANGER_FILL = '#B93A3A';

/** Small uppercase label above a group/card ("SIGNED-IN SESSIONS"). One style everywhere. */
export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: t.colors.textSecondary,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginTop: t.spacing.sm,
        marginBottom: -t.spacing.xs,
        paddingHorizontal: t.spacing.xs,
      }}
    >
      {children}
    </Text>
  );
}

/** Title inside a card: stronger than body copy, smaller than the page heading. */
export function CardTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={{ color: t.colors.textPrimary, fontSize: 17, lineHeight: 23, fontWeight: '600' }}>
      {children}
    </Text>
  );
}

/**
 * A glass card holding a list of rows, with hairline dividers between them. Use for settings
 * lists, toggles, sessions, documents — anything that is "several rows of the same kind".
 */
export function ListCard({ children }: { children: ReactNode }) {
  const t = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View
      style={{
        backgroundColor: t.glass.fill,
        borderColor: t.glass.border,
        borderWidth: 1,
        borderRadius: 20,
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.xs,
      }}
    >
      {rows.map((row, i) => (
        <View
          key={i}
          style={{
            paddingVertical: t.spacing.md,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: t.glass.border,
          }}
        >
          {row}
        </View>
      ))}
    </View>
  );
}

/** Tiny status pill ("Coming later", "This device"). */
export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }) {
  const t = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: tone === 'accent' ? t.colors.highlight : t.glass.border,
        backgroundColor: t.glass.fill,
      }}
    >
      <Text
        style={{
          color: tone === 'accent' ? t.colors.highlight : t.colors.textSecondary,
          fontSize: 11.5,
          fontWeight: '700',
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Compact destructive text action for list rows ("Sign out", "Remove"). 44pt target. */
export function DangerLink({
  label,
  onPress,
  disabled = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
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
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: t.minTouchTarget,
        justifyContent: 'center',
        opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: t.colors.danger, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
