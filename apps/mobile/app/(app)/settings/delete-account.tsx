import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useServices } from '../../../src/auth/services';
import {
  Banner,
  Body,
  ErrorState,
  FormScreen,
  PrimaryButton,
  TextField,
  ToggleRow,
} from '../../../src/components/primitives';
import { ScreenHeader } from '../../../src/components/screen-header';
import { describeError, unwrap } from '../../../src/lib/api-error';
import { useSubmit } from '../../../src/lib/use-submit';
import { useChallengeStore } from '../../../src/state/challenge-store';

export default function DeleteAccountScreen() {
  const { api, session } = useServices();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const submit = useSubmit(
    useCallback(async () => {
      const req = await unwrap(
        api.POST('/v1/me/data-rights/deletion', {
          body: { current_password: password, confirm: true },
        }),
      );
      setPassword('');
      const when = req.scheduled_for ? new Date(req.scheduled_for).toLocaleString() : null;
      useChallengeStore
        .getState()
        .setFlash(
          `Deletion scheduled${when ? ` for ${when}` : ''}. Sign in before then if you want to cancel it.`,
        );
      // The server revoked every session (including this one) when scheduling deletion.
      await session.endSessionLocally();
      router.replace('/sign-in');
    }, [api, password, router, session]),
  );
  return (
    <FormScreen>
      <ScreenHeader title="Delete account" />
      <Body>What happens</Body>
      <Body muted>
        Your account is scheduled for deletion and you’re signed out everywhere. During a short
        waiting period you can sign in and cancel. After it, your profile, preferences, consents and
        other personal data are deleted. Some records may be kept where the law or security
        requires; you’ll see which once deletion is scheduled.
      </Body>
      <Banner tone="warning">This can’t be undone after the waiting period ends.</Banner>
      <TextField
        label="Current password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        autoComplete="current-password"
      />
      <ToggleRow
        label="I understand my account and data will be deleted"
        value={confirmed}
        onChange={setConfirmed}
      />
      {submit.error ? <ErrorState message={describeError(submit.error)} /> : null}
      <PrimaryButton
        label={submit.busy ? 'Scheduling…' : 'Delete my account'}
        hint="Requires your password and the confirmation above"
        disabled={submit.busy || password === '' || !confirmed}
        onPress={() => submit.run()}
      />
    </FormScreen>
  );
}
