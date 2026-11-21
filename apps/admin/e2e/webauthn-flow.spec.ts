import { expect, test } from '@playwright/test';

/**
 * OPT-IN end-to-end WebAuthn flow against a REAL local API (not part of CI):
 * enroll a (virtual) security key → sign in with password + key → step-up.
 *
 * Uses Chromium's CDP virtual authenticator (CTAP2, USB, user verification). How to run:
 *
 *   pnpm infra:up && pnpm db:migrate && pnpm db:roles
 *   # API env (apps/api/.env): STAFF_AUTH_ENABLED=true, STAFF_DATABASE_URL=<staff role URL>,
 *   #   STAFF_WEBAUTHN_RP_ID=localhost, STAFF_WEBAUTHN_ORIGINS=http://localhost:3101
 *   pnpm dev:api
 *   pnpm --filter @karen/api staff:bootstrap -- --email ops@karen.test --name "E2E Admin"
 *   KAREN_E2E_API=1 KAREN_E2E_ENROLLMENT_TOKEN=ken_… KAREN_E2E_STAFF_EMAIL=ops@karen.test \
 *     pnpm --filter @karen/admin test:e2e e2e/webauthn-flow.spec.ts
 *
 * The bootstrap token is single use and bootstrap refuses once any staff account exists, so use
 * a throwaway database (or an invitation token for a fresh e-mail) for each run.
 */
const enabled = process.env.KAREN_E2E_API === '1';
const enrollmentToken = process.env.KAREN_E2E_ENROLLMENT_TOKEN ?? '';
const email = process.env.KAREN_E2E_STAFF_EMAIL ?? 'ops@karen.test';
const password = `e2e correct horse battery ${Date.now()}`;

test.describe('staff WebAuthn flow (real API)', () => {
  test.skip(!enabled, 'opt-in: set KAREN_E2E_API=1 with a running local API (see file header)');
  test.describe.configure({ mode: 'serial' });

  test('enroll → sign in → step-up', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
    expect(enrollmentToken, 'KAREN_E2E_ENROLLMENT_TOKEN is required').toMatch(/^ken_/);

    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    // 1. Enrollment (token in the fragment only).
    await page.goto(`/enroll#${enrollmentToken}`);
    // The page strips the token from the URL once hydrated (it must never linger in history).
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    await page.getByLabel('Security key name').fill('Virtual key (e2e)');
    await page.getByLabel('New password').fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Register security key' }).click();
    await expect(page).toHaveURL(/\/sign-in\?enrolled=1$/);

    // 2. Sign in: password + security key.
    await page.getByLabel('Work e-mail').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in with security key' }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId('acting-identity')).toContainText(email);
    const session = (await context.cookies()).find((c) => c.name === '__Host-karen_staff');
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Strict');
    expect(await page.evaluate(() => document.cookie)).not.toContain('kst_');

    // 3a. Sensitive action through the UI (step-up modal appears if the window has lapsed).
    await page.goto('/invitations');
    await page.getByLabel('Work e-mail').fill(`invitee+${Date.now()}@karen.test`);
    await page.getByLabel('Display name').fill('E2E Invitee');
    await page.getByLabel('support_agent').check();
    await page.getByRole('button', { name: 'Create invitation' }).click();
    const useKey = page.getByRole('button', { name: 'Use security key' });
    if (await useKey.isVisible().catch(() => false)) await useKey.click();
    await expect(page.getByLabel('Enrollment link')).toHaveValue(/\/enroll#ken_/);

    // 3b. Explicit step-up ceremony through the BFF (always exercised).
    const stepUp = await page.evaluate(async () => {
      const csrf = /(?:^|; )(?:__Host-)?karen_staff_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
      const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf };
      const start = await fetch('/api/staff/auth/step-up/options', { method: 'POST', headers });
      if (!start.ok) return { stage: 'options', status: start.status };
      const { ceremony_handle, options } = (await start.json()) as {
        ceremony_handle: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      };
      const credential = (await navigator.credentials.get({
        publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
      })) as PublicKeyCredential;
      const verify = await fetch('/api/staff/auth/step-up/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ceremony_handle, credential: credential.toJSON() }),
      });
      return { stage: 'verify', status: verify.status };
    });
    expect(stepUp).toEqual({ stage: 'verify', status: 200 });

    // 4. Sign out clears the session.
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    expect((await context.cookies()).find((c) => c.name === '__Host-karen_staff')).toBeUndefined();
  });
});
