import { expect, test, type Page } from '@playwright/test';

/** Runs WITHOUT the API: public pages render under a nonce CSP; the console requires a session. */

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  page.on('pageerror', (error) => violations.push(`pageerror: ${error.message}`));
  return violations;
}

const scriptSrc = (csp: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('script-src')) ?? '';

for (const [path, heading] of [
  ['/sign-in', 'Staff sign-in'],
  ['/enroll', 'Set up staff access'],
] as const) {
  test(`${path} renders with a nonce CSP and no CSP violations`, async ({ page }) => {
    const violations = collectCspViolations(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    const csp = headers['content-security-policy'] ?? '';
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc(csp))?.[1];
    expect(nonce).toBeTruthy();
    expect(scriptSrc(csp)).toContain("'strict-dynamic'");
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(scriptSrc(csp)).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['x-robots-tag']).toContain('noindex');

    // Next.js stamped the per-request nonce on its scripts, and hydration ran.
    const scriptNonces = await page
      .locator('script')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLScriptElement).nonce));
    expect(scriptNonces.length).toBeGreaterThan(0);
    expect(scriptNonces.every((n) => n === nonce)).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    expect(violations).toEqual([]);

    // A fresh nonce on every request.
    const again = await page.request.get(path);
    expect(again.headers()['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
  });
}

test('sign-in issues the double-submit CSRF cookie (Secure, SameSite=Strict, __Host-)', async ({
  page,
  context,
}) => {
  await page.goto('/sign-in');
  const csrf = (await context.cookies()).find((c) => c.name === '__Host-karen_staff_csrf');
  expect(csrf).toBeDefined();
  expect(csrf?.secure).toBe(true);
  expect(csrf?.sameSite).toBe('Strict');
  expect(csrf?.path).toBe('/');
  expect(csrf?.httpOnly).toBe(false);
});

test('enroll without a fragment token explains what is needed', async ({ page }) => {
  await page.goto('/enroll');
  await expect(page.getByText(/full enrollment link/)).toBeVisible();
});

test('enroll strips the token fragment from the address bar', async ({ page }) => {
  await page.goto(`/enroll#ken_${'a'.repeat(43)}`);
  await expect(page.getByLabel('Security key name')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});

for (const path of [
  '/',
  '/account',
  '/system',
  '/invitations',
  '/elevations',
  '/staff',
  '/users',
]) {
  test(`${path} redirects to /sign-in when signed out`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  });
}

test('BFF refuses cross-origin and token-less mutations', async ({ request }) => {
  const crossOrigin = await request.post('/api/session/login/options', {
    headers: { origin: 'https://evil.test' },
    data: { email: 'a@b.c', password: 'x'.repeat(20) },
  });
  expect(crossOrigin.status()).toBe(403);
  const noToken = await request.post('/api/staff/invitations', {
    headers: { origin: 'http://localhost:3101' },
    data: {},
  });
  expect(noToken.status()).toBe(403);
});
