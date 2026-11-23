import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useApi } from '../../src/auth/services';
import { AuthScreen, AuthSwitch } from '../../src/components/auth-screen';
import { ErrorState, PrimaryButton, TextField } from '../../src/components/primitives';
import { describeError, unwrap } from '../../src/lib/api-error';
import { useSubmit } from '../../src/lib/use-submit';
import { looksLikeEmail } from '../../src/lib/validation';
import { useChallengeStore } from '../../src/state/challenge-store';

export default function ForgotPasswordScreen() {
  const api = useApi();
  const router = useRouter();
  const [email, setEmail] = useState(useChallengeStore.getState().signInEmail ?? '');
  const submit = useSubmit(
    useCallback(async () => {
      const challenge = await unwrap(
        api.POST('/v1/auth/password/forgot', { body: { email: email.trim() } }),
      );
      useChallengeStore.getState().setPending({
        purpose: 'reset_password',
        handle: challenge.challenge_handle,
        email: email.trim(),
        expiresAt: challenge.expires_at,
      });
      router.push('/reset-password');
    }, [api, email, router]),
  );
  return (
    <AuthScreen
      title="Reset your password"
      subtitle="Enter your account e-mail and we’ll send a 6-digit code to reset your password."
      action={
        <>
          <PrimaryButton
            label={submit.busy ? 'Sending…' : 'Send code'}
            busy={submit.busy}
            disabled={!looksLikeEmail(email)}
            onPress={() => submit.run()}
          />
        </>
      }
      footer={
        <AuthSwitch
          prompt="Remembered it?"
          action="Sign in"
          onPress={() => router.replace('/sign-in')}
        />
      }
    >
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        placeholder="you@example.com"
        error={email !== '' && !looksLikeEmail(email) ? 'Enter a valid e-mail address.' : null}
      />
      {submit.error ? <ErrorState message={describeError(submit.error)} /> : null}
    </AuthScreen>
  );
}
