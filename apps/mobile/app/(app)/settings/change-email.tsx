import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useApi } from '../../../src/auth/services';
import {
  CodeField,
  ResendButton,
  isSixDigits,
  useCooldown,
} from '../../../src/components/code-entry';
import {
  Banner,
  Body,
  ErrorState,
  FormScreen,
  PrimaryButton,
  TextField,
} from '../../../src/components/primitives';
import { ScreenHeader } from '../../../src/components/screen-header';
import { describeError, unwrap } from '../../../src/lib/api-error';
import { qk } from '../../../src/lib/queries';
import { useSubmit } from '../../../src/lib/use-submit';
import { looksLikeEmail } from '../../../src/lib/validation';

/** Two phases in one screen; the challenge handle stays in component memory only. */
export default function ChangeEmailScreen() {
  const api = useApi();
  const client = useQueryClient();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const cooldown = useCooldown();

  const start = useSubmit(
    useCallback(async () => {
      const challenge = await unwrap(
        api.POST('/v1/me/email-change', {
          body: { new_email: newEmail.trim(), current_password: password },
        }),
      );
      setPassword('');
      setHandle(challenge.challenge_handle);
      cooldown.restart();
    }, [api, cooldown, newEmail, password]),
  );
  const confirm = useSubmit(
    useCallback(async () => {
      if (!handle) return;
      const res = await unwrap(
        api.POST('/v1/me/email-change/confirm', { body: { challenge_handle: handle, code } }),
      );
      setChangedTo(res.email);
      setHandle(null);
      await client.invalidateQueries({ queryKey: qk.profile });
    }, [api, client, code, handle]),
  );
  const resend = useSubmit(
    useCallback(async () => {
      if (!handle) return;
      const next = await unwrap(
        api.POST('/v1/auth/challenges/resend', { body: { challenge_handle: handle } }),
      );
      setHandle(next.challenge_handle);
      cooldown.restart();
    }, [api, cooldown, handle]),
  );

  if (changedTo) {
    return (
      <FormScreen>
        <ScreenHeader title="Change e-mail" />
        <Banner tone="success">Your e-mail is now {changedTo}.</Banner>
      </FormScreen>
    );
  }
  if (handle) {
    const error = confirm.error ?? resend.error;
    return (
      <FormScreen>
        <ScreenHeader title="Confirm new e-mail" />
        <Body muted>We sent a 6-digit code to {newEmail.trim()}. Enter it to finish.</Body>
        <CodeField value={code} onChange={setCode} />
        {error ? <ErrorState message={describeError(error)} /> : null}
        <PrimaryButton
          label={confirm.busy ? 'Confirming…' : 'Confirm'}
          disabled={confirm.busy || !isSixDigits(code)}
          onPress={() => confirm.run()}
        />
        <ResendButton
          secondsLeft={cooldown.left}
          busy={resend.busy}
          onResend={() => resend.run()}
        />
      </FormScreen>
    );
  }
  return (
    <FormScreen>
      <ScreenHeader title="Change e-mail" />
      <Body muted>
        We’ll send a code to the new address. Your current address stays active until you confirm.
      </Body>
      <TextField
        label="New e-mail"
        value={newEmail}
        onChangeText={setNewEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextField
        label="Current password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        autoComplete="current-password"
      />
      {start.error ? <ErrorState message={describeError(start.error)} /> : null}
      <PrimaryButton
        label={start.busy ? 'Sending…' : 'Send code'}
        disabled={start.busy || !looksLikeEmail(newEmail) || password === ''}
        onPress={() => start.run()}
      />
    </FormScreen>
  );
}
