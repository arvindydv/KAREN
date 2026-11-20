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
} from '../../src/components/primitives';
import { ScreenHeader } from '../../src/components/screen-header';
import { describeError, unwrap } from '../../src/lib/api-error';
import { useSubmit } from '../../src/lib/use-submit';
import { useChallengeStore } from '../../src/state/challenge-store';

export default function VerifyEmailScreen() {
  const api = useApi();
  const router = useRouter();
  const pending = useChallengeStore((s) => s.pending);
  const { finish, updateHandle } = useChallengeStore.getState();
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const cooldown = useCooldown();

  const verify = useSubmit(
    useCallback(async () => {
      if (!pending) return;
      await unwrap(
        api.POST('/v1/auth/verify-email', { body: { challenge_handle: pending.handle, code } }),
      );
      finish('E-mail verified. Sign in to continue.');
      router.replace('/sign-in');
    }, [api, code, finish, pending, router]),
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
      <FormScreen>
        <ScreenHeader title="Verify your e-mail" />
        <EmptyState
          title="No verification in progress."
          message="Sign in with your e-mail and password and we’ll send a fresh code."
        />
        <SecondaryButton label="Go to sign in" onPress={() => router.replace('/sign-in')} />
      </FormScreen>
    );
  }

  const error = verify.error ?? resend.error;
  return (
    <FormScreen>
      <ScreenHeader title="Verify your e-mail" />
      <Body muted>
        If {pending.email} can be used for a KAREN account, we’ve sent a 6-digit code to it.
      </Body>
      {resent ? <Banner tone="success">A new code is on its way.</Banner> : null}
      <CodeField value={code} onChange={setCode} />
      {error ? <ErrorState message={describeError(error)} /> : null}
      <PrimaryButton
        label={verify.busy ? 'Verifying…' : 'Verify'}
        disabled={!isSixDigits(code) || verify.busy}
        hint={isSixDigits(code) ? undefined : 'Enter all 6 digits first'}
        onPress={() => verify.run()}
      />
      <ResendButton secondsLeft={cooldown.left} busy={resend.busy} onResend={() => resend.run()} />
    </FormScreen>
  );
}
