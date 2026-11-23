import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Phase 02 chat E2E against the real stack (see playwright.chat.config.ts): browser → Next BFF →
 * KAREN API → AI service (mock gateway). Every test uses a fresh user. Mock directives such as
 * [[mock:slow]] are understood ONLY by the local mock gateway.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:4110';
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

/**
 * Mints a local-dev session. The route is behind the API's strict "sensitive" rate limiter
 * (per client, per minute), so 429s are waited out using Retry-After.
 */
async function devToken(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(`${API}/dev/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: `dev|e2e-${randomUUID().slice(0, 12)}` }),
    });
    if (res.status === 200) return ((await res.json()) as { access_token: string }).access_token;
    expect(res.status).toBe(429);
    const wait = Math.min(Number(res.headers.get('retry-after') ?? '10') || 10, 30);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  throw new Error('could not mint a dev session');
}

/** Signs the browser in with a local-dev session (local-http cookie names). */
async function signIn(context: BrowserContext, baseURL: string): Promise<string> {
  const token = await devToken();
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: 'karen_session',
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
    {
      name: 'karen_csrf',
      value: randomUUID().replaceAll('-', ''),
      domain: url.hostname,
      path: '/',
      sameSite: 'Lax',
    },
  ]);
  return token;
}

async function openChat(page: Page, { allow = true } = {}) {
  await page.goto('/app/chat');
  await expect(page.getByRole('heading', { name: 'New conversation', level: 1 })).toBeVisible();
  if (allow) {
    await page.getByRole('button', { name: 'Allow AI processing' }).click();
    await expect(page.getByRole('region', { name: 'Permission needed' })).toBeHidden();
  }
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message KAREN' });
const log = (page: Page) => page.getByRole('log', { name: 'Messages' });

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

/** Waits for the latest answer to finish (Regenerate/Try again appears only then). */
async function waitForAnswer(page: Page) {
  await expect(
    log(page)
      .getByRole('button', { name: /^(Regenerate|Try again)$/ })
      .last(),
  ).toBeVisible({ timeout: 45_000 });
}

let token = '';
test.beforeEach(async ({ context, baseURL }) => {
  token = await signIn(context, baseURL!);
});

test('consent → send → streamed answer is shown in full, labelled as test reply, and persists', async ({
  page,
}) => {
  await openChat(page, { allow: false });
  await expect(page.getByRole('region', { name: 'Permission needed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.getByRole('button', { name: 'Allow AI processing' }).click();
  await send(page, 'Namaste KAREN, kal ka plan banao');
  await expect(page).toHaveURL(/\/app\/chat\/[0-9a-f-]{36}$/);
  await waitForAnswer(page);
  await expect(log(page)).toContainText('Namaste KAREN, kal ka plan banao');
  await expect(log(page)).toContainText('Real answers arrive once the live AI gateway is enabled');
  await expect(log(page).getByText('Test reply — no AI model', { exact: true })).toBeVisible();
  await expect(page.getByText('Test mode')).toBeVisible();
  const before = await log(page).innerText();
  await page.reload();
  await waitForAnswer(page);
  expect(await log(page).innerText()).toBe(before);
  // The conversation is listed with its automatic title.
  await expect(
    page
      .getByRole('navigation', { name: 'Conversations' })
      .getByRole('link', { name: /Namaste KAREN/ }),
  ).toBeVisible();
  if (SHOTS) {
    await page.evaluate(() => localStorage.setItem('karen-theme', 'light'));
    await page.reload();
    await waitForAnswer(page);
    await page.screenshot({ path: `${SHOTS}/chat-light.png`, fullPage: true });
  }
});

test('model output is rendered as safe Markdown (no HTML injection)', async ({ page }) => {
  let dialog = false;
  page.on('dialog', async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await openChat(page);
  await send(page, '<img src=x onerror=alert(1)> **bold** <script>alert(2)</script>');
  await waitForAnswer(page);
  await expect(log(page).locator('img')).toHaveCount(0);
  await expect(log(page).locator('script')).toHaveCount(0);
  await expect(log(page).locator('strong').filter({ hasText: 'bold' }).first()).toBeVisible();
  await expect(log(page)).toContainText('<img src=x onerror=alert(1)>');
  expect(dialog).toBe(false);
});

test('Stop ends a running answer and shows the canceled state', async ({ page }) => {
  await openChat(page);
  await send(page, 'Write a lot please [[mock:slow]] [[mock:long]]');
  const stop = page.getByRole('button', { name: 'Stop the answer' });
  await expect(stop).toBeVisible();
  await expect(log(page)).toContainText('Local test reply');
  await stop.click();
  await expect(log(page)).toContainText('You stopped this answer.');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(log(page)).not.toContainText('Line 60');
});

test('an interrupted answer is marked incomplete and "Try again" regenerates it', async ({
  page,
}) => {
  await openChat(page);
  await send(page, `Partial please ${randomUUID().slice(0, 6)} [[mock:flaky_after=3]]`);
  await expect(log(page)).toContainText('This answer was interrupted, so it may be incomplete.', {
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Try again' }).click();
  await waitForAnswer(page);
  await expect(log(page).getByRole('button', { name: 'Regenerate' })).toBeVisible();
  await expect(log(page)).toContainText('Real answers arrive');
  await expect(log(page)).not.toContainText('may be incomplete');
});

test('reloading mid-stream resumes the same answer without duplicating text', async ({ page }) => {
  await openChat(page);
  await send(page, 'Slow answer please [[mock:slow]]');
  await expect(page).toHaveURL(/\/app\/chat\/[0-9a-f-]{36}$/);
  await expect(log(page)).toContainText('Local test reply');
  await page.reload();
  await waitForAnswer(page);
  const text = await log(page).innerText();
  expect(text.match(/Local test reply/g)).toHaveLength(1);
  expect(text.match(/Real answers arrive/g)).toHaveLength(1);
});

test('rename, pin, search, archive and delete a conversation', async ({ page }) => {
  await openChat(page);
  const tag = randomUUID().slice(0, 6);
  await send(page, `Trip ideas ${tag}`);
  await waitForAnswer(page);
  const nav = page.getByRole('navigation', { name: 'Conversations' });
  const options = () => nav.getByRole('button', { name: /^Options for / }).first();

  await options().click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'New title' }).fill(`Goa ${tag}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(nav.getByRole('link', { name: new RegExp(`Goa ${tag}`) })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Goa ${tag}`);

  await options().click();
  await page.getByRole('menuitem', { name: 'Pin' }).click();
  await expect(nav.getByLabel('Pinned').first()).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search conversations' }).fill(`zzz-no-match-${tag}`);
  await expect(nav).toContainText('No conversations match');
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill(tag);
  await expect(nav.getByRole('link', { name: new RegExp(`Goa ${tag}`) })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('');

  await options().click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(nav.getByRole('link', { name: new RegExp(`Goa ${tag}`) })).toBeHidden();
  await nav.getByRole('button', { name: 'Archived' }).click();
  await expect(nav.getByRole('link', { name: new RegExp(`Goa ${tag}`) })).toBeVisible();

  await options().click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/app\/chat$/);
  await expect(nav.getByRole('link', { name: new RegExp(`Goa ${tag}`) })).toBeHidden();
});

test('thumbs up/down with a category is saved and survives reload', async ({ page }) => {
  await openChat(page);
  await send(page, 'Rate me');
  await waitForAnswer(page);
  await page.getByRole('button', { name: 'Good answer' }).click();
  await expect(page.getByRole('button', { name: 'Good answer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Bad answer' }).click();
  await page.getByRole('button', { name: 'Wrong language or tone' }).click();
  await expect(page.getByRole('button', { name: 'Bad answer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload();
  await waitForAnswer(page);
  await expect(page.getByRole('button', { name: 'Bad answer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Good answer' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('editing a message forks a new conversation from that point', async ({ page }) => {
  await openChat(page);
  await send(page, 'Original question');
  await waitForAnswer(page);
  const original = page.url();
  await page.getByRole('button', { name: 'Edit this message' }).click();
  await page.getByRole('textbox', { name: 'Edited message' }).fill('Edited question');
  await page.getByRole('button', { name: 'Send edit' }).click();
  await expect(page).not.toHaveURL(original);
  await expect(page).toHaveURL(/\/app\/chat\/[0-9a-f-]{36}$/);
  await waitForAnswer(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('(edited)');
  await expect(log(page)).toContainText('Edited question');
  await expect(log(page)).not.toContainText('Original question');
  await page.goto(original);
  await waitForAnswer(page);
  await expect(log(page)).toContainText('Original question');
});

test('offline: banner shown, sending disabled, draft kept; recovers when back online', async ({
  page,
  context,
}) => {
  await openChat(page);
  await composer(page).fill('Draft written offline');
  await context.setOffline(true);
  await expect(page.getByText('You’re offline. We’ll reconnect')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByText('You’re offline. We’ll reconnect')).toBeHidden();
  await expect(composer(page)).toHaveValue('Draft written offline');
  // Drafts survive a reload of the tab.
  await page.reload();
  await expect(composer(page)).toHaveValue('Draft written offline');
});

test('revoking consent shows the consent card again; history stays readable', async ({ page }) => {
  await openChat(page);
  await send(page, 'Before revoking');
  await waitForAnswer(page);
  const consents = (await (
    await fetch(`${API}/v1/me/consents`, { headers: { authorization: `Bearer ${token}` } })
  ).json()) as { items: { purpose: string; version: number; notice_version: string }[] };
  const ai = consents.items.find((c) => c.purpose === 'AI_PROCESSING')!;
  const revoke = await fetch(`${API}/v1/me/consents/AI_PROCESSING`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'if-match': `"${ai.version}"`,
    },
    body: JSON.stringify({
      decision: 'revoke',
      notice_version: ai.notice_version,
      source: 'settings',
    }),
  });
  expect(revoke.status).toBe(200);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Permission needed' })).toBeVisible();
  await expect(log(page)).toContainText('Before revoking');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

test('keyboard only: Enter sends, Shift+Enter adds a line', async ({ page }) => {
  await openChat(page);
  await composer(page).focus();
  await page.keyboard.type('First line');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Second line');
  await expect(composer(page)).toHaveValue('First line\nSecond line');
  await page.keyboard.press('Enter');
  await waitForAnswer(page);
  await expect(log(page)).toContainText('First line');
  await expect(log(page)).toContainText('Second line');
});

test('basic accessibility: landmarks, one h1, labelled controls, live region', async ({ page }) => {
  await openChat(page);
  await send(page, 'Accessibility check');
  await waitForAnswer(page);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible();
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveCount(1);
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], textarea, input, select')]
      .filter((el) => {
        const e = el as HTMLElement;
        if (e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return false;
        const label =
          e.getAttribute('aria-label') ||
          e.getAttribute('aria-labelledby') ||
          (e.id && document.querySelector(`label[for="${e.id}"]`)) ||
          e.closest('label') ||
          e.textContent?.trim() ||
          e.getAttribute('title');
        return !label;
      })
      .map((e) => e.outerHTML.slice(0, 120)),
  );
  expect(unnamed).toEqual([]);
  // Interactive chat controls meet the 36–44 px target sizes used across the app.
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll('main button')]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.height < 36 || r.width < 36)).length,
  );
  expect(small).toBe(0);
});

test('dark theme screenshot', async ({ page }) => {
  test.skip(!SHOTS, 'screenshots only when E2E_SCREENSHOT_DIR is set');
  await page.emulateMedia({ colorScheme: 'dark' });
  await openChat(page);
  await send(page, 'Plan a weekend in Jaipur on a ₹15,000 budget');
  await waitForAnswer(page);
  await page.screenshot({ path: `${SHOTS}/chat-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const drawer = page.locator('#chat-sidebar');
  // Closed drawer: off-screen AND out of the tab order.
  await expect(drawer).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/chat-mobile-dark.png` });
  await page.getByRole('button', { name: 'Show conversations' }).click();
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(400); // let the slide-in transition finish
  await page.screenshot({ path: `${SHOTS}/chat-mobile-drawer-dark.png` });
});
