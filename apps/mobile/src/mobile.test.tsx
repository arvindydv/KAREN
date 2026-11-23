import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import WelcomeScreen from '../app/(auth)/index';
import { parseMobileEnv, resolveDevApiBaseUrl } from './lib/env';
import { describeError, passwordReasonText, toApiError } from './lib/api-error';
import { createInMemoryCredentialStore } from './lib/secure-storage';
import { passwordProblem } from './lib/validation';
import { buildTheme } from './theme/theme';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

describe('mobile foundation', () => {
  it('renders the welcome screen accessibly with sign-up and sign-in', async () => {
    await render(<WelcomeScreen />);
    expect(screen.getByRole('header')).toHaveTextContent(/Taken care of/);
    expect(screen.getByText('KAREN')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(mockPush).toHaveBeenCalledWith('/sign-up');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockPush).toHaveBeenCalledWith('/sign-in');
  });

  it('maps API errors to safe, friendly text', () => {
    const weak = toApiError(400, {
      error: {
        code: 'WEAK_PASSWORD',
        message: 'Password rejected',
        correlation_id: 'c',
        retryable: false,
        details: [{ path: 'password', message: 'COMMONLY_USED' }],
      },
    });
    expect(describeError(weak)).toMatch(/too common/);
    expect(passwordReasonText('TOO_SHORT')).toMatch(/15 characters/);
    expect(
      describeError(
        toApiError(412, {
          error: {
            code: 'PRECONDITION_FAILED',
            message: 'x',
            correlation_id: 'c',
            retryable: false,
          },
        }),
      ),
    ).toMatch(/latest version/);
    expect(describeError(toApiError(502, undefined))).toBe('Request failed (502).');
  });

  it('checks password length in code points (15–256), with no composition rules', () => {
    expect(passwordProblem('short')).toMatch(/at least 15/);
    expect(passwordProblem('a'.repeat(15))).toBeNull();
    expect(passwordProblem('मेरा पासवर्ड बहुत लंबा है')).toBeNull();
    expect(passwordProblem('x'.repeat(257))).toMatch(/at most 256/);
  });

  it('validates public env and refuses plain-http API in production', () => {
    expect(parseMobileEnv({}).EXPO_PUBLIC_API_BASE_URL).toBe('http://localhost:4100');
    expect(() =>
      parseMobileEnv({
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_BASE_URL: 'http://api.example.com',
      }),
    ).toThrow(/https/);
    expect(() => parseMobileEnv({ EXPO_PUBLIC_API_BASE_URL: 'not a url' })).toThrow();
  });

  it('local dev follows the Metro host so a changed Wi-Fi IP still reaches the API', () => {
    const local = parseMobileEnv({ EXPO_PUBLIC_API_BASE_URL: 'http://10.109.57.35:4100' });
    expect(resolveDevApiBaseUrl(local, '192.168.1.19:8081').EXPO_PUBLIC_API_BASE_URL).toBe(
      'http://192.168.1.19:4100',
    );
    // No Metro host, or a tunnel host: keep the configured URL.
    expect(resolveDevApiBaseUrl(local, undefined)).toBe(local);
    expect(resolveDevApiBaseUrl(local, 'abc.exp.direct:80')).toBe(local);
    // Never rewritten outside local development.
    const staging = parseMobileEnv({
      EXPO_PUBLIC_APP_ENV: 'staging',
      EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com',
    });
    expect(resolveDevApiBaseUrl(staging, '192.168.1.19:8081')).toBe(staging);
  });

  it('credential store abstraction round-trips and deletes', async () => {
    const store = createInMemoryCredentialStore();
    await store.set('karen.auth.refresh_token', 'r1');
    expect(await store.get('karen.auth.refresh_token')).toBe('r1');
    await store.remove('karen.auth.refresh_token');
    expect(await store.get('karen.auth.refresh_token')).toBeNull();
  });

  it('builds light and dark themes from shared tokens with accessible touch targets', () => {
    expect(buildTheme('dark').colors.background).not.toBe(buildTheme('light').colors.background);
    expect(buildTheme('light').minTouchTarget).toBeGreaterThanOrEqual(44);
    // Signature theme: softened deep-space navy with the blue action colour.
    expect(buildTheme('dark').colors.background).toBe('#0A0F24');
    expect(buildTheme('dark').colors.accent).toBe('#3A6FE0');
  });
});
