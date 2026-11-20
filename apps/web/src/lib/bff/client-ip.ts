import 'server-only';
import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  clientIpFromForwardedFor,
  signClientIp,
} from '@karen/domain/node';
import { headers } from 'next/headers';

/**
 * Signed end-user IP for the API's per-IP limiters (see @karen/domain/node client-ip.ts).
 * Without it every web user would share the BFF's single rate-limit bucket. Returns no headers
 * when there is no request scope, no secret, or no trustworthy client address.
 */
export async function signedClientIpHeaders(
  secret: string | undefined,
  trustedHops: number,
): Promise<Record<string, string>> {
  if (!secret) return {};
  let forwardedFor: string | null;
  try {
    forwardedFor = (await headers()).get('x-forwarded-for');
  } catch {
    // Outside a request (build, tests): nothing to forward — the API falls back to the socket.
    return {};
  }
  const ip = clientIpFromForwardedFor(forwardedFor, trustedHops);
  if (!ip) return {};
  return {
    [CLIENT_IP_HEADER]: ip,
    [CLIENT_IP_SIGNATURE_HEADER]: signClientIp(secret, ip, Math.floor(Date.now() / 1000)),
  };
}
