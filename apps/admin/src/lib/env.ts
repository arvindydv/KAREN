import 'server-only';
import { z } from 'zod';

/**
 * SERVER-ONLY configuration for the admin BFF. Nothing here is exposed to the browser: the
 * browser talks only to this app; the app talks to the API over `API_INTERNAL_BASE_URL`.
 * There is intentionally no NEXT_PUBLIC_* API URL any more.
 *
 * - `APP_ENV` defaults to `production` for production builds and `local` otherwise (fail closed).
 * - `ADMIN_APP_ORIGIN` is the exact origin staff use (e.g. https://admin.example.com). Required
 *   outside local/test: without it every BFF mutation is refused (Origin check fails closed).
 */
const schema = z.object({
  APP_ENV: z.enum(['local', 'test', 'dev', 'staging', 'production']),
  API_INTERNAL_BASE_URL: z.url().default('http://localhost:4100'),
  ADMIN_APP_ORIGIN: z
    .url()
    .transform((value) => new URL(value).origin)
    .optional(),
  NODE_ENV: z.string().optional(),
  /** Signs the end-user IP forwarded to the API (per-IP limits). Required when deployed. */
  INTERNAL_SERVICE_HMAC_SECRET: z.string().min(32).optional(),
  /** Proxies in front of this app that append X-Forwarded-For (ALB = 1; Cloudflare+ALB = 2). */
  BFF_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});
export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= schema.parse({
    APP_ENV:
      process.env.APP_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'local'),
    API_INTERNAL_BASE_URL: process.env.API_INTERNAL_BASE_URL || undefined,
    ADMIN_APP_ORIGIN: process.env.ADMIN_APP_ORIGIN || undefined,
    NODE_ENV: process.env.NODE_ENV,
    INTERNAL_SERVICE_HMAC_SECRET: process.env.INTERNAL_SERVICE_HMAC_SECRET || undefined,
    BFF_TRUSTED_PROXY_HOPS: process.env.BFF_TRUSTED_PROXY_HOPS || undefined,
  });
  if (
    cached.APP_ENV !== 'local' &&
    cached.APP_ENV !== 'test' &&
    !cached.INTERNAL_SERVICE_HMAC_SECRET
  ) {
    throw new Error('INTERNAL_SERVICE_HMAC_SECRET is required outside local/test');
  }
  return cached;
}
