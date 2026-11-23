/**
 * Explicit allowlist of API routes the browser may reach through the BFF proxy
 * (/api/v1/[...path]). Deny by default: anything not listed — including an allowed path with
 * a method that is not listed — is a 404. Patterns are matched against the joined, validated
 * path (without the `v1/` prefix).
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const SLUG = '[a-z_]{1,64}';
const PURPOSE = '[A-Z_]{1,64}';
const VERSION = '[A-Za-z0-9._-]{1,32}';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface Rule {
  methods: readonly Method[];
  pattern: RegExp;
  /** Larger request-body cap for this route only (default MAX_BODY_BYTES). */
  maxBodyBytes?: number;
}

const rule = (methods: readonly Method[], path: string, maxBodyBytes?: number): Rule => ({
  methods,
  pattern: new RegExp(`^${path}$`),
  ...(maxBodyBytes ? { maxBodyBytes } : {}),
});

/** Live voice session IDs (`lv_` + 24–48 alphanumerics, ADR-0027). */
const LIVE_SID = 'lv_[A-Za-z0-9]{24,48}';
/** One live audio chunk: 32 kB decoded → ~44 kB base64 plus JSON framing. */
export const LIVE_CHUNK_MAX_BODY_BYTES = 48_000;

/** Voice messages: base64 audio up to the API's 700 kB cap plus JSON framing (ADR-0026). */
export const VOICE_UPLOAD_MAX_BODY_BYTES = 960_000;

export const PROXY_ALLOWLIST: readonly Rule[] = [
  // Sign-out (the proxy also clears the session cookie for these).
  rule(['POST'], 'auth/logout'),
  rule(['POST'], 'auth/logout-all'),
  // Identity & profile (M3/M4)
  rule(['GET'], 'me'),
  rule(['GET', 'PATCH'], 'me/profile'),
  rule(['GET', 'PATCH'], 'me/preferences'),
  rule(['GET'], 'me/sessions'),
  rule(['DELETE'], `me/sessions/${UUID}`),
  rule(['GET'], 'me/devices'),
  rule(['DELETE'], `me/devices/${UUID}`),
  rule(['GET', 'POST'], 'me/places'),
  rule(['PUT', 'DELETE'], `me/places/${UUID}`),
  rule(['POST'], 'me/email-change'),
  rule(['POST'], 'me/email-change/confirm'),
  rule(['POST'], 'me/password'),
  // Onboarding (M5)
  rule(['GET'], 'me/onboarding'),
  rule(['PUT'], `me/onboarding/steps/${SLUG}`),
  rule(['POST'], 'me/onboarding/(?:skip|resume|complete)'),
  // Consent & legal (M6)
  rule(['GET'], 'consent/purposes'),
  rule(['GET'], 'consent/notices'),
  rule(['GET'], `consent/notices/${SLUG}/${VERSION}`),
  rule(['GET'], 'me/consents'),
  rule(['PUT'], `me/consents/${PURPOSE}`),
  rule(['GET'], 'me/consents/history'),
  rule(['GET'], 'me/consents/receipts/verify'),
  rule(['GET'], 'me/legal'),
  rule(['POST'], 'me/legal/acceptances'),
  // Data rights (M7)
  rule(['GET'], 'me/data-rights'),
  rule(['GET'], `me/data-rights/${UUID}`),
  rule(['GET'], `me/data-rights/${UUID}/download`),
  rule(['POST'], 'me/data-rights/export'),
  rule(['POST'], 'me/data-rights/deletion'),
  rule(['POST'], `me/data-rights/${UUID}/cancel`),
  // Conversations (Phase 02). The SSE stream has its own pass-through route (stream-proxy.ts).
  rule(['GET'], 'me/ai-usage'),
  rule(['GET', 'POST'], 'conversations'),
  rule(['GET', 'PATCH', 'DELETE'], `conversations/${UUID}`),
  rule(['GET', 'POST'], `conversations/${UUID}/messages`),
  rule(['POST'], `conversations/${UUID}/fork`),
  rule(['GET'], `conversations/${UUID}/messages/${UUID}`),
  rule(['POST'], `conversations/${UUID}/messages/${UUID}/(?:cancel|regenerate)`),
  rule(['POST', 'DELETE'], `conversations/${UUID}/messages/${UUID}/feedback`),
  // Voice (ADR-0026). Spoken replies stream through their own pass-through (speech-proxy.ts).
  rule(['POST'], 'voice/transcriptions', VOICE_UPLOAD_MAX_BODY_BYTES),
  // Live voice conversations (ADR-0027). Events stream through their own SSE pass-through.
  rule(['GET'], 'voice/options'),
  rule(['POST'], 'voice/sessions'),
  rule(['POST'], `voice/sessions/${LIVE_SID}/audio`, LIVE_CHUNK_MAX_BODY_BYTES),
  rule(['POST'], `voice/sessions/${LIVE_SID}/close`),
];

/** The live-voice event stream path; served by the dedicated SSE pass-through. */
export const VOICE_EVENTS_PATH = new RegExp(`^voice/sessions/(${LIVE_SID})/events$`);

/** The spoken-reply audio path; served by the dedicated streaming pass-through. */
export const SPEECH_PATH = new RegExp(`^conversations/(${UUID})/messages/(${UUID})/speech$`);

/** The one streaming (SSE) path; served by the dedicated pass-through, never buffered. */
export const STREAM_PATH = new RegExp(`^conversations/(${UUID})/messages/(${UUID})/stream$`);

/** Each segment: conservative charset, never `.`/`..`, bounded. */
const SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Validates the catch-all segments and returns the API path (e.g. `me/profile`) when the
 * method + path is allowlisted, otherwise null.
 */
export function resolveAllowedPath(method: string, segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > 8) return null;
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === '.' || s === '..') return null;
  }
  const path = segments.join('/');
  const m = method.toUpperCase();
  const allowed = PROXY_ALLOWLIST.some(
    (r) => (r.methods as readonly string[]).includes(m) && r.pattern.test(path),
  );
  return allowed ? path : null;
}

/** Request-body cap for an allowlisted path (per-rule override, else the default). */
export function maxBodyBytesFor(method: string, path: string, fallback: number): number {
  const m = method.toUpperCase();
  const match = PROXY_ALLOWLIST.find(
    (r) => (r.methods as readonly string[]).includes(m) && r.pattern.test(path),
  );
  return match?.maxBodyBytes ?? fallback;
}

/** Paths whose successful (or failed) call ends the browser session locally. */
export const SIGN_OUT_PATHS = new Set(['auth/logout', 'auth/logout-all']);
