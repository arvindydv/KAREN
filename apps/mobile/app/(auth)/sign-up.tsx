import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useApi } from '../../src/auth/services';
import {
  Body,
  Caption,
  ErrorState,
  FormScreen,
  PrimaryButton,
  TextButton,
  TextField,
} from '../../src/components/primitives';
import { ScreenHeader } from '../../src/components/screen-header';
import { PASSWORD_RULES_HINT, describeError, unwrap } from '../../src/lib/api-error';
import { useSubmit } from '../../src/lib/use-submit';
import { deviceTimezone, looksLikeEmail, passwordProblem } from '../../src/lib/validation';
import { useChallengeStore } from '../../src/state/challenge-store';

export default function SignUpScreen() {
  const api = useApi();
  const router = useRouter();
  const setPending = useChallengeStore((s) => s.setPending);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

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
      setPassword('');
      router.push('/verify-email');
    }, [api, email, password, router, setPending]),
  );

  const onSubmit = () => {
    setTouched(true);
    if (!looksLikeEmail(email) || passwordProblem(password)) return;
    submit.run();
  };

  return (
    <FormScreen>
      <ScreenHeader title="Create your account" />
      <Body muted>We’ll send a 6-digit code to confirm your e-mail address.</Body>
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
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
      />
      {submit.error ? <ErrorState message={describeError(submit.error)} /> : null}
      <PrimaryButton
        label={submit.busy ? 'Creating account…' : 'Create account'}
        disabled={submit.busy}
        onPress={onSubmit}
      />
      <Caption>
        During setup you’ll be asked to read and accept the Privacy Notice and Terms. Optional
        permissions (like memory) are always off until you turn them on.
      </Caption>
      <TextButton
        label="Read the Privacy Notice"
        onPress={() => router.push('/notice?kind=privacy_notice')}
      />
      <TextButton
        label="Already have an account? Sign in"
        onPress={() => router.replace('/sign-in')}
      />
    </FormScreen>
  );
}
