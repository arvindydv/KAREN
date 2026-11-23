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

export const mobileEnv = parseMobileEnv({
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV as string | undefined,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined,
});
