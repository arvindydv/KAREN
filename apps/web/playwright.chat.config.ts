import { defineConfig, devices } from '@playwright/test';

/**
 * Chat E2E against the REAL stack: KAREN API (AUTH_MODE=local-dev, memory e-mail) and the AI
 * service in mock-gateway mode. Defaults match the local QA instances; override with
 * E2E_API_URL / E2E_WEB_PORT. Run: pnpm exec playwright test -c playwright.chat.config.ts
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:4110';
const PORT = Number(process.env.E2E_WEB_PORT ?? 3110);

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'chat.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  // Generous: minting sessions may wait out the API's sensitive rate limit (10/min).
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { API_INTERNAL_BASE_URL: API, APP_ENV: 'local' },
  },
});
