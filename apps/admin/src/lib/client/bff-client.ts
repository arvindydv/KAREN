import { CSRF_COOKIE_NAMES, CSRF_HEADER } from '../security/cookies';
import type { ApiErrorBody, BffResult } from '../step-up';

/**
 * Browser → BFF calls (same origin only). Echoes the double-submit CSRF cookie in
 * `x-csrf-token`. The staff session cookie is HttpOnly and sent automatically by the browser;
 * this code never sees it.
 */
export function readCsrfToken(cookieString: string): string | null {
  for (const part of cookieString.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if ((CSRF_COOKIE_NAMES as readonly string[]).includes(name)) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

export async function bffFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<BffResult<T>> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  const token = readCsrfToken(document.cookie);
  if (token) headers.set(CSRF_HEADER, token);
  const init: RequestInit = {
    method: options.method ?? 'POST',
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  };
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'NETWORK', message: 'Network error. Check your connection and try again.' },
    };
  }
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null; // non-JSON body (e.g. proxy error page): fall through to a generic error
    }
  }
  if (response.ok) return { ok: true, status: response.status, data: json as T };
  const error =
    json && typeof json === 'object' && 'error' in json
      ? ((json as { error: ApiErrorBody }).error ?? null)
      : null;
  return { ok: false, status: response.status, error };
}

/** Safe, user-presentable text for a failed call. */
export function describeError(result: BffResult<unknown>): string {
  if (result.ok) return '';
  if (result.status === 401) return 'Your session has ended. Sign in again.';
  return result.error?.message ?? `Request failed (status ${result.status}).`;
}
