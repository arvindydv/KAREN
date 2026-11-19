import { z } from 'zod';

/**
 * Public (browser-visible) configuration. EVERYTHING here ships to the client — never put
 * secrets in NEXT_PUBLIC_* (enforced by `pnpm check:env-public`). Values must be referenced
 * literally so Next.js can inline them at build time.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(['local', 'test', 'dev', 'staging', 'production']).default('local'),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:4100'),
});

export const publicEnv = schema.parse({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
