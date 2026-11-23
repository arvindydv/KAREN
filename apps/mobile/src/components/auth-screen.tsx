import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/theme';
import { Reveal } from './motion';
import { NeuralCosmos } from './neural-cosmos';
import { SpaceBackground } from './primitives';
import { BackButton } from './screen-header';

/**
 * The one layout every sign-up / sign-in / code / reset screen uses, so they read as a set:
 *
 *   [back]
 *          ✦ KAREN core ✦         ← compact, animated version of the welcome "brain"
 *             Title
 *            Subtitle
 *   ┌───────────────────────┐
 *   │ fields…               │   ← frosted glass card
 *   │ [   Primary action  ] │   ← action sits right under the fields
 *   │ fine print / resend   │
 *   └───────────────────────┘
 *   (flexible space)
 *   Already have an account? Sign in   ← footer, bottom of the screen
 *
 * Scrolls and lifts above the keyboard when it doesn't fit.
 */
export function AuthScreen({
  title,
  subtitle,
  children,
  action,
  footer,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  /** Primary button (+ fine print) shown inside the card, under the fields. */
  action?: ReactNode;
  /** Bottom-of-screen links (switch between sign-in and sign-up). */
  footer?: ReactNode;
}) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const hero = Math.round(Math.min(170, Math.max(120, height * 0.19)));
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
              flexGrow: 1,
              paddingHorizontal: t.spacing.xl,
              paddingTop: t.spacing.sm,
              paddingBottom: t.spacing.lg,
            }}
          >
            <View style={{ height: 44, justifyContent: 'center' }}>
              <BackButton />
            </View>
            {/* Balance spare height: a little above the content, more below it. */}
            <View style={{ flexGrow: 1, maxHeight: 48 }} />
            <Reveal index={0} style={{ alignItems: 'center', marginTop: -t.spacing.md }}>
              <NeuralCosmos height={hero} nodeCount={14} core={Math.round(hero * 0.24)} />
            </Reveal>
            <Reveal index={1} style={{ alignItems: 'center', gap: t.spacing.sm }}>
              <Text
                accessibilityRole="header"
                style={{
                  color: t.colors.textPrimary,
                  fontSize: 28,
                  lineHeight: 34,
                  fontWeight: '700',
                  letterSpacing: -0.6,
                  textAlign: 'center',
                }}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  style={{
                    color: t.colors.textSecondary,
                    fontSize: 15,
                    lineHeight: 22,
                    textAlign: 'center',
                    maxWidth: 320,
                  }}
                >
                  {subtitle}
                </Text>
              ) : null}
            </Reveal>
            {children || action ? (
              <Reveal
                index={2}
                style={{
                  marginTop: t.spacing.xl,
                  gap: t.spacing.lg,
                  padding: t.spacing.lg,
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: t.glass.border,
                  backgroundColor: t.glass.fill,
                }}
              >
                {children}
                {action ? <View style={{ gap: t.spacing.sm }}>{action}</View> : null}
              </Reveal>
            ) : null}
            <View style={{ flexGrow: 1, minHeight: t.spacing.xl }} />
            {footer ? <Reveal index={3}>{footer}</Reveal> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

/** Centred "Already have an account? **Sign in**" style link. One target, 44pt tall. */
export function AuthSwitch({
  prompt,
  action,
  onPress,
}: {
  prompt: string;
  action: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${prompt} ${action}`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        minHeight: t.minTouchTarget,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: t.colors.textSecondary, fontSize: 15, textAlign: 'center' }}>
        {prompt} <Text style={{ color: t.colors.highlight, fontWeight: '600' }}>{action}</Text>
      </Text>
    </Pressable>
  );
}

/** Small centred print under the primary action (legal notes, timers). */
export function FinePrint({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: t.colors.textSecondary,
        fontSize: 12.5,
        lineHeight: 18,
        textAlign: 'center',
        paddingHorizontal: t.spacing.sm,
      }}
    >
      {children}
    </Text>
  );
}

/** Inline link inside running text (keeps the sentence on one baseline). */
export function InlineLink({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Text
      accessibilityRole="link"
      onPress={onPress}
      suppressHighlighting
      style={{ color: t.colors.highlight, fontWeight: '600' }}
    >
      {label}
    </Text>
  );
}
