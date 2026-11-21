import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../src/auth/services';
import {
  Banner,
  Caption,
  ErrorState,
  FormScreen,
  PrimaryButton,
  TextButton,
  TextField,
} from '../../src/components/primitives';
import { ScreenHeader } from '../../src/components/screen-header';
import { ApiRequestError, describeError } from '../../src/lib/api-error';
import { useSubmit } from '../../src/lib/use-submit';
import { useChallengeStore } from '../../src/state/challenge-store';

export default function SignInScreen() {
  const { session } = useServices();
  const router = useRouter();
  const prefill = useChallengeStore((s) => s.signInEmail);
  const flash = useChallengeStore((s) => s.flash);
  const [email, setEmail] = useState(prefill ?? '');
  const [password, setPassword] = useState('');
  const [notice] = useState(flash);
  useEffect(() => {
    // One-shot message: consume it so it doesn't reappear.
    if (flash) useChallengeStore.getState().setFlash(null);
  }, [flash]);

  const submit = useSubmit(
    useCallback(async () => {
      const result = await session.login(email.trim(), password);
      setPassword('');
      if (result.kind === 'verification_required') {
        useChallengeStore.getState().setPending({
          purpose: 'verify_email',
          handle: result.challenge.challenge_handle,
          email: email.trim(),
          expiresAt: result.challenge.expires_at,
        });
        router.push('/verify-email');
      }
      // signed_in: the (auth) layout redirects on the session status change.
    }, [email, password, router, session]),
  );

  const err = submit.error;
  const next = err instanceof ApiRequestError ? err.nextOptions : [];
  return (
    <FormScreen>
      <ScreenHeader title="Sign in" />
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        textContentType="password"
        autoComplete="current-password"
        onSubmitEditing={() => submit.run()}
      />
      {err ? <ErrorState message={describeError(err)} /> : null}
      {next.includes('RESET_PASSWORD') ? (
        <TextButton label="Reset your password" onPress={() => router.push('/forgot-password')} />
      ) : null}
      {next.includes('CONTACT_SUPPORT') ? (
        <Caption>This account needs help from KAREN support to be restored.</Caption>
      ) : null}
      <PrimaryButton
        label={submit.busy ? 'Signing in…' : 'Sign in'}
        disabled={submit.busy || email.trim() === '' || password === ''}
        onPress={() => submit.run()}
      />
      <TextButton label="Forgot password?" onPress={() => router.push('/forgot-password')} />
      <TextButton
        label="New to KAREN? Create an account"
        onPress={() => router.replace('/sign-up')}
      />
    </FormScreen>
  );
}
