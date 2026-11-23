import type { NextConfig } from 'next';
import { API_CSP } from './src/lib/csp';

// Page Content-Security-Policy is per-request (nonce) and set in src/proxy.ts — NOT here: two
// CSP headers on one response would intersect and break the nonce policy. JSON route handlers
// (/api/*) are excluded from the proxy and get a static deny-all policy instead.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Microphone: own origin only, for voice messages (ADR-0026); never third-party frames.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  // Ignored by browsers over plain http (local dev); enforced once served over TLS.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // Workspace packages ship compiled ESM; nothing to transpile.
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: API_CSP },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      // On-device wake-word model (ADR-0031): versioned file name, so cache it for a year.
      {
        source: '/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default config;
