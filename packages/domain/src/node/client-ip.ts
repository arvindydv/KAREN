import { isIP } from 'node:net';
import { signTimestamped, verifyTimestamped } from './signing.js';

/**
 * Trusted client-IP forwarding from the web/admin BFFs to the API (Phase 01 M9).
 *
 * Behind a BFF every browser request reaches the API from the BFF's address, so the API's
 * per-IP limiters would put every user in ONE bucket (one abuser could lock everyone out of
 * sign-in). The BFF therefore forwards the end-user IP it determined from its own trusted
 * proxies, HMAC-signed with INTERNAL_SERVICE_HMAC_SECRET and a timestamp. The API uses it ONLY
 * when the signature verifies within a short window; anything else falls back to the socket
 * address, so a forged header from the internet changes nothing.
 */
export const CLIENT_IP_HEADER = 'x-karen-client-ip';
export const CLIENT_IP_SIGNATURE_HEADER = 'x-karen-client-ip-signature';
const PURPOSE = 'karen.client-ip.v1';
export const CLIENT_IP_TOLERANCE_SECONDS = 60;

export function signClientIp(secret: string, ip: string, nowUnixSeconds: number): string {
  return signTimestamped(secret, `${PURPOSE}:${ip}`, nowUnixSeconds);
}

export function verifyClientIp(opts: {
  secret: string;
  ip: string | undefined;
  signature: string | undefined;
  nowUnixSeconds: number;
}): string | null {
  const ip = opts.ip?.trim();
  if (!ip || isIP(ip) === 0 || !opts.signature) return null;
  const result = verifyTimestamped({
    secret: opts.secret,
    payload: `${PURPOSE}:${ip}`,
    header: opts.signature,
    nowUnixSeconds: opts.nowUnixSeconds,
    toleranceSeconds: CLIENT_IP_TOLERANCE_SECONDS,
  });
  return result.ok ? ip : null;
}

/**
 * The client address from `X-Forwarded-For` given how many proxies in front of this service are
 * trusted (each appends one entry; the entry they appended last-but-`hops` is the client).
 * Returns undefined when the header is missing, too short, or not an IP.
 */
export function clientIpFromForwardedFor(
  forwardedFor: string | null | undefined,
  trustedHops: number,
): string | undefined {
  if (!forwardedFor || trustedHops < 1) return undefined;
  const parts = forwardedFor
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const candidate = parts[parts.length - trustedHops];
  return candidate && isIP(candidate) !== 0 ? candidate : undefined;
}
