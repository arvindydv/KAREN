import { createKarenApiClient, type KarenApiClient } from '@karen/api-contracts/client';
import type { AuthTransport } from '../auth/session-manager';
import { unwrap } from './api-error';
import { mobileEnv } from './env';

export type { KarenApiClient } from '@karen/api-contracts/client';

/** What the fetch wrapper needs from the session manager. */
export interface UnauthorizedHandler {
  handleUnauthorized(usedToken: string | undefined): Promise<string | undefined>;
  setAccountStatus(status: 'ACTIVE' | 'DELETION_REQUESTED'): Promise<void>;
}

const bearerOf = (header: string | null): string | undefined =>
  header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

/**
 * fetch wrapper for authenticated calls:
 * - on 401 for a request that carried a token, ask the session manager for a fresh token
 *   (single-flight refresh) and retry ONCE;
 * - on 403 ACCOUNT_INACTIVE with next option CANCEL_DELETION, flip the session to the
 *   restricted "deletion scheduled" state so navigation shows the dedicated screen.
 */
export function createAuthedFetch(
  session: UnauthorizedHandler,
  baseFetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args),
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const retry = request.clone();
    const used = bearerOf(request.headers.get('authorization'));
    const response = await baseFetch(request);
    if (response.status === 401 && used) {
      const fresh = await session.handleUnauthorized(used);
      if (!fresh) return response;
      retry.headers.set('authorization', `Bearer ${fresh}`);
      return baseFetch(retry);
    }
    if (response.status === 403) {
      try {
        const body = (await response.clone().json()) as {
          error?: { code?: string; next_options?: string[] };
        };
        if (
          body.error?.code === 'ACCOUNT_INACTIVE' &&
          body.error.next_options?.includes('CANCEL_DELETION')
        ) {
          await session.setAccountStatus('DELETION_REQUESTED');
        }
      } catch (err) {
        // Non-JSON 403 body: nothing to inspect; the caller still gets the response.
        if (__DEV__) console.warn('[karen] unreadable 403 body', (err as Error).name); // eslint-disable-line no-console
      }
    }
    return response;
  };
}

/** Typed API client for signed-in calls. */
export const createMobileApiClient = (options: {
  getAccessToken: () => Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}): KarenApiClient =>
  createKarenApiClient({
    baseUrl: options.baseUrl ?? mobileEnv.EXPO_PUBLIC_API_BASE_URL,
    getAccessToken: options.getAccessToken,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

/**
 * Auth transport used by the session manager. Uses an UNAUTHENTICATED client so login and
 * refresh never recurse into token refresh.
 */
export function createAuthTransport(options: {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}): AuthTransport {
  const client = createKarenApiClient({
    baseUrl: options.baseUrl ?? mobileEnv.EXPO_PUBLIC_API_BASE_URL,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    login: (body) => unwrap(client.POST('/v1/auth/login', { body })),
    refresh: (body) => unwrap(client.POST('/v1/auth/token/refresh', { body })),
    logout: async (accessToken, all) => {
      const headers = { authorization: `Bearer ${accessToken}` };
      await unwrap(
        all
          ? client.POST('/v1/auth/logout-all', { headers })
          : client.POST('/v1/auth/logout', { headers }),
      );
    },
  };
}
