import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { takeCredential } from '../../src/auth/pending-credential';
import { useServices } from '../../src/auth/services';
import { CodeField, ResendButton, isSixDigits, useCooldown } from '../../src/components/code-entry';
import { AuthScreen } from '../../src/components/auth-screen';
import {
  Banner,
  EmptyState,
  ErrorState,
  PrimaryButton,
  SecondaryButton,
} from '../../src/components/primitives';
import { describeError, unwrap } from '../../src/lib/api-error';
import { reportError } from '../../src/lib/error-reporting';
import { useSubmit } from '../../src/lib/use-submit';
import { useChallengeStore } from '../../src/state/challenge-store';

export default function VerifyEmailScreen() {
  const { api, session } = useServices();
  const router = useRouter();
  const pending = useChallengeStore((s) => s.pending);
  const { finish, updateHandle, setAfterSignIn } = useChallengeStore.getState();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const cameFromSignUp = from === 'sign-up';
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const cooldown = useCooldown();

  const verify = useSubmit(
    useCallback(async () => {
      if (!pending) return;
      await unwrap(
        api.POST('/v1/auth/verify-email', { body: { challenge_handle: pending.handle, code } }),
      );
      // The code is spent from here on: never surface a later failure as a code error.
      const password = takeCredential(pending.email);
      if (password) {
        // Set the destination BEFORE sign-in lands: the (auth) layout redirects the moment the
        // session flips to signed_in. A new account goes straight to setup.
        setAfterSignIn(cameFromSignUp ? '/onboarding' : null);
        try {
          const result = await session.login(pending.email, password);
          if (result.kind === 'signed_in') return; // pending is cleared by the (app) layout
        } catch (err) {
          reportError(err, { op: 'auto_sign_in_after_verify' });
        }
        setAfterSignIn(null);
      }
      // No held password (app restarted) or auto sign-in failed: fall back to sign-in.
      finish('E-mail verified. Sign in to continue.');
      router.replace('/sign-in');
    }, [api, cameFromSignUp, code, finish, pending, router, session, setAfterSignIn]),
  );
  const resend = useSubmit(
    useCallback(async () => {
      if (!pending) return;
      const next = await unwrap(
        api.POST('/v1/auth/challenges/resend', { body: { challenge_handle: pending.handle } }),
      );
      updateHandle(next.challenge_handle, next.expires_at);
      setResent(true);
      setCode('');
      cooldown.restart();
    }, [api, cooldown, pending, updateHandle]),
  );

  if (!pending || pending.purpose !== 'verify_email') {
    return (
      <AuthScreen
        title="Verify your e-mail"
        action={
          <SecondaryButton label="Go to sign in" onPress={() => router.replace('/sign-in')} />
        }
      >
        <EmptyState
          title="No verification in progress."
          message="Sign in with your e-mail and password and we’ll send a fresh code."
        />
      </AuthScreen>
    );
  }

  const error = verify.error ?? resend.error;
  return (
    <AuthScreen
      title="Check your e-mail"
      subtitle={`If ${pending.email} can be used for a KAREN account, we’ve sent a 6-digit code to it.`}
      action={
        <>
          <PrimaryButton
            label={verify.busy ? 'Verifying…' : 'Verify'}
            busy={verify.busy}
            disabled={!isSixDigits(code)}
            hint={isSixDigits(code) ? undefined : 'Enter all 6 digits first'}
            onPress={() => verify.run()}
          />
          <ResendButton
            secondsLeft={cooldown.left}
            busy={resend.busy}
            onResend={() => resend.run()}
          />
        </>
      }
    >
      {resent ? <Banner tone="success">A new code is on its way.</Banner> : null}
      <CodeField value={code} onChange={setCode} />
      {error ? <ErrorState message={describeError(error)} /> : null}
    </AuthScreen>
  );
}
