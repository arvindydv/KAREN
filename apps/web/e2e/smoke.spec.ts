import { expect, test, type Page } from '@playwright/test';

/** Collects CSP violations reported to the console while a page loads. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  return violations;
}

function scriptSrc(csp: string | undefined): string {
  return (
    (csp ?? '')
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src ')) ?? ''
  );
}

test('home page renders with security headers and no CSP violations', async ({ page }) => {
  const violations = watchCsp(page);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  expect(headers['content-security-policy']).toContain("connect-src 'self'");
  expect(headers['strict-transport-security']).toContain('max-age=');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Taken care of');
  expect(violations).toEqual([]);
});

test('script-src uses a fresh per-request nonce and never unsafe-inline', async ({ page }) => {
  const first = await page.goto('/');
  const a = scriptSrc(first?.headers()['content-security-policy']);
  expect(a).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(a).toContain("'strict-dynamic'");
  expect(a).not.toContain("'unsafe-inline'");
  expect(a).not.toContain("'unsafe-eval'");
  const second = await page.goto('/');
  expect(scriptSrc(second?.headers()['content-security-policy'])).not.toBe(a);
  // The theme script carries the nonce, so it ran: <html> has a theme class.
  await expect(page.locator('html')).toHaveClass(/(dark|light)/);
});

for (const [path, heading] of [
  ['/sign-in', 'Sign in'],
  ['/sign-up', 'Create your account'],
  ['/forgot-password', 'Forgot your password?'],
] as const) {
  test(`${path} renders an accessible form with no CSP violations`, async ({ page }) => {
    const violations = watchCsp(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByLabel('E-mail')).toBeVisible();
    // The double-submit CSRF cookie is issued (readable, SameSite=Strict).
    const csrf = (await page.context().cookies()).find((c) => c.name.endsWith('karen_csrf'));
    expect(csrf?.sameSite).toBe('Strict');
    expect(csrf?.httpOnly).toBe(false);
    // Forms never fall back to GET (which would put credentials in the URL).
    for (const method of await page
      .locator('form')
      .evaluateAll((fs) => fs.map((f) => f.getAttribute('method')))) {
      expect(method).toBe('post');
    }
    // Client JS hydrated under the nonce policy: the show-password toggle works.
    const toggle = page.getByRole('button', { name: 'Show password' });
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
      await expect(page.getByRole('button', { name: 'Hide password' }).first()).toBeVisible();
    }
    expect(violations).toEqual([]);
  });
}

test('verify-email without an open challenge shows the empty state', async ({ page }) => {
  await page.goto('/verify-email');
  await expect(page.getByText(/no verification in progress/i)).toBeVisible();
});

test('authenticated area redirects to sign-in without a session', async ({ page }) => {
  await page.goto('/app/settings/profile');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fsettings%2Fprofile$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
});

test('BFF proxy rejects unknown paths and cross-origin mutations', async ({ request }) => {
  const unknown = await request.get('/api/v1/admin/system');
  expect(unknown.status()).toBe(404);
  const forged = await request.post('/api/v1/auth/logout-all', {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    data: {},
  });
  expect(forged.status()).toBe(403);
  const login = await request.post('/api/auth/login', {
    headers: { origin: 'https://evil.example' },
    data: { email: 'a@example.com', password: 'x' },
  });
  expect(login.status()).toBe(403);
});

test('unknown routes show the not-found page', async ({ page }) => {
  const response = await page.goto('/definitely-missing');
  expect(response?.status()).toBe(404);
});
