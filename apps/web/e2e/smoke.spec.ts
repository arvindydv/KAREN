import { expect, test } from '@playwright/test';

test('home page renders with security headers and no CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  expect(headers['strict-transport-security']).toContain('max-age=');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Taken care of');
  expect(violations).toEqual([]);
});

test('authenticated area redirects to sign-in without a session', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('unknown routes show the not-found page', async ({ page }) => {
  const response = await page.goto('/definitely-missing');
  expect(response?.status()).toBe(404);
});
