/**
 * Public auth route handlers (/api/auth/*). Each: same-origin + double-submit CSRF, strict
 * body validation, then one API call. The session token and challenge handles never reach
 * browser JS: the token lands in an HttpOnly cookie, challenge handles in a short-lived
 * HttpOnly cookie (not the URL).
 */
import { z } from 'zod';
import {
  challengeHandleSchema,
  emailInputSchema,
  installationIdSchema,
  loginResponseSchema,
  otpCodeSchema,
  passwordInputSchema,
  authChallengeResponseSchema,
  LOCALES,
  type AuthChallengeResponse,
} from '@karen/api-contracts';
import { bffError } from '../errors';
import { getServerEnv, type ServerEnv } from '../env';
import {
  CHALLENGE_MAX_AGE_CAP_S,
  clearCookie,
  cookieModeFor,
  CSRF_MAX_AGE_S,
  DEVICE_MAX_AGE_S,
  parseCookieHeader,
  randomToken,
  readCookie,
  sessionMaxAge,
  setCookie,
  type CookieMode,
} from './cookies';
import { checkFetchSite, checkStateChangingRequest } from './csrf';
import { bffLog } from './log';
import { forbidden, readBoundedBody } from './proxy-handler';
import { callApi, readJson, type UpstreamDeps } from './upstream';

export type ChallengePurpose = 'verify' | 'reset';

const challengeCookieSchema = z.object({
  h: challengeHandleSchema,
  p: z.enum(['verify', 'reset']),
});

export function encodeChallenge(handle: string, purpose: ChallengePurpose): string {
  const json = JSON.stringify({ h: handle, p: purpose });
  let bin = '';
  for (const b of new TextEncoder().encode(json)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeChallenge(
  value: string | undefined,
): { h: string; p: ChallengePurpose } | null {
  if (!value) return null;
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = challengeCookieSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    // Malformed or tampered cookie: treat as absent (the user restarts the flow).
    return null;
  }
}

function challengeCookie(
  challenge: AuthChallengeResponse,
  purpose: ChallengePurpose,
  mode: CookieMode,
): string {
  const ms = Date.parse(challenge.expires_at) - Date.now();
  const maxAge = Math.min(CHALLENGE_MAX_AGE_CAP_S, Math.max(60, Math.floor(ms / 1000)));
  return setCookie('challenge', encodeChallenge(challenge.challenge_handle, purpose), mode, maxAge);
}

interface Ctx {
  env: ServerEnv;
  mode: CookieMode;
  cookies: Map<string, string>;
}

const json = (body: unknown, status: number, setCookies: string[] = []): Response => {
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return Response.json(body, { status, headers });
};

const invalidBody = (): Response =>
  json(bffError('VALIDATION_FAILED', 'Please check the form and try again.'), 400);

/** Common guard + body parsing. Returns a Response on rejection. */
async function prepare<T extends z.ZodType>(
  request: Request,
  schema: T,
  deps: UpstreamDeps,
): Promise<{ ctx: Ctx; body: z.infer<T> } | Response> {
  const env = deps.env ?? getServerEnv();
  const failure = checkFetchSite(request) ?? checkStateChangingRequest(request, env);
  if (failure) {
    bffLog('warn', 'bff.auth.csrf_rejected', { reason: failure });
    return forbidden();
  }
  const raw = await readBoundedBody(request, 8 * 1024);
  if (raw === null) return json(bffError('PAYLOAD_TOO_LARGE', 'That request is too large.'), 413);
  let parsedJson: unknown;
  try {
    parsedJson = raw ? JSON.parse(raw) : {};
  } catch {
    return invalidBody();
  }
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) return invalidBody();
  return {
    ctx: {
      env,
      mode: cookieModeFor(request.url, env),
      cookies: parseCookieHeader(request.headers.get('cookie')),
    },
    body: parsed.data,
  };
}

/** Passes an API error through unchanged (status + envelope). */
async function passThrough(upstream: Response, setCookies: string[] = []): Promise<Response> {
  const body = await readJson(upstream);
  return json(
    body ?? bffError('INTERNAL_ERROR', 'Something went wrong. Please try again.'),
    upstream.status,
    setCookies,
  );
}

const noChallenge = (): Response =>
  json(
    bffError(
      'CHALLENGE_INVALID',
      'That code has expired or was already used. Please start again.',
      {
        nextOptions: ['RESTART'],
      },
    ),
    400,
  );

/** API challenge (register / forgot / resend) → challenge cookie + handle-free 202. */
async function challengeResponse(
  upstream: Response,
  purpose: ChallengePurpose,
  ctx: Ctx,
): Promise<Response> {
  if (upstream.status !== 202) return passThrough(upstream);
  const parsed = authChallengeResponseSchema.safeParse(await readJson(upstream));
  if (!parsed.success) {
    bffLog('error', 'bff.auth.unexpected_challenge_shape', {});
    return json(bffError('INTERNAL_ERROR', 'Something went wrong. Please try again.'), 502);
  }
  return json(
    {
      status: 'code_sent',
      expires_at: parsed.data.expires_at,
      code_length: parsed.data.code_length,
    },
    202,
    [challengeCookie(parsed.data, purpose, ctx.mode)],
  );
}

// ── Handlers ─────────────────────────────────────────────────────────────────────────────

