import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // The chat E2E needs a live API + AI service: run it with playwright.chat.config.ts.
  testIgnore: ['chat.spec.ts'],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Smoke tests run against the production build.
    command: 'pnpm build && pnpm exec next start --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
