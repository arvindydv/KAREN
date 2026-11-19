import { createKarenApiClient } from '@karen/api-contracts/client';
import { mobileEnv } from './env';
import { expoSecureCredentialStore, type SecureCredentialStore } from './secure-storage';

/** Typed API client; the access token is read from the secure store per request. */
export const createMobileApiClient = (store: SecureCredentialStore = expoSecureCredentialStore) =>
  createKarenApiClient({
    baseUrl: mobileEnv.EXPO_PUBLIC_API_BASE_URL,
    getAccessToken: async () => (await store.get('karen.auth.access_token')) ?? undefined,
  });
