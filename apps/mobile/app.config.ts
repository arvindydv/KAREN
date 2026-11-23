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
    // Optional local app lock only (never server authentication).
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'KAREN uses Face ID to unlock the app on this device when you turn on app lock.',
      },
    ],
    // Talking to KAREN (ADR-0030): record questions and play KAREN's spoken answers.
    [
      'expo-audio',
      {
        microphonePermission:
          'KAREN uses the microphone when you talk to her. Recordings are sent only after you call KAREN, to turn your words into text, and are never stored.',
        recordAudioAndroid: true,
      },
    ],
    // "Hey KAREN": the phone's on-device speech recogniser listens for the wake phrase while the
    // app is open and the switch is on. Nothing leaves the phone until you say it.
    [
      'expo-speech-recognition',
      {
        microphonePermission:
          'KAREN uses the microphone when you talk to her. Recordings are sent only after you call KAREN, to turn your words into text, and are never stored.',
        speechRecognitionPermission:
          'KAREN listens for “Hey KAREN” on this phone (on-device) while the app is open and you have turned hands-free on.',
        androidSpeechServicePackages: [
          'com.google.android.as',
          'com.google.android.googlequicksearchbox',
        ],
      },
    ],
    ['expo-splash-screen', { backgroundColor: '#0A0F24', dark: { backgroundColor: '#0A0F24' } }],
  ],
  experiments: { typedRoutes: true },
  extra: { variant },
};

export default config;
