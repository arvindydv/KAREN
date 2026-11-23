import { useRouter } from 'expo-router';
import { useCallback, useRef, useState, type ComponentRef } from 'react';
import type { TextInput } from 'react-native';
import { useApi } from '../../src/auth/services';
import { AuthScreen, AuthSwitch, FinePrint, InlineLink } from '../../src/components/auth-screen';
import { ErrorState, PrimaryButton, TextField } from '../../src/components/primitives';
import { PASSWORD_RULES_HINT, describeError, unwrap } from '../../src/lib/api-error';
import { useSubmit } from '../../src/lib/use-submit';
import { deviceTimezone, looksLikeEmail, passwordProblem } from '../../src/lib/validation';
import { holdCredential } from '../../src/auth/pending-credential';
import { useChallengeStore } from '../../src/state/challenge-store';

export default function SignUpScreen() {
  const api = useApi();
  const router = useRouter();
  const setPending = useChallengeStore((s) => s.setPending);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const emailError = touched && !looksLikeEmail(email) ? 'Enter a valid e-mail address.' : null;
  const pwError = touched ? passwordProblem(password) : null;

  const submit = useSubmit(
    useCallback(async () => {
      const timezone = deviceTimezone();
      const challenge = await unwrap(
        api.POST('/v1/auth/register', {
          body: {
            email: email.trim(),
            password,
            locale: 'en-IN',
            ...(timezone ? { timezone } : {}),
          },
        }),
      );
      setPending({
        purpose: 'verify_email',
        handle: challenge.challenge_handle,
        email: email.trim(),
        expiresAt: challenge.expires_at,
      });
      // Memory-only, single use: lets verify-email sign the user straight in.
      holdCredential(email.trim(), password);
      setPassword('');
      router.push({ pathname: '/verify-email', params: { from: 'sign-up' } });
    }, [api, email, password, router, setPending]),
  );

  const onSubmit = () => {
    setTouched(true);
    if (!looksLikeEmail(email) || passwordProblem(password)) return;
    submit.run();
  };

  return (
    <AuthScreen
      title="Create your account"
      subtitle="We’ll send a 6-digit code to confirm your e-mail."
      action={
        <>
          <PrimaryButton
            label={submit.busy ? 'Creating account…' : 'Create account'}
            busy={submit.busy}
            onPress={onSubmit}
          />
          <FinePrint>
            You’ll review the{' '}
            <InlineLink
              label="Privacy Notice"
              onPress={() => router.push('/notice?kind=privacy_notice')}
            />{' '}
            and Terms during setup.
          </FinePrint>
        </>
      }
      footer={
        <AuthSwitch
          prompt="Already have an account?"
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
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        error={emailError}
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        textContentType="newPassword"
        autoComplete="new-password"
        hint={PASSWORD_RULES_HINT}
        error={pwError}
        inputRef={passwordRef}
        returnKeyType="go"
        onSubmitEditing={onSubmit}
      />
      {submit.error ? <ErrorState message={describeError(submit.error)} /> : null}
    </AuthScreen>
  );
}
