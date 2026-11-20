import type { NextConfig } from 'next';

// Content-Security-Policy. Next.js App Router emits inline bootstrap scripts, so script-src
// needs 'unsafe-inline' until nonce-based CSP (middleware) lands with authenticated pages;
// everything else is locked to self. 'unsafe-eval' only for the dev server (React refresh).
const isDev = process.env.NODE_ENV !== 'production';
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? '').origin;
  } catch {
    return ''; // no API origin configured at build time: connect-src stays 'self'
  }
})();
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}${isDev ? ' ws:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

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
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
