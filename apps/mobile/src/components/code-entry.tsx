import { useEffect, useState } from 'react';
import { Caption, TextButton, TextField } from './primitives';

export const RESEND_COOLDOWN_SECONDS = 30;

/** 6-digit one-time-code input with OS autofill hints. */
export function CodeField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (code: string) => void;
  error?: string | null;
}) {
  return (
    <TextField
      label="6-digit code"
      value={value}
      onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 6))}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={6}
      hint="Check your inbox (and spam folder). Codes expire after a short time."
      error={error ?? null}
    />
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
    <Caption>You can request a new code in {secondsLeft}s.</Caption>
  ) : (
    <TextButton label="Send a new code" disabled={busy} onPress={onResend} />
  );
}

export const isSixDigits = (code: string): boolean => /^\d{6}$/.test(code);
