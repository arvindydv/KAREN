import { ConfigError } from '@karen/config';
import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5442/karen',
  REDIS_URL: 'redis://localhost:6390/0',
};
// Shape-valid, NOT a real key (config validation checks structure only).
const fakeJwk = (kid: string) => ({
  kty: 'EC',
  crv: 'P-256',
  x: 'A'.repeat(43),
  y: 'B'.repeat(43),
  d: 'C'.repeat(43),
  kid,
});
const deployed = {
  AUTH_MODE: 'first-party',
  ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([fakeJwk('k1'), fakeJwk('k0')]),
  ACCESS_TOKEN_CURRENT_KID: 'k1',
  INTERNAL_SERVICE_HMAC_SECRET: 'x'.repeat(40),
  LOG_PSEUDONYMIZATION_KEY: 'k'.repeat(40),
  PASSWORD_PEPPERS: `p1:${Buffer.alloc(32, 7).toString('base64url')}`,
  PASSWORD_PEPPER_CURRENT_ID: 'p1',
  OTP_HMAC_KEY: 'o'.repeat(40),
  EMAIL_TRANSPORT: 'brevo-smtp',
  BREVO_SMTP_LOGIN: 'login@smtp-brevo.example',
  BREVO_SMTP_KEY: 'test-only-not-a-key',
  EMAIL_FROM: 'KAREN <no-reply@example.com>',
};

