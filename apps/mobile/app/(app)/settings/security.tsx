import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  authenticateLocally,
  biometricAvailability,
  setAppLockEnabled,
  useAppLockStore,
  type BiometricAvailability,
} from '../../../src/auth/app-lock';
import { useServices } from '../../../src/auth/services';
import {
  Body,
  Caption,
  EmptyState,
  ErrorState,
  FormScreen,
  GlassCard,
  LinkRow,
  SecondaryButton,
  ToggleRow,
} from '../../../src/components/primitives';
import { QueryView } from '../../../src/components/query-view';
import { ScreenHeader } from '../../../src/components/screen-header';
import { describeError, unwrap } from '../../../src/lib/api-error';
import { reportError } from '../../../src/lib/error-reporting';
import { qk, useDevices, useSessions } from '../../../src/lib/queries';
import { useSubmit } from '../../../src/lib/use-submit';

const when = (iso: string) => new Date(iso).toLocaleString();
const CLIENT_LABEL = { web: 'Web', ios: 'iOS app', android: 'Android app' } as const;

export default function SecurityScreen() {
  const router = useRouter();
  const { api, session } = useServices();
  const client = useQueryClient();
  const sessions = useSessions();
  const devices = useDevices();
  const [actionError, setActionError] = useState<unknown>(null);

  const refreshLists = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: qk.sessions }),
      client.invalidateQueries({ queryKey: qk.devices }),
    ]);

  const revokeSession = useSubmit(
    useCallback(
      async (id: string, current: boolean) => {
        setActionError(null);
        if (current) return session.logout();
        await unwrap(api.DELETE('/v1/me/sessions/{id}', { params: { path: { id } } }));
        await refreshLists();
      },
      [api, session], // eslint-disable-line react-hooks/exhaustive-deps
    ),
  );
  const revokeDevice = useSubmit(
    useCallback(
      async (id: string, current: boolean) => {
        setActionError(null);
        await unwrap(api.DELETE('/v1/me/devices/{id}', { params: { path: { id } } }));
        // Revoking this device ends this session on the server too.
        if (current) return session.endSessionLocally();
        await refreshLists();
      },
      [api, session], // eslint-disable-line react-hooks/exhaustive-deps
    ),
  );
  const signOutAll = useSubmit(useCallback(() => session.logout({ all: true }), [session]));
  const error = actionError ?? revokeSession.error ?? revokeDevice.error ?? signOutAll.error;

  return (
    <FormScreen>
      <ScreenHeader title="Security" />
      <GlassCard>
        <LinkRow label="Change password" onPress={() => router.push('/settings/change-password')} />
        <LinkRow label="Change e-mail" onPress={() => router.push('/settings/change-email')} />
      </GlassCard>

      <AppLockSetting />

      <Body>Signed-in sessions</Body>
      <QueryView query={sessions} loadingLabel="Loading sessions">
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState title="No active sessions." />
          ) : (
            <View style={{ gap: 12 }}>
              {d.items.map((s) => (
                <GlassCard key={s.id} style={{ gap: 6 }}>
                  <Body>
                    {s.device_name ?? CLIENT_LABEL[s.client]}
                    {s.current ? ' · this device' : ''}
                  </Body>
                  <Caption>
                    {CLIENT_LABEL[s.client]} · last active {when(s.last_seen_at)} · expires{' '}
                    {when(s.expires_at)}
                  </Caption>
                  <SecondaryButton
                    label={s.current ? 'Sign out of this device' : 'Sign out this session'}
                    destructive
                    disabled={revokeSession.busy}
                    onPress={() => revokeSession.run(s.id, s.current)}
                  />
                </GlassCard>
              ))}
            </View>
          )
        }
      </QueryView>

      <Body>Devices</Body>
      <QueryView query={devices} loadingLabel="Loading devices">
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState title="No devices yet." />
          ) : (
            <View style={{ gap: 12 }}>
              {d.items.map((dev) => (
                <GlassCard key={dev.id} style={{ gap: 6 }}>
                  <Body>
                    {dev.name ?? CLIENT_LABEL[dev.platform]}
                    {dev.current ? ' · this device' : ''}
                  </Body>
                  <Caption>
                    First seen {when(dev.first_seen_at)} · {dev.active_sessions} active session(s)
                  </Caption>
                  <SecondaryButton
                    label="Remove device"
                    hint={dev.current ? 'Signs this device out' : 'Signs that device out'}
                    destructive
                    disabled={revokeDevice.busy}
                    onPress={() => revokeDevice.run(dev.id, dev.current)}
                  />
                </GlassCard>
              ))}
            </View>
          )
        }
      </QueryView>

      {error ? <ErrorState message={describeError(error)} /> : null}
      <SecondaryButton
        label={signOutAll.busy ? 'Signing out…' : 'Sign out everywhere'}
        hint="Ends every session, including this one"
        destructive
        disabled={signOutAll.busy}
        onPress={() => signOutAll.run()}
      />
    </FormScreen>
  );
}

/** Optional local biometric lock. Device-only; never server authentication. */
function AppLockSetting() {
  const { store } = useServices();
  const enabled = useAppLockStore((s) => s.enabled);
  const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    biometricAvailability()
      .then(setAvailability)
      .catch((err: unknown) => {
        reportError(err, { op: 'biometric_availability' });
        setAvailability('no_hardware');
      });
  }, []);

  const toggle = (next: boolean) => {
    setError(null);
    const confirm = next ? authenticateLocally('Turn on app lock') : Promise.resolve(true);
    confirm
      .then(async (ok) => {
        if (!ok) return setError('App lock wasn’t turned on.');
        await setAppLockEnabled(store, next);
      })
      .catch((err: unknown) => {
        reportError(err, { op: 'app_lock_toggle' });
        setError('Couldn’t change app lock. Please try again.');
      });
  };

  const reason =
    availability === 'no_hardware'
      ? 'This device doesn’t support biometric unlock.'
      : availability === 'not_enrolled'
        ? 'Set up Face ID, Touch ID or fingerprint in your device settings first.'
        : undefined;
  return (
    <GlassCard style={{ gap: 6 }}>
      <ToggleRow
        label="App lock"
        description="Ask for Face ID, fingerprint or your device passcode when opening KAREN. Only affects this device."
        value={enabled}
        disabled={availability !== 'available' && !enabled}
        {...(reason ? { disabledReason: reason } : {})}
        onChange={toggle}
      />
      {error ? <ErrorState message={error} /> : null}
    </GlassCard>
  );
}
