import { z } from 'zod';

/**
 * Public (browser-visible) configuration. EVERYTHING here ships to the client — never put
 * secrets in NEXT_PUBLIC_* (enforced by `pnpm check:env-public`). Values must be referenced
 * literally so Next.js can inline them at build time.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(['local', 'test', 'dev', 'staging', 'production']).default('local'),
});

export const publicEnv = schema.parse({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
});

/**
 * Server-only configuration for the BFF (route handlers, server components, proxy.ts).
 * NOT prefixed NEXT_PUBLIC_, so Next.js never inlines these into browser bundles. Read lazily
 * (per call) so a value is never captured at build time and tests can vary it.
 *
 * - `API_INTERNAL_BASE_URL`: where the BFF reaches the KAREN API (service discovery; the
 *   browser never talks to the API directly — CSP connect-src is 'self').
 * - `APP_ENV`: deployment environment. Only `local`/`test` permit the non-`__Host-` cookie
 *   names used over plain-http localhost/LAN dev (see lib/bff/cookies.ts).
 * - `WEB_PUBLIC_ORIGIN`: the exact browser-facing origin (e.g. https://app.example.com) used for
 *   the Origin check on state-changing requests. REQUIRED outside local/test; locally the
 *   request's own origin is used.
 */
const serverSchema = z.object({
  API_INTERNAL_BASE_URL: z.url().default('http://localhost:4100'),
  APP_ENV: z.enum(['local', 'test', 'dev', 'staging', 'production']).default('local'),
  WEB_PUBLIC_ORIGIN: z.url().optional(),
  KAREN_DEPLOYED_ARTIFACT: z.enum(['true', 'false']).optional(),
  /** Signs the end-user IP forwarded to the API (per-IP limits). Required when deployed. */
  INTERNAL_SERVICE_HMAC_SECRET: z.string().min(32).optional(),
  /** Proxies in front of this app that append X-Forwarded-For (ALB = 1; Cloudflare+ALB = 2). */
  BFF_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});
export type ServerEnv = z.infer<typeof serverSchema>;

export function getServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const env = serverSchema.parse({
    API_INTERNAL_BASE_URL: source.API_INTERNAL_BASE_URL || undefined,
    APP_ENV: source.APP_ENV || undefined,
    WEB_PUBLIC_ORIGIN: source.WEB_PUBLIC_ORIGIN || undefined,
    KAREN_DEPLOYED_ARTIFACT: source.KAREN_DEPLOYED_ARTIFACT || undefined,
    INTERNAL_SERVICE_HMAC_SECRET: source.INTERNAL_SERVICE_HMAC_SECRET || undefined,
    BFF_TRUSTED_PROXY_HOPS: source.BFF_TRUSTED_PROXY_HOPS || undefined,
  });
  // Deployed: without the signing secret every user shares one rate-limit bucket at the API.
  if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test' && !env.INTERNAL_SERVICE_HMAC_SECRET) {
    throw new Error('INTERNAL_SERVICE_HMAC_SECRET is required outside local/test');
  }
  // A deployed image must say where it runs: never silently fall back to `local` (ADR-0013).
  if (env.KAREN_DEPLOYED_ARTIFACT === 'true' && !source.APP_ENV) {
    throw new Error('APP_ENV must be set explicitly in deployed artifacts');
  }
  return env;
}

export const isLocalEnv = (env: ServerEnv): boolean =>
  env.APP_ENV === 'local' || env.APP_ENV === 'test';
