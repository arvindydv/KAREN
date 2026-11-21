/**
 * Browser-side client for the BFF. The browser NEVER calls the KAREN API directly and never
 * holds a token: requests go to same-origin route handlers (/api/auth/*, /api/v1/*) which add
 * the session from an HttpOnly cookie. State-changing calls carry the double-submit CSRF token.
 */
import { parseApiError, type ApiErrorBody } from './errors';

const CSRF_COOKIE_NAMES = ['__Host-karen_csrf', 'karen_csrf'];

export function readCsrfToken(
  cookieString: string = typeof document === 'undefined' ? '' : document.cookie,
): string | undefined {
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (CSRF_COOKIE_NAMES.includes(name)) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export type BffResult<T> =
  | { ok: true; status: number; data: T; etag: string | null }
  | { ok: false; status: number; error: ApiErrorBody };

export interface BffOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: unknown;
  /** Resource version for optimistic concurrency → `If-Match: "<version>"`. */
  version?: number;
  idempotencyKey?: string;
}

const networkError: ApiErrorBody = {
  code: 'DEPENDENCY_UNAVAILABLE',
  message: 'We couldn’t reach KAREN. Check your connection and try again.',
  correlation_id: 'client',
  retryable: true,
};

/** Calls a BFF path, e.g. `/api/v1/me/profile` or `/api/auth/login`. */
export async function bff<T>(path: string, options: BffOptions = {}): Promise<BffResult<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    const csrf = readCsrfToken();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  if (options.version !== undefined) headers['if-match'] = `"${options.version}"`;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
    });
  } catch {
    return { ok: false, status: 0, error: networkError };
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  if (res.ok)
    return { ok: true, status: res.status, data: body as T, etag: res.headers.get('etag') };
  return {
    ok: false,
    status: res.status,
    error: parseApiError(body) ?? {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      correlation_id: 'client',
      retryable: res.status >= 500,
    },
  };
}

/**
 * Navigation side effects of session-level errors, shared by every client mutation:
 * 401 → sign in again; deletion pending → the restricted page. Returns true if handled.
 */
export function handleSessionError(error: ApiErrorBody, status: number): boolean {
  if (status === 401) {
    hardNavigate(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
    return true;
  }
  if (error.code === 'ACCOUNT_INACTIVE' && error.next_options?.includes('CANCEL_DELETION')) {
    hardNavigate('/app/deletion-scheduled');
    return true;
  }
  return false;
}

export const newIdempotencyKey = (): string => crypto.randomUUID();

/**
 * Full-page navigation. Used deliberately after auth changes (sign-in/out, deletion): the
 * session lives in an HttpOnly cookie, so every server component and the client router cache
 * must be rebuilt from a fresh request rather than a client-side transition.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
