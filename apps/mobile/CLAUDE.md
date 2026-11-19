# apps/mobile — rules

- Expo SDK 58 / RN 0.88 / Expo Router. Use `pnpm --filter @karen/mobile exec expo install <pkg>` so versions match the SDK (respecting the 7-day release-age policy).
- Tokens live only in `expo-secure-store` via `SecureCredentialStore`; Zustand holds non-sensitive UI/session state only.
- Only `EXPO_PUBLIC_*` values reach the bundle — they are public. No secrets.
- Use theme tokens from `useTheme()` (built from `@karen/ui`); minimum touch target 44; accessibility roles/labels on interactive elements; loading/error primitives from `src/components/primitives.tsx`.
- Checks: `pnpm --filter @karen/mobile {test,typecheck,lint,config:check,export:check}`. Native builds (`expo run:*` / EAS) are NOT verified in CI yet.
