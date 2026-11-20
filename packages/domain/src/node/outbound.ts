/**
 * SSRF-safe outbound HTTP (roadmap F00-03; docs/security/egress-policy.md).
 *
 * Every server-side fetch of a URL that did not come from KAREN's own configuration — links
 * in e-mails, web pages, provider callbacks, model tool calls — MUST go through `safeFetch`.
 * Defence layers:
 *   1. URL policy: https only, no embedded credentials, default port, host on an explicit
 *      per-caller allowlist (exact host or `*.suffix`).
 *   2. Address policy enforced at CONNECT time (custom DNS `lookup`), so DNS rebinding
 *      cannot swap a public answer for a private one between check and connect.
 *   3. Redirects are never followed implicitly; each hop is re-validated, with a hop limit.
 *   4. Hard timeout and response-size cap.
 * Infrastructure egress filtering (Network Firewall / proxy) remains required on top.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export class OutboundRequestBlockedError extends Error {
  constructor(
    readonly reason:
      | 'INVALID_URL'
      | 'SCHEME_NOT_ALLOWED'
      | 'CREDENTIALS_IN_URL'
      | 'PORT_NOT_ALLOWED'
      | 'HOST_NOT_ALLOWED'
      | 'ADDRESS_NOT_PUBLIC'
      | 'TOO_MANY_REDIRECTS'
      | 'RESPONSE_TOO_LARGE'
      | 'TIMEOUT',
    detail?: string,
  ) {
    super(`Outbound request blocked: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'OutboundRequestBlockedError';
  }
}

// Separate lists: node's BlockList matches IPv4 input against IPv4-mapped IPv6 rules, so a
// single list containing ::ffff:0:0/96 would block every IPv4 address.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
// IPv4: "this" network, private, CGNAT, loopback, link-local (incl. cloud metadata
// 169.254.169.254), IETF protocol assignments, documentation, benchmarking, multicast, reserved.
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked4.addSubnet(net, prefix, 'ipv4');
}
// IPv6: unspecified, loopback, IPv4-mapped/translated, discard, documentation, ULA,
// link-local, site-local (deprecated), multicast, 6to4/Teredo (can tunnel to private v4).
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked6.addSubnet(net, prefix, 'ipv6');
}

/** True only for globally routable unicast addresses. Unparseable input is not public. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 4) return !blocked4.check(address, 'ipv4');
  return !blocked6.check(address, 'ipv6');
}

export interface OutboundPolicy {
  /** Exact hostnames or `*.example.com` suffix patterns. Empty = nothing allowed. */
  readonly allowedHosts: readonly string[];
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

const hostAllowed = (host: string, allowed: readonly string[]): boolean =>
  allowed.some((pattern) => {
    const p = pattern.toLowerCase();
    return p.startsWith('*.') ? host.endsWith(p.slice(1)) && host !== p.slice(2) : host === p;
  });

/** Validates a URL against the policy without network access. Returns the parsed URL. */
export function assertOutboundUrlAllowed(raw: string | URL, policy: OutboundPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundRequestBlockedError('INVALID_URL');
  }
  if (url.protocol !== 'https:') throw new OutboundRequestBlockedError('SCHEME_NOT_ALLOWED');
  if (url.username || url.password) throw new OutboundRequestBlockedError('CREDENTIALS_IN_URL');
  if (url.port !== '' && url.port !== '443') {
    throw new OutboundRequestBlockedError('PORT_NOT_ALLOWED');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Literal IPs are never allowlisted by name; private literals are rejected outright.
  const literal = host.replace(/^\[|\]$/g, '');
  if (isIP(literal) !== 0 && !isPublicAddress(literal)) {
    throw new OutboundRequestBlockedError('ADDRESS_NOT_PUBLIC', 'literal address');
  }
  if (!hostAllowed(host, policy.allowedHosts)) {
    throw new OutboundRequestBlockedError('HOST_NOT_ALLOWED', host);
  }
  return url;
}

/** DNS lookup that refuses to hand a non-public address to the socket (anti-rebinding). */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0);
      return;
    }
    const list: LookupAddress[] = addresses;
    const first = list[0];
    if (!first || list.some((a) => !isPublicAddress(a.address))) {
      callback(new OutboundRequestBlockedError('ADDRESS_NOT_PUBLIC', hostname), '', 0);
      return;
    }
    if (options.all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    } else {
      callback(null, first.address, first.family);
    }
  });
};

export interface SafeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Buffer;
  readonly url: string;
}

/** Resolves the next hop of a redirect, re-applying the full URL policy. */
export function nextRedirectUrl(current: URL, location: string, policy: OutboundPolicy): URL {
  return assertOutboundUrlAllowed(new URL(location, current), policy);
}

/** GET a URL under the outbound policy. Only GET: side effects never go through here. */
export async function safeFetch(
  raw: string | URL,
  policy: OutboundPolicy,
  headers: Record<string, string> = {},
): Promise<SafeResponse> {
  const maxRedirects = policy.maxRedirects ?? 3;
  let url = assertOutboundUrlAllowed(raw, policy);
  for (let hop = 0; ; hop += 1) {
    const res = await getOnce(url, policy, headers);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && typeof location === 'string') {
      if (hop >= maxRedirects) throw new OutboundRequestBlockedError('TOO_MANY_REDIRECTS');
      url = nextRedirectUrl(url, location, policy);
      continue;
    }
    return res;
  }
}

function getOnce(
  url: URL,
  policy: OutboundPolicy,
  headers: Record<string, string>,
): Promise<SafeResponse> {
  const timeoutMs = policy.timeoutMs ?? 5_000;
  const maxBytes = policy.maxResponseBytes ?? 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: 'GET', headers, lookup: publicOnlyLookup, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new OutboundRequestBlockedError('RESPONSE_TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            url: url.toString(),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new OutboundRequestBlockedError('TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}
