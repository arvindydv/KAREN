import { fetch as expoFetch } from 'expo/fetch';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import {
  createAuthTransport,
  createAuthedFetch,
  createMobileApiClient,
  type KarenApiClient,
} from '../lib/api';
import { mobileEnv } from '../lib/env';
import { reportError } from '../lib/error-reporting';
import { expoSecureCredentialStore, type SecureCredentialStore } from '../lib/secure-storage';
import { newUuid } from '../lib/uuid';
import { useSessionStore } from '../state/session-store';
import { SessionManager } from './session-manager';

export interface AppServices {
  session: SessionManager;
  api: KarenApiClient;
  store: SecureCredentialStore;
  /** API origin (for the chat SSE client, which cannot use the typed JSON client). */
  baseUrl: string;
  /** Streaming-capable fetch for SSE (`expo/fetch`; React Native's global fetch buffers). */
  streamFetch: typeof globalThis.fetch;
}

/** Wire the session manager into the typed API client (getAccessToken + 401 retry). */
export function createAppServices(options: {
  store: SecureCredentialStore;
  fetch?: typeof globalThis.fetch;
  streamFetch?: typeof globalThis.fetch;
  baseUrl?: string;
  platform?: 'ios' | 'android';
}): AppServices {
  const platform = options.platform ?? (Platform.OS === 'ios' ? 'ios' : 'android');
  const transport = createAuthTransport({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
  const session = new SessionManager({
    store: options.store,
    transport,
    platform,
    newUuid,
    deviceName: platform === 'ios' ? 'iPhone' : 'Android phone',
    onError: (error, context) => reportError(error, context),
  });
  const api = createMobileApiClient({
    getAccessToken: () => session.getAccessToken(),
    fetch: createAuthedFetch(session, options.fetch),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
  return {
    session,
    api,
    store: options.store,
    baseUrl: options.baseUrl ?? mobileEnv.EXPO_PUBLIC_API_BASE_URL,
    streamFetch: options.streamFetch ?? options.fetch ?? expoFetch,
  };
}

let defaultServices: AppServices | undefined;
export const getDefaultServices = (): AppServices =>
  (defaultServices ??= createAppServices({ store: expoSecureCredentialStore }));

const ServicesContext = createContext<AppServices | null>(null);

/**
 * Provides services, mirrors session state into Zustand, restores the session on launch and
 * refreshes proactively when the app returns to the foreground.
 */
export function ServicesProvider({
  services,
  children,
  restoreOnMount = true,
}: {
  services: AppServices;
  children: ReactNode;
  restoreOnMount?: boolean;
}) {
  useEffect(() => {
    const sync = useSessionStore.getState().sync;
    sync(services.session.getSnapshot());
    const unsubscribe = services.session.subscribe(sync);
    if (restoreOnMount) {
      services.session.restore().catch((err: unknown) => {
        reportError(err, { op: 'session_restore' });
        // A broken keystore must not trap the user on a spinner.
        void services.session.endSessionLocally();
      });
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        services.session.onForeground().catch((err: unknown) => reportError(err, { op: 'fg' }));
      }
    });
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, [services, restoreOnMount]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices must be used inside <ServicesProvider>');
  return s;
}

export const useApi = (): KarenApiClient => useServices().api;