const registerBody = z
  .object({
    email: emailInputSchema,
    password: passwordInputSchema,
    locale: z.enum(LOCALES).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

export async function handleRegister(request: Request, deps: UpstreamDeps = {}): Promise<Response> {
  const prep = await prepare(request, registerBody, deps);
  if (prep instanceof Response) return prep;
  const upstream = await callApi(
    { method: 'POST', path: 'v1/auth/register', json: prep.body },
    deps,
  );
  return challengeResponse(upstream, 'verify', prep.ctx);
}

const forgotBody = z.object({ email: emailInputSchema }).strict();

export async function handleForgot(request: Request, deps: UpstreamDeps = {}): Promise<Response> {
  const prep = await prepare(request, forgotBody, deps);
  if (prep instanceof Response) return prep;
  const upstream = await callApi(
    { method: 'POST', path: 'v1/auth/password/forgot', json: prep.body },
    deps,
  );
  return challengeResponse(upstream, 'reset', prep.ctx);
}

const empty = z.object({}).strict();

export async function handleResend(request: Request, deps: UpstreamDeps = {}): Promise<Response> {
  const prep = await prepare(request, empty, deps);
  if (prep instanceof Response) return prep;
  const challenge = decodeChallenge(readCookie(prep.ctx.cookies, 'challenge', prep.ctx.env));
  if (!challenge) return noChallenge();
  const upstream = await callApi(
    { method: 'POST', path: 'v1/auth/challenges/resend', json: { challenge_handle: challenge.h } },
    deps,
  );
  return challengeResponse(upstream, challenge.p, prep.ctx);
}

const verifyBody = z.object({ code: otpCodeSchema }).strict();

export async function handleVerifyEmail(
  request: Request,
  deps: UpstreamDeps = {},
): Promise<Response> {
  const prep = await prepare(request, verifyBody, deps);
  if (prep instanceof Response) return prep;
  const challenge = decodeChallenge(readCookie(prep.ctx.cookies, 'challenge', prep.ctx.env));
  if (challenge?.p !== 'verify') return noChallenge();
  const upstream = await callApi(
    {
      method: 'POST',
      path: 'v1/auth/verify-email',
      json: { challenge_handle: challenge.h, code: prep.body.code },
    },
    deps,
  );
  return passThrough(upstream, upstream.ok ? [clearCookie('challenge', prep.ctx.mode)] : []);
}

const resetBody = z.object({ code: otpCodeSchema, new_password: passwordInputSchema }).strict();

export async function handleResetPassword(
  request: Request,
  deps: UpstreamDeps = {},
): Promise<Response> {
  const prep = await prepare(request, resetBody, deps);
  if (prep instanceof Response) return prep;
  const challenge = decodeChallenge(readCookie(prep.ctx.cookies, 'challenge', prep.ctx.env));
  if (challenge?.p !== 'reset') return noChallenge();
  const upstream = await callApi(
    {
      method: 'POST',
      path: 'v1/auth/password/reset',
      json: {
        challenge_handle: challenge.h,
        code: prep.body.code,
        new_password: prep.body.new_password,
      },
    },
    deps,
  );
  return passThrough(upstream, upstream.ok ? [clearCookie('challenge', prep.ctx.mode)] : []);
}

const loginBody = z.object({ email: emailInputSchema, password: passwordInputSchema }).strict();

export async function handleLogin(request: Request, deps: UpstreamDeps = {}): Promise<Response> {
  const prep = await prepare(request, loginBody, deps);
  if (prep instanceof Response) return prep;
  const { ctx } = prep;
  const existingDevice = readCookie(ctx.cookies, 'device', ctx.env);
  const installationId = installationIdSchema.safeParse(existingDevice).success
    ? (existingDevice as string)
    : crypto.randomUUID();
  const upstream = await callApi(
    {
      method: 'POST',
      path: 'v1/auth/login',
      json: {
        email: prep.body.email,
        password: prep.body.password,
        client: 'web',
        device: { installation_id: installationId, name: 'Web browser' },
      },
    },
    deps,
  );
  const deviceCookie = setCookie('device', installationId, ctx.mode, DEVICE_MAX_AGE_S);
  if (!upstream.ok) return passThrough(upstream, [deviceCookie]);

  const parsed = loginResponseSchema.safeParse(await readJson(upstream));
  if (!parsed.success) {
    bffLog('error', 'bff.auth.unexpected_login_shape', {});
    return json(bffError('INTERNAL_ERROR', 'Something went wrong. Please try again.'), 502);
  }
  const result = parsed.data;
  if (result.result === 'verification_required') {
    return json({ result: 'verification_required' }, 200, [
      deviceCookie,
      challengeCookie(result.challenge, 'verify', ctx.mode),
    ]);
  }
  if (!result.session_token) {
    bffLog('error', 'bff.auth.missing_session_token', {});
    return json(bffError('INTERNAL_ERROR', 'Something went wrong. Please try again.'), 502);
  }
  // New session ⇒ new CSRF token (session-fixation hygiene, ADR-0016).
  return json(
    {
      result: 'signed_in',
      account_status: result.account_status,
      next: result.account_status === 'DELETION_REQUESTED' ? '/app/deletion-scheduled' : null,
    },
    200,
    [
      deviceCookie,
      setCookie(
        'session',
        result.session_token,
        ctx.mode,
        sessionMaxAge(result.session_expires_at),
      ),
      setCookie('csrf', randomToken(), ctx.mode, CSRF_MAX_AGE_S),
      clearCookie('challenge', ctx.mode),
    ],
  );
}
