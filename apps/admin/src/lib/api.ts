import 'server-only';
import { createKarenApiClient, type KarenApiClient } from '@karen/api-contracts/client';
import { signedClientIpHeaders } from './client-ip';
import { serverEnv } from './env';

/**
 * Server-side API access. The staff bearer (`kst_…`) is read from the HttpOnly cookie by the
 * caller and attached here; it never reaches the browser. Cookies are never forwarded upstream.
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

const upstreamFetch: typeof fetch = async (input, init) => {
  const env = serverEnv();
  // A Request object (typed client) carries its own headers; merge ours into a copy.
  const base = input instanceof Request ? input : undefined;
  const headers = new Headers(init?.headers ?? base?.headers);
  for (const [k, v] of Object.entries(
    await signedClientIpHeaders(env.INTERNAL_SERVICE_HMAC_SECRET, env.BFF_TRUSTED_PROXY_HOPS),
  )) {
    headers.set(k, v);
  }
  return fetch(base ? new Request(base, { headers }) : input, {
    ...init,
    ...(base ? {} : { headers }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
};

/** Typed client (generated from the published OpenAPI contract). */
export function staffApi(token?: string): KarenApiClient {
  return createKarenApiClient({
    baseUrl: serverEnv().API_INTERNAL_BASE_URL,
    getAccessToken: () => token,
    fetch: upstreamFetch,
  });
}

export interface UpstreamResult {
  status: number;
  /** Parsed JSON body, or null for empty/non-JSON bodies. */
  body: unknown;
}

/**
 * Raw call used by the allowlisted BFF relay (`/api/staff/*`), whose paths are resolved at
 * runtime. Only the headers named here are sent — never the browser's cookies.
 */
export async function callUpstream(options: {
  method: string;
  path: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<UpstreamResult> {
  const headers = new Headers({ accept: 'application/json', ...options.headers });
  headers.set('x-request-id', globalThis.crypto.randomUUID());
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  const init: RequestInit = { method: options.method, headers };
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  const response = await upstreamFetch(
    new URL(options.path, serverEnv().API_INTERNAL_BASE_URL),
    init,
  );
  const text = await response.text();
  let body: unknown = null;
  if (text && (response.headers.get('content-type') ?? '').includes('json')) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null; // upstream sent invalid JSON; the status code is still relayed
    }
  }
  return { status: response.status, body };
}
