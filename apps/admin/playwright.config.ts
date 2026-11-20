import { defineConfig, devices } from '@playwright/test';

/**
 * Admin console e2e. Smoke tests (e2e/smoke.spec.ts) need NO API. The WebAuthn flow
 * (e2e/webauthn-flow.spec.ts) is opt-in with KAREN_E2E_API=1 and a real local API — see README.
 */
const PORT = 3101;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Smoke tests run against the production build (secure `__Host-` cookies, no 'unsafe-eval').
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      APP_ENV: 'test',
      ADMIN_APP_ORIGIN: `http://localhost:${PORT}`,
      API_INTERNAL_BASE_URL: process.env.API_INTERNAL_BASE_URL ?? 'http://localhost:4100',
    },
  },
});
