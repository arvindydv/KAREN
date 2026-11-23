import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { View, type TextInput } from 'react-native';
import { useServices } from '../../src/auth/services';
import { AuthScreen, AuthSwitch } from '../../src/components/auth-screen';
import {
  Banner,
  ErrorState,
  PrimaryButton,
  SecondaryButton,
  TextButton,
  TextField,
} from '../../src/components/primitives';
import { ApiRequestError, describeError } from '../../src/lib/api-error';
import { useSubmit } from '../../src/lib/use-submit';
import { holdCredential } from '../../src/auth/pending-credential';
import { useChallengeStore } from '../../src/state/challenge-store';

export default function SignInScreen() {
  const { session } = useServices();
  const router = useRouter();
  const prefill = useChallengeStore((s) => s.signInEmail);
  const flash = useChallengeStore((s) => s.flash);
  const [email, setEmail] = useState(prefill ?? '');
  const [password, setPassword] = useState('');
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [notice] = useState(flash);
  useEffect(() => {
    // One-shot message: consume it so it doesn't reappear.
    if (flash) useChallengeStore.getState().setFlash(null);
  }, [flash]);

  const submit = useSubmit(
    useCallback(async () => {
      const typed = password;
      const result = await session.login(email.trim(), typed);
      setPassword('');
      if (result.kind === 'verification_required') {
        // Memory-only, single use: once the code is accepted we sign straight in.
        holdCredential(email.trim(), typed);
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

  const canSubmit = email.trim() !== '' && password !== '' && !submit.busy;
  const err = submit.error;
  const next = err instanceof ApiRequestError ? err.nextOptions : [];
  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to continue with KAREN."
      action={
        <>
          <PrimaryButton
            label={submit.busy ? 'Signing in…' : 'Sign in'}
            busy={submit.busy}
            disabled={!canSubmit}
            onPress={() => submit.run()}
          />
        </>
      }
      footer={
        <AuthSwitch
          prompt="New to KAREN?"
          action="Create an account"
          onPress={() => router.replace('/sign-up')}
        />
      }
    >
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        placeholder="you@example.com"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <View style={{ gap: 2 }}>
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secure
          autoCapitalize="none"
          textContentType="password"
          autoComplete="current-password"
          inputRef={passwordRef}
          returnKeyType="go"
          onSubmitEditing={() => {
            if (canSubmit) submit.run();
          }}
        />
        <View style={{ alignItems: 'flex-end' }}>
          <TextButton label="Forgot password?" onPress={() => router.push('/forgot-password')} />
        </View>
      </View>
      {err ? (
        <ErrorState
          message={
            next.includes('CONTACT_SUPPORT')
              ? `${describeError(err)} This account needs help from KAREN support to be restored.`
              : describeError(err)
          }
        />
      ) : null}
      {next.includes('RESET_PASSWORD') ? (
        <SecondaryButton
          label="Reset your password"
          onPress={() => router.push('/forgot-password')}
        />
      ) : null}
    </AuthScreen>
  );
}
