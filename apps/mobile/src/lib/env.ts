import { z } from 'zod';

/**
 * Public app configuration. EXPO_PUBLIC_* values are inlined into the JS bundle and are
 * readable by anyone with the app — never put secrets here. Must be referenced literally.
 */
export const mobileEnvSchema = z.object({
  EXPO_PUBLIC_APP_ENV: z.enum(['local', 'test', 'dev', 'staging', 'production']).default('local'),
  EXPO_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:4100'),
});

export type MobileEnv = z.infer<typeof mobileEnvSchema>;

export function parseMobileEnv(source: Record<string, string | undefined>): MobileEnv {
  const env = mobileEnvSchema.parse(source);
  if (
    env.EXPO_PUBLIC_APP_ENV === 'production' &&
    !env.EXPO_PUBLIC_API_BASE_URL.startsWith('https://')
  ) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use https in production builds');
  }
  return env;
}

/**
 * `process.env` is typed by the generated (gitignored) expo-env.d.ts locally but is `any` on a
 * clean CI checkout; narrowing through `unknown` is correct in both. Keep the literal
 * `process.env.EXPO_PUBLIC_*` references: Expo inlines only those.
 */
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const mobileEnv = parseMobileEnv({
  EXPO_PUBLIC_APP_ENV: asString(process.env.EXPO_PUBLIC_APP_ENV),
  EXPO_PUBLIC_API_BASE_URL: asString(process.env.EXPO_PUBLIC_API_BASE_URL),
});