describe('API environment validation', () => {
  it('accepts a minimal local configuration', () => {
    const env = loadApiEnv({ ...base, AUTH_MODE: 'local-dev' });
    expect(env).toMatchObject({ APP_ENV: 'local', API_PORT: 4100, AUTH_MODE: 'local-dev' });
  });

  it.each(['dev', 'staging', 'production'])(
    'refuses the local-dev auth mode when APP_ENV=%s',
    (APP_ENV) => {
      expect(() => loadApiEnv({ ...base, ...deployed, APP_ENV, AUTH_MODE: 'local-dev' })).toThrow(
        /local-dev is forbidden/,
      );
    },
  );

  it('defaults to first-party auth and refuses the removed OIDC mode', () => {
    expect(loadApiEnv(base).AUTH_MODE).toBe('first-party');
    expect(() => loadApiEnv({ ...base, AUTH_MODE: 'oidc' })).toThrow(ConfigError);
  });

  it('requires shared access-token signing keys when deployed and validates them', () => {
    const { ACCESS_TOKEN_SIGNING_KEYS: _k, ...noKeys } = deployed;
    expect(() => loadApiEnv({ ...base, ...noKeys, APP_ENV: 'staging' })).toThrow(
      /ACCESS_TOKEN_SIGNING_KEYS: required/,
    );
    expect(() =>
      loadApiEnv({ ...base, ...deployed, APP_ENV: 'staging', ACCESS_TOKEN_CURRENT_KID: 'k9' }),
    ).toThrow(/must name a key/);
    expect(() =>
      loadApiEnv({
        ...base,
        ACCESS_TOKEN_SIGNING_KEYS: '{not json',
        ACCESS_TOKEN_CURRENT_KID: 'x',
      }),
    ).toThrow(/JSON array/);
    const rsa = JSON.stringify([{ kty: 'RSA', n: 'AQAB', e: 'AQAB', d: 'AQAB', kid: 'r' }]);
    expect(() =>
      loadApiEnv({ ...base, ACCESS_TOKEN_SIGNING_KEYS: rsa, ACCESS_TOKEN_CURRENT_KID: 'r' }),
    ).toThrow(/EC P-256/);
    const dup = JSON.stringify([fakeJwk('k1'), fakeJwk('k1')]);
    expect(() =>
      loadApiEnv({ ...base, ACCESS_TOKEN_SIGNING_KEYS: dup, ACCESS_TOKEN_CURRENT_KID: 'k1' }),
    ).toThrow(/duplicate kid/);
    try {
      loadApiEnv({
        ...base,
        ACCESS_TOKEN_SIGNING_KEYS: '{secret-ish',
        ACCESS_TOKEN_CURRENT_KID: 'x',
      });
    } catch (e) {
      expect(String(e)).not.toContain('secret-ish');
    }
  });

  it('rejects an idle timeout longer than the absolute session lifetime', () => {
    expect(() =>
      loadApiEnv({ ...base, WEB_SESSION_IDLE_HOURS: '100', WEB_SESSION_ABSOLUTE_DAYS: '1' }),
    ).toThrow(/WEB_SESSION_IDLE_HOURS/);
  });

  it('requires internal HMAC and pseudonymisation secrets when deployed', () => {
    const { INTERNAL_SERVICE_HMAC_SECRET: _h, ...noHmac } = deployed;
    expect(() => loadApiEnv({ ...base, ...noHmac, APP_ENV: 'staging' })).toThrow(
      /INTERNAL_SERVICE_HMAC_SECRET/,
    );
    expect(() => loadApiEnv({ ...base, ...deployed, APP_ENV: 'staging' })).not.toThrow();
  });

  it('refuses API docs and wildcard CORS in production', () => {
    expect(() =>
      loadApiEnv({ ...base, ...deployed, APP_ENV: 'production', API_DOCS_ENABLED: 'true' }),
    ).toThrow(/API_DOCS_ENABLED/);
    expect(() =>
      loadApiEnv({ ...base, ...deployed, APP_ENV: 'production', API_CORS_ALLOWED_ORIGINS: '*' }),
    ).toThrow(/CORS/);
  });

  it('requires a valid password pepper when deployed and validates it everywhere', () => {
    const { PASSWORD_PEPPERS: _p, PASSWORD_PEPPER_CURRENT_ID: _c, ...noPepper } = deployed;
    expect(() => loadApiEnv({ ...base, ...noPepper, APP_ENV: 'staging' })).toThrow(
      /PASSWORD_PEPPERS: required/,
    );
    expect(() =>
      loadApiEnv({ ...base, ...deployed, APP_ENV: 'staging', PASSWORD_PEPPER_CURRENT_ID: 'p9' }),
    ).toThrow(/must name a key/);
    expect(() =>
      loadApiEnv({ ...base, AUTH_MODE: 'local-dev', PASSWORD_PEPPERS: 'p1:dG9vLXNob3J0' }),
    ).toThrow(/≥ 32 bytes/);
    expect(() =>
      loadApiEnv({ ...base, AUTH_MODE: 'local-dev', PASSWORD_PEPPERS: deployed.PASSWORD_PEPPERS }),
    ).toThrow(/CURRENT_ID is required/);
    // Local development may run without a pepper.
    expect(loadApiEnv({ ...base, AUTH_MODE: 'local-dev' }).PASSWORD_PEPPERS).toBeUndefined();
  });

  it('requires real e-mail delivery and an OTP key when deployed; memory transport is local-only', () => {
    expect(() =>
      loadApiEnv({ ...base, ...deployed, APP_ENV: 'staging', EMAIL_TRANSPORT: 'memory' }),
    ).toThrow(/EMAIL_TRANSPORT must be brevo-smtp/);
    const { OTP_HMAC_KEY: _o, ...noOtp } = deployed;
    expect(() => loadApiEnv({ ...base, ...noOtp, APP_ENV: 'staging' })).toThrow(/OTP_HMAC_KEY/);
    expect(() =>
      loadApiEnv({ ...base, AUTH_MODE: 'local-dev', EMAIL_TRANSPORT: 'brevo-smtp' }),
    ).toThrow(/BREVO_SMTP_KEY/);
    expect(() =>
      loadApiEnv({
        ...base,
        ...deployed,
        APP_ENV: 'staging',
        EMAIL_FROM: 'KAREN <a@b>\r\nBcc: x@y',
      }),
    ).toThrow(/EMAIL_FROM/);
    expect(loadApiEnv({ ...base, AUTH_MODE: 'local-dev' }).EMAIL_TRANSPORT).toBe('memory');
  });
});
