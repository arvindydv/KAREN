import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { FinePrint } from './auth-screen';
import { Caption, TextButton } from './primitives';

export const RESEND_COOLDOWN_SECONDS = 30;
const LENGTH = 6;

/**
 * 6-digit one-time-code input shown as six cells. A single real TextInput (nearly transparent,
 * stretched over the cells) receives typing, paste and OS one-time-code autofill, so
 * accessibility and autofill behave exactly like a normal field.
 */
export function CodeField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (code: string) => void;
  error?: string | null;
}) {
  const t = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, LENGTH - 1);
  return (
    <View style={{ gap: 10 }}>
      <Pressable
        onPress={() => input.current?.focus()}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: 'row', gap: 8 }}
      >
        {Array.from({ length: LENGTH }, (_, i) => {
          const isActive = focused && i === active;
          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: 58,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: error
                  ? t.colors.danger
                  : isActive
                    ? t.colors.highlight
                    : t.glass.border,
                backgroundColor: t.glass.fill,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: t.colors.textPrimary, fontSize: 24, fontWeight: '600' }}>
                {value[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={input}
        accessibilityLabel="6-digit code"
        accessibilityHint="Check your inbox (and spam folder). Codes expire after a short time."
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={LENGTH}
        autoFocus
        caretHidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 58,
          opacity: 0.02,
          color: 'transparent',
        }}
      />
      <Caption>Check your inbox (and spam folder). Codes expire after a short time.</Caption>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: t.colors.danger, fontSize: 13 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Countdown that starts when the screen opens (a code was just sent). */
export function useCooldown(seconds = RESEND_COOLDOWN_SECONDS) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return { left, restart: () => setLeft(seconds) };
}

export function ResendButton({
  secondsLeft,
  busy,
  onResend,
}: {
  secondsLeft: number;
  busy: boolean;
  onResend: () => void;
}) {
  return secondsLeft > 0 ? (
    <View style={{ minHeight: 44, justifyContent: 'center' }}>
      <FinePrint>You can request a new code in {secondsLeft}s.</FinePrint>
    </View>
  ) : (
    <TextButton label="Send a new code" disabled={busy} onPress={onResend} align="center" />
  );
}

export const isSixDigits = (code: string): boolean => /^\d{6}$/.test(code);
