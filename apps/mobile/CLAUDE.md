# apps/mobile — rules

- Expo SDK 58 / RN 0.88 / Expo Router. Use `pnpm --filter @karen/mobile exec expo install <pkg>` so versions match the SDK (respecting the 7-day release-age policy).
- Tokens live only in `expo-secure-store` via `SecureCredentialStore`; Zustand holds non-sensitive UI/session state only.
- Only `EXPO_PUBLIC_*` values reach the bundle — they are public. No secrets.
- Use theme tokens from `useTheme()` (built from `@karen/ui`); minimum touch target 44; accessibility roles/labels on interactive elements; loading/error primitives from `src/components/primitives.tsx`.
- Checks: `pnpm --filter @karen/mobile {test,typecheck,lint,config:check,export:check}`. Native builds (`expo run:*` / EAS) are NOT verified in CI yet.

## Voice (ADR-0030)

- `src/features/voice/assistant.ts` is the conversation state machine (pure; test it with fakes).
  `live-conversation.ts` is the live-session protocol (pcm16 mic stream → turn events);
  `native.ts` only adapts expo-speech-recognition / expo-audio / expo-file-system (ADR-0031).
- Native voice modules load only through `native-modules.ts` (an app binary without them must
  still start); never import expo-audio / expo-speech-recognition / expo-file-system directly.
- The wake-word recogniser must keep `requiresOnDeviceRecognition: true` (ambient speech never
  leaves the phone). Listening only in the foreground and only while the user's switch is on.
- Never keep recordings or reply audio: delete the temp files after use. Never put spoken text in
  URLs or logs (hand-offs go through the in-memory `voice-store`).
- Echo (ADR-0033): mic PCM goes through `DuplexGate` (silence while KAREN speaks, level barge-in →
  `VoiceAssistant.bargeIn()`). Never forward raw mic audio while she is speaking.
- Jest maps the native voice modules to stubs in `src/test/` (see `jest.config.js`).
- Needs a development build (`expo run:android|ios` or EAS `development` profile); NOT VERIFIED on devices.
