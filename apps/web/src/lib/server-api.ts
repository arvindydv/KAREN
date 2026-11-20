import 'server-only';
import { cookies } from 'next/headers';
import { parseApiError, type ApiErrorBody } from './errors';
import { getServerEnv } from './env';
import { readableCookieNames } from './bff/cookies';
import { callApi, readJson } from './bff/upstream';
import { decodeChallenge, type ChallengePurpose } from './bff/auth-handlers';

/** Reads the session token from the HttpOnly cookie (server components / route handlers). */
export async function readSessionToken(): Promise<string | undefined> {
  const env = getServerEnv();
  const jar = await cookies();
  for (const name of readableCookieNames('session', env)) {
    const v = jar.get(name)?.value;
    if (v) return v;
  }
  return undefined;
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody | null };

/**
 * Server-side GET to the API with the caller's session. Types come from @karen/api-contracts;
 * the API validates its own responses against the same schemas.
 */
export async function serverGet<T>(path: string, token?: string): Promise<ApiResult<T>> {
  const bearer = token ?? (await readSessionToken());
  const res = await callApi({ method: 'GET', path: path.replace(/^\//, ''), token: bearer });
  const body = await readJson(res);
  if (res.ok) return { ok: true, status: res.status, data: body as T };
  return { ok: false, status: res.status, error: parseApiError(body) };
}

/** Which code flow (if any) the visitor has open, from the HttpOnly challenge cookie. */
export async function readChallengePurpose(): Promise<ChallengePurpose | null> {
  const env = getServerEnv();
  const jar = await cookies();
  for (const name of readableCookieNames('challenge', env)) {
    const decoded = decodeChallenge(jar.get(name)?.value);
    if (decoded) return decoded.p;
  }
  return null;
}
