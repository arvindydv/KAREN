import Constants from 'expo-constants';
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

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Local development on a physical phone: the API runs on the same machine as Metro, so point the
 * API URL at the host the phone already reached Metro on (`hostUri`, e.g. `192.168.1.19:8081`).
 * This keeps working when the laptop's Wi-Fi IP changes, without editing `.env`. Only for
 * APP_ENV=local and only when Metro is reached by IPv4 (a tunnel host cannot reach the API).
 */
export function resolveDevApiBaseUrl(
  env: MobileEnv,
  hostUri: string | null | undefined,
): MobileEnv {
  if (env.EXPO_PUBLIC_APP_ENV !== 'local' || !hostUri) return env;
  const host = hostUri.split(':')[0] ?? '';
  if (!IPV4.test(host)) return env;
  const url = new URL(env.EXPO_PUBLIC_API_BASE_URL);
  if (url.hostname === host) return env;
  url.hostname = host;
  return { ...env, EXPO_PUBLIC_API_BASE_URL: url.toString().replace(/\/$/, '') };
}

export const mobileEnv = resolveDevApiBaseUrl(
  parseMobileEnv({
    EXPO_PUBLIC_APP_ENV: asString(process.env.EXPO_PUBLIC_APP_ENV),
    EXPO_PUBLIC_API_BASE_URL: asString(process.env.EXPO_PUBLIC_API_BASE_URL),
  }),
  Constants.expoConfig?.hostUri,
);
