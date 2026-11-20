import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type * as ReactNative from 'react-native';
import DeletionScheduledScreen from '../app/deletion-scheduled';
import SignInScreen from '../app/(auth)/sign-in';
import VerifyEmailScreen from '../app/(auth)/verify-email';
import { createAppServices, ServicesProvider, type AppServices } from './auth/services';
import { ConsentToggles } from './features/consent-toggles';
import { createInMemoryCredentialStore } from './lib/secure-storage';
import { useChallengeStore } from './state/challenge-store';
import { useSessionStore } from './state/session-store';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
};
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof ReactNative>('react-native');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
  };
});

type Route = (req: Request, body: unknown) => Response | undefined;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, message: string, extra: object = {}) =>
  json(status, { error: { code, message, correlation_id: 'corr-1', retryable: false, ...extra } });

/** Fake fetch behind the REAL typed client; records requests for assertions. */
function fakeApi(routes: Record<string, Route>) {
  const calls: { method: string; path: string; headers: Headers; body: unknown }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const path = new URL(req.url).pathname;
    const text = await req.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, path, headers: req.headers, body });
    const handler = routes[`${req.method} ${path}`];
    return handler?.(req, body) ?? apiError(404, 'NOT_FOUND', 'Not found');
  };
  return { fetch: fetchImpl, calls };
}

let services: AppServices;
let queryClient: QueryClient | undefined;
async function renderWith(ui: ReactNode, routes: Record<string, Route>) {
  const api = fakeApi(routes);
  services = createAppServices({
    store: createInMemoryCredentialStore(),
    fetch: api.fetch,
    baseUrl: 'http://api.test',
    platform: 'ios',
  });
  // gcTime: Infinity → no garbage-collection timers left running after the test.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  queryClient = client;
  const utils = await render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={services} restoreOnMount={false}>
        {ui}
      </ServicesProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls: api.calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  useChallengeStore.setState({ pending: null, signInEmail: null, flash: null });
  useSessionStore.setState({ status: 'signed_out', accountStatus: null, refreshProblem: null });
});
afterEach(() => {
  services?.session.dispose();
  queryClient?.clear();
});

