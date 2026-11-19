import * as SecureStore from 'expo-secure-store';

/**
 * Credential storage abstraction. Sensitive values (refresh/access tokens) live ONLY in the
 * OS keystore/keychain via expo-secure-store — never AsyncStorage, never Zustand persistence.
 * The interface allows an in-memory fake in tests.
 */
export interface SecureCredentialStore {
  get(key: SecureKey): Promise<string | null>;
  set(key: SecureKey, value: string): Promise<void>;
  remove(key: SecureKey): Promise<void>;
}

export type SecureKey = 'karen.auth.refresh_token' | 'karen.auth.access_token';

const OPTIONS: SecureStore.SecureStoreOptions = {
  // Not readable while the device is locked; not migrated to new devices via backup.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoSecureCredentialStore: SecureCredentialStore = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};

export function createInMemoryCredentialStore(): SecureCredentialStore {
  const data = new Map<SecureKey, string>();
  return {
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}
