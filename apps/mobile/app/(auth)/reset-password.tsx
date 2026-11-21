import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useApi } from '../../src/auth/services';
import { CodeField, ResendButton, isSixDigits, useCooldown } from '../../src/components/code-entry';
import {
  Banner,
  Body,
  EmptyState,
  ErrorState,
  FormScreen,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from '../../src/components/primitives';
import { ScreenHeader } from '../../src/components/screen-header';
import { PASSWORD_RULES_HINT, describeError, unwrap } from '../../src/lib/api-error';
import { useSubmit } from '../../src/lib/use-submit';
import { passwordProblem } from '../../src/lib/validation';
import { useChallengeStore } from '../../src/state/challenge-store';

export default function ResetPasswordScreen() {
  const api = useApi();
  const router = useRouter();
  const pending = useChallengeStore((s) => s.pending);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [resent, setResent] = useState(false);
  const cooldown = useCooldown();

  const reset = useSubmit(
    useCallback(async () => {
      if (!pending) return;
      await unwrap(
        api.POST('/v1/auth/password/reset', {
          body: { challenge_handle: pending.handle, code, new_password: password },
        }),
      );
      setPassword('');
      useChallengeStore.getState().finish('Password changed. Sign in with your new password.');
      router.replace('/sign-in');
    }, [api, code, password, pending, router]),
  );
  const resend = useSubmit(
    useCallback(async () => {
      if (!pending) return;
      const next = await unwrap(
        api.POST('/v1/auth/challenges/resend', { body: { challenge_handle: pending.handle } }),
      );
      useChallengeStore.getState().updateHandle(next.challenge_handle, next.expires_at);
      setResent(true);
      cooldown.restart();
    }, [api, cooldown, pending]),
  );

  if (!pending || pending.purpose !== 'reset_password') {
    return (
      <FormScreen>
        <ScreenHeader title="Choose a new password" />
        <EmptyState
          title="No password reset in progress."
          message="Start again to get a new code."
        />
        <SecondaryButton
          label="Reset password"
          onPress={() => router.replace('/forgot-password')}
        />
      </FormScreen>
    );
  }
  const pwProblem = password === '' ? null : passwordProblem(password);
  const error = reset.error ?? resend.error;
  return (
    <FormScreen>
      <ScreenHeader title="Choose a new password" />
      <Body muted>If {pending.email} has a KAREN account, we’ve sent it a 6-digit code.</Body>
      {resent ? <Banner tone="success">A new code is on its way.</Banner> : null}
      <CodeField value={code} onChange={setCode} />
      <TextField
        label="New password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        textContentType="newPassword"
        autoComplete="new-password"
        hint={PASSWORD_RULES_HINT}
        error={pwProblem}
      />
      {error ? <ErrorState message={describeError(error)} /> : null}
      <PrimaryButton
        label={reset.busy ? 'Saving…' : 'Set new password'}
        disabled={reset.busy || !isSixDigits(code) || password === '' || pwProblem !== null}
        onPress={() => reset.run()}
      />
      <ResendButton secondsLeft={cooldown.left} busy={resend.busy} onResend={() => resend.run()} />
    </FormScreen>
  );
}