describe('Sign in', () => {
  const fill = async () => {
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'asha@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'a long enough passphrase');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  };

  it('shows a safe message for INVALID_CREDENTIALS and keeps the user signed out', async () => {
    await renderWith(<SignInScreen />, {
      'POST /v1/auth/login': () => apiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials'),
    });
    await fill();
    expect(await screen.findByText(/e-mail and password don’t match/)).toBeTruthy();
    expect(services.session.getSnapshot().status).not.toBe('signed_in');
  });

  it('offers password reset for ACCOUNT_INACTIVE with RESET_PASSWORD', async () => {
    await renderWith(<SignInScreen />, {
      'POST /v1/auth/login': () =>
        apiError(403, 'ACCOUNT_INACTIVE', 'This account is locked.', {
          next_options: ['RESET_PASSWORD'],
        }),
    });
    await fill();
    expect(await screen.findByText('This account is locked.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reset your password' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/forgot-password');
  });

  it('shows rate limiting plainly', async () => {
    await renderWith(<SignInScreen />, {
      'POST /v1/auth/login': () => apiError(429, 'RATE_LIMITED', 'Too many requests'),
    });
    await fill();
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy();
  });

  it('routes verification_required to the code screen without putting the handle in the URL', async () => {
    const { calls } = await renderWith(<SignInScreen />, {
      'POST /v1/auth/login': () =>
        json(200, {
          result: 'verification_required',
          challenge: {
            challenge_handle: 'secret-handle',
            expires_at: '2026-11-20T10:10:00.000Z',
            code_length: 6,
            delivery: 'email',
          },
        }),
    });
    await fill();
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/verify-email'));
    expect(JSON.stringify(mockRouter.push.mock.calls)).not.toMatch(/secret-handle/);
    expect(useChallengeStore.getState().pending?.handle).toBe('secret-handle');
    expect(calls[0]?.body).toMatchObject({ client: 'ios' });
  });
});

describe('Verify e-mail', () => {
  const pending = {
    purpose: 'verify_email' as const,
    handle: 'h-123',
    email: 'asha@example.com',
    expiresAt: '2026-11-20T10:10:00.000Z',
  };

  it('requires 6 digits, submits the code and moves to sign-in', async () => {
    useChallengeStore.setState({ pending });
    const { calls } = await renderWith(<VerifyEmailScreen />, {
      'POST /v1/auth/verify-email': () => json(200, { status: 'email_verified', next: 'sign_in' }),
    });
    const verify = screen.getByRole('button', { name: 'Verify' });
    expect(verify).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '12a3456');
    expect(screen.getByLabelText('6-digit code').props.value).toBe('123456');
    expect(verify).toBeEnabled();
    await fireEvent.press(verify);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(calls[0]?.body).toEqual({ challenge_handle: 'h-123', code: '123456' });
    expect(useChallengeStore.getState()).toMatchObject({
      pending: null,
      signInEmail: 'asha@example.com',
      flash: expect.stringMatching(/verified/),
    });
  });

  it('shows CHALLENGE_INVALID and a resend cooldown', async () => {
    useChallengeStore.setState({ pending });
    await renderWith(<VerifyEmailScreen />, {
      'POST /v1/auth/verify-email': () => apiError(400, 'CHALLENGE_INVALID', 'Invalid code'),
    });
    expect(screen.getByText(/request a new code in 30s/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '000000');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/isn’t valid or has expired/)).toBeTruthy();
  });

  it('explains when there is no verification in progress', async () => {
    await renderWith(<VerifyEmailScreen />, {});
    expect(screen.getByText('No verification in progress.')).toBeTruthy();
  });
});

describe('Consent toggles', () => {
  const routes: Record<string, Route> = {
    'GET /v1/consent/purposes': () =>
      json(200, {
        items: [
          {
            purpose: 'MEMORY_STORAGE',
            title: 'Memory',
            description: 'Remember what you share.',
            availability: 'available',
            depends_on: [],
            legal_basis_status: 'pending_legal_review',
          },
          {
            purpose: 'FAMILY_SHARING',
            title: 'Family sharing',
            description: 'Share with family.',
            availability: 'not_yet_available',
            depends_on: [],
            legal_basis_status: 'pending_legal_review',
          },
        ],
      }),
    'GET /v1/me/consents': () =>
      json(200, {
        items: [
          {
            purpose: 'MEMORY_STORAGE',
            decision: 'not_asked',
            version: 0,
            decided_at: null,
            notice_version: null,
          },
        ],
      }),
    'GET /v1/consent/notices': () =>
      json(200, {
        items: [
          {
            kind: 'privacy_notice',
            locale: 'en-IN',
            version: '0.1.0',
            state: 'draft',
            effective_from: null,
            content_sha256: 'abc',
          },
        ],
      }),
    'PUT /v1/me/consents/MEMORY_STORAGE': () =>
      json(200, {
        state: {
          purpose: 'MEMORY_STORAGE',
          decision: 'granted',
          version: 1,
          decided_at: '2026-11-20T10:00:00.000Z',
          notice_version: '0.1.0',
        },
        receipts: [],
      }),
  };

  it('defaults OFF, marks drafts, and does not offer a toggle for unavailable purposes', async () => {
    useSessionStore.setState({ status: 'signed_in', accountStatus: 'ACTIVE' });
    await renderWith(<ConsentToggles source="settings" />, routes);
    const memory = await screen.findByRole('switch', { name: 'Memory' });
    expect(memory.props.value).toBe(false);
    expect(screen.getByText(/Draft — not legally reviewed/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Family sharing' })).toBeNull();
    expect(screen.getByText(/Coming later/)).toBeTruthy();
  });

  it('grants with If-Match, an Idempotency-Key and the notice version shown', async () => {
    const { calls } = await renderWith(<ConsentToggles source="onboarding" />, routes);
    const memory = await screen.findByRole('switch', { name: 'Memory' });
    await fireEvent(memory, 'valueChange', true);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ decision: 'grant', notice_version: '0.1.0', source: 'onboarding' });
    expect(put?.headers.get('if-match')).toBe('"0"');
    expect(put?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Deletion scheduled', () => {
  const deletion = {
    id: '3f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
    kind: 'deletion',
    status: 'scheduled',
    requested_at: '2026-11-20T10:00:00.000Z',
    scheduled_for: '2026-12-20T10:00:00.000Z',
    completed_at: null,
    cancelled_at: null,
    expires_at: null,
    download_available: false,
    retention_exceptions: [],
  };

  async function restoredDeletionSession() {
    await services.store.set('karen.auth.refresh_token', 'r1');
    await services.store.set('karen.auth.access_token', 'a1');
    await services.store.set('karen.auth.access_token_expires_at', '2999-01-01T00:00:00.000Z');
    await services.store.set('karen.auth.account_status', 'DELETION_REQUESTED');
    await act(async () => {
      await services.session.restore();
    });
  }

  it('shows the schedule and cancels deletion back to a full session', async () => {
    const { calls } = await renderWith(<DeletionScheduledScreen />, {
      'GET /v1/me/data-rights': () => json(200, { items: [deletion] }),
      [`POST /v1/me/data-rights/${deletion.id}/cancel`]: () =>
        json(200, { ...deletion, status: 'cancelled', cancelled_at: '2026-11-21T00:00:00.000Z' }),
    });
    await restoredDeletionSession();
    expect(await screen.findByText(/scheduled to be deleted/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel deletion' }));
    await waitFor(() => expect(services.session.getSnapshot().accountStatus).toBe('ACTIVE'));
    const cancel = calls.find((c) => c.path.endsWith('/cancel'));
    expect(cancel?.headers.get('authorization')).toBe('Bearer a1');
    expect(await screen.findByText('redirect:/home')).toBeTruthy();
  });

  it('signs out and clears local secrets', async () => {
    await renderWith(<DeletionScheduledScreen />, {
      'GET /v1/me/data-rights': () => json(200, { items: [deletion] }),
      'POST /v1/auth/logout': () => json(200, { revoked_sessions: 1 }),
    });
    await restoredDeletionSession();
    await screen.findByText(/scheduled to be deleted/);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(services.session.getSnapshot().status).toBe('signed_out'));
    expect(await services.store.get('karen.auth.refresh_token')).toBeNull();
    expect(await screen.findByText('redirect:/')).toBeTruthy();
  });

  it('shows an error with retry when the request list fails', async () => {
    await renderWith(<DeletionScheduledScreen />, {
      'GET /v1/me/data-rights': () =>
        json(503, {
          error: {
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'Unavailable',
            correlation_id: 'c',
            retryable: true,
          },
        }),
    });
    await restoredDeletionSession();
    expect(await screen.findByText(/temporarily unavailable/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
