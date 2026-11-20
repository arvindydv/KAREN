import type { NextConfig } from 'next';

// Static security headers for every route. The Content-Security-Policy is NOT here: it is a
// per-request nonce policy set by `src/proxy.ts` (no 'unsafe-inline' scripts).
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Staff console: never cache, never index.
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // WebAuthn needs publickey-credentials-*=(self); everything else is off.
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)',
          },
        ],
      },
    ];
  },
};

export default config;
