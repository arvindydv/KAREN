import type { ExpoConfig } from 'expo/config';

/**
 * APP_VARIANT selects the build flavour: development (dev client), preview (internal QA) or
 * production (store). Each variant gets its own bundle id so they can be installed together.
 * Only EXPO_PUBLIC_* values reach the app bundle — never put secrets there.
 */
const variant = (process.env.APP_VARIANT ?? 'development') as
  'development' | 'preview' | 'production';
const suffix = variant === 'production' ? '' : `.${variant}`;

const config: ExpoConfig = {
  name: variant === 'production' ? 'KAREN' : `KAREN (${variant})`,
  slug: 'karen',
  scheme: 'karen',
  version: '0.1.0',
  orientation: 'portrait',
  // KAREN's signature look is the dark "deep space" theme (see src/theme/theme.ts).
  userInterfaceStyle: 'dark',
  ios: { bundleIdentifier: `ai.karen.app${suffix}`, supportsTablet: false },
  android: { package: `ai.karen.app${suffix}`, allowBackup: false },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-splash-screen', { backgroundColor: '#060A1C', dark: { backgroundColor: '#060A1C' } }],
  ],
  experiments: { typedRoutes: true },
  extra: { variant },
};

export default config;
