import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { create } from 'zustand';
import {
  Body,
  ErrorState,
  Heading,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '../components/primitives';
import { reportError } from '../lib/error-reporting';
import type { SecureCredentialStore } from '../lib/secure-storage';
import { useSessionStore } from '../state/session-store';
import { useServices } from './services';

/**
 * OPTIONAL local app lock (Face ID / fingerprint / device passcode). It ONLY gates showing the
 * app on this device. It is never server authentication: it does not mint, refresh or replace
 * tokens, and the session/refresh flow is unchanged whether it is on or off.
 */

export type BiometricAvailability = 'available' | 'no_hardware' | 'not_enrolled';

export async function biometricAvailability(): Promise<BiometricAvailability> {
  if (!(await LocalAuthentication.hasHardwareAsync())) return 'no_hardware';
  if (!(await LocalAuthentication.isEnrolledAsync())) return 'not_enrolled';
  return 'available';
}

export async function authenticateLocally(promptMessage: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}

export const isAppLockEnabled = async (store: SecureCredentialStore): Promise<boolean> =>
  (await store.get('karen.app.biometric_lock')) === '1';

export async function setAppLockEnabled(store: SecureCredentialStore, on: boolean): Promise<void> {
  if (on) await store.set('karen.app.biometric_lock', '1');
  else await store.remove('karen.app.biometric_lock');
  useAppLockStore.setState({ enabled: on, locked: false });
}

interface AppLockState {
  enabled: boolean;
  locked: boolean;
}
export const useAppLockStore = create<AppLockState>(() => ({ enabled: false, locked: false }));

/** Shows a lock screen over the app on launch and after returning from the background. */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { store, session } = useServices();
  const status = useSessionStore((s) => s.status);
  const { enabled, locked } = useAppLockStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isAppLockEnabled(store)
      .then((on) => useAppLockStore.setState({ enabled: on, locked: on }))
      .catch((err: unknown) => reportError(err, { op: 'app_lock_read' }));
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' && useAppLockStore.getState().enabled) {
        useAppLockStore.setState({ locked: true });
      }
    });
    return () => sub.remove();
  }, [store]);

  const showLock = enabled && locked && status === 'signed_in';

  const unlock = () => {
    setError(null);
    authenticateLocally('Unlock KAREN')
      .then((ok) => {
        if (ok) useAppLockStore.setState({ locked: false });
        else setError('Not unlocked. Try again, or sign out.');
      })
      .catch((err: unknown) => {
        reportError(err, { op: 'app_unlock' });
        setError('Unlock isn’t available right now. You can sign out and sign in again.');
      });
  };
  const signOut = () => {
    useAppLockStore.setState({ locked: false });
    void session.logout();
  };

  // The navigator stays mounted underneath (keeps navigation state); it is hidden from
  // screen readers while locked.
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={showLock}
        importantForAccessibility={showLock ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {showLock ? (
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
          <LockScreen error={error} onUnlock={unlock} onSignOut={signOut} />
        </View>
      ) : null}
    </View>
  );
}

function LockScreen({
  error,
  onUnlock,
  onSignOut,
}: {
  error: string | null;
  onUnlock: () => void;
  onSignOut: () => void;
}) {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <Heading>KAREN is locked</Heading>
        <Body muted>Unlock with your device to continue. This lock only protects this device.</Body>
        {error ? <ErrorState message={error} /> : null}
        <PrimaryButton label="Unlock" onPress={onUnlock} />
        <SecondaryButton label="Sign out" onPress={onSignOut} />
      </View>
    </Screen>
  );
}
