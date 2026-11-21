import { useCallback, useState } from 'react';
import { useApi } from '../../../src/auth/services';
import {
  Banner,
  ErrorState,
  FormScreen,
  PrimaryButton,
  TextField,
} from '../../../src/components/primitives';
import { ScreenHeader } from '../../../src/components/screen-header';
import { PASSWORD_RULES_HINT, describeError, unwrap } from '../../../src/lib/api-error';
import { useSubmit } from '../../../src/lib/use-submit';
import { passwordProblem } from '../../../src/lib/validation';

export default function ChangePasswordScreen() {
  const api = useApi();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const submit = useSubmit(
    useCallback(async () => {
      setDone(null);
      const res = await unwrap(
        api.POST('/v1/me/password', { body: { current_password: current, new_password: next } }),
      );
      setCurrent('');
      setNext('');
      setDone(res.revoked_sessions);
    }, [api, current, next]),
  );
  const problem = next === '' ? null : passwordProblem(next);
  return (
    <FormScreen>
      <ScreenHeader title="Change password" />
      <TextField
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secure
        autoCapitalize="none"
        textContentType="password"
        autoComplete="current-password"
      />
      <TextField
        label="New password"
        value={next}
        onChangeText={setNext}
        secure
        autoCapitalize="none"
        textContentType="newPassword"
        autoComplete="new-password"
        hint={PASSWORD_RULES_HINT}
        error={problem}
      />
      {done !== null ? (
        <Banner tone="success">
          Password changed.{' '}
          {done > 0 ? `${done} other session(s) were signed out.` : 'You stay signed in here.'}
        </Banner>
      ) : null}
      {submit.error ? <ErrorState message={describeError(submit.error)} /> : null}
      <PrimaryButton
        label={submit.busy ? 'Saving…' : 'Change password'}
        disabled={submit.busy || current === '' || next === '' || problem !== null}
        onPress={() => submit.run()}
      />
    </FormScreen>
  );
}
