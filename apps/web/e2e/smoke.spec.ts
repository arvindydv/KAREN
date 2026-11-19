import { expect, test } from '@playwright/test';

test('home page renders with security headers', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Taken care of');
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
