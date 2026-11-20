/**
 * Enrollment links carry the one-time token ONLY in the URL fragment (`/enroll#<token>`).
 * Fragments are never sent to servers, proxies or access logs, and `Referrer-Policy: no-referrer`
 * keeps them out of Referer headers. The page reads the fragment client-side, strips it from the
 * address bar/history, and sends the token in a POST JSON body — never in a path or query string.
 */
export const ENROLL_PATH = '/enroll';
export const ENROLL_OPTIONS_ENDPOINT = '/api/session/enroll/options';
export const ENROLL_VERIFY_ENDPOINT = '/api/session/enroll/verify';

const TOKEN = /^[A-Za-z0-9._~-]{1,128}$/;

export function buildEnrollmentLink(origin: string, token: string): string {
  const url = new URL(ENROLL_PATH, origin);
  url.hash = encodeURIComponent(token);
  return url.toString();
}

/** `location.hash` → token, or null when absent/malformed. */
export function readEnrollmentTokenFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  let token: string;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-encoding: treat as no token
  }
  return TOKEN.test(token) ? token : null;
}

/** The request the enrollment page sends: the token travels in the body only. */
export const enrollmentOptionsRequest = (token: string) => ({
  url: ENROLL_OPTIONS_ENDPOINT,
  init: { method: 'POST' as const, body: { enrollment_token: token } },
});

/** Client-side hint mirroring the API policy: 15–256 code points (server is authoritative). */
export function passwordProblem(password: string): string | null {
  const length = [...password.normalize('NFKC')].length;
  if (length < 15) return 'Use at least 15 characters.';
  if (length > 256) return 'Use at most 256 characters.';
  return null;
}
