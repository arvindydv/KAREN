import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import LaunchScreen from '../app/index';
import { parseMobileEnv } from './lib/env';
import { createInMemoryCredentialStore } from './lib/secure-storage';
import { buildTheme } from './theme/theme';

describe('mobile foundation', () => {
  it('renders the launch screen accessibly', async () => {
    await render(<LaunchScreen />);
    expect(screen.getByRole('header')).toHaveTextContent(/Taken care of/);
    expect(screen.getByText('KAREN')).toBeTruthy();
    // Sign-up is not built yet: the CTA is visibly disabled and says so to screen readers.
    const cta = screen.getByRole('button', { name: /get started/i });
    expect(cta).toBeDisabled();
    expect(cta.props.accessibilityHint).toMatch(/next release/i);
    expect(screen.getByText(/sign-up coming soon/i)).toBeTruthy();
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
    // Signature theme: deep-space navy background with the bright blue action colour.
    expect(buildTheme('dark').colors.background).toBe('#060A1C');
    expect(buildTheme('dark').colors.accent).toBe('#2563EB');
  });
});
