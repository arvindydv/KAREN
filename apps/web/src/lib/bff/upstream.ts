/**
 * The single place the BFF talks to the KAREN API (server-side only; never imported by
 * client components). The session token travels ONLY here, as `Authorization: Bearer`.
 */
import { bffError } from '../errors';
import { getServerEnv, type ServerEnv } from '../env';
import { signedClientIpHeaders } from './client-ip';
import { bffLog, errorName } from './log';

export interface UpstreamRequest {
  method: string;
  /** API path without the leading slash, e.g. `v1/me/profile`. */
  path: string;
  search?: string;
  token?: string | undefined;
  /** Raw request body (already size-checked) or a JSON value to serialise. */
  body?: string | undefined;
  json?: unknown;
  headers?: Record<string, string>;
}

export interface UpstreamDeps {
  fetch?: typeof globalThis.fetch;
  env?: ServerEnv;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Calls the API. Network failures become a 503 response with the standard envelope. */
export async function callApi(req: UpstreamRequest, deps: UpstreamDeps = {}): Promise<Response> {
  const env = deps.env ?? getServerEnv();
  const doFetch = deps.fetch ?? globalThis.fetch;
  const base = env.API_INTERNAL_BASE_URL.replace(/\/+$/, '');
  const url = `${base}/${req.path}${req.search ?? ''}`;
  const headers = new Headers(req.headers);
  headers.set('accept', 'application/json');
  headers.set('x-request-id', crypto.randomUUID());
  if (req.token) headers.set('authorization', `Bearer ${req.token}`);
  for (const [k, v] of Object.entries(
    await signedClientIpHeaders(env.INTERNAL_SERVICE_HMAC_SECRET, env.BFF_TRUSTED_PROXY_HOPS),
  )) {
    headers.set(k, v);
  }
  let body: string | undefined = req.body;
  if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    headers.set('content-type', 'application/json');
  }
  try {
    return await doFetch(url, {
      method: req.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    bffLog('error', 'bff.upstream.unreachable', { method: req.method, error: errorName(e) });
    return Response.json(
      bffError(
        'DEPENDENCY_UNAVAILABLE',
        'KAREN is temporarily unavailable. Please try again shortly.',
        { retryable: true },
      ),
      { status: 503 },
    );
  }
}

/** Reads a JSON body without throwing (empty / non-JSON → null). */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    bffLog('warn', 'bff.upstream.non_json', { status: response.status });
    return null;
  }
}
