import { ConfigError } from '@karen/config';
import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5442/karen',
  REDIS_URL: 'redis://localhost:6390/0',
};
const oidc = {
  AUTH_MODE: 'oidc',
  OIDC_ISSUER_URL: 'https://issuer.example.com/',
  OIDC_AUDIENCE: 'karen-api',
  OIDC_JWKS_URL: 'https://issuer.example.com/.well-known/jwks.json',
  OIDC_ALLOWED_ALGORITHMS: 'RS256',
};
const deployed = {
  ...oidc,
  INTERNAL_SERVICE_HMAC_SECRET: 'x'.repeat(40),
  LOG_PSEUDONYMIZATION_KEY: 'k'.repeat(40),
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

  it('requires token_use=access when validating Cognito client_id instead of aud', () => {
    expect(() => loadApiEnv({ ...base, ...oidc, OIDC_AUDIENCE_CLAIM: 'client_id' })).toThrow(
      /OIDC_REQUIRED_TOKEN_USE/,
    );
    const cognito = {
      ...base,
      ...oidc,
      OIDC_AUDIENCE_CLAIM: 'client_id',
      OIDC_REQUIRED_TOKEN_USE: 'access',
      OIDC_ISSUER_URL: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_AbC123',
      OIDC_JWKS_URL:
        'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_AbC123/.well-known/jwks.json',
    };
    expect(loadApiEnv(cognito).OIDC_AUDIENCE_CLAIM).toBe('client_id');
    // Trailing slash would make every real token fail the exact `iss` match.
    expect(() =>
      loadApiEnv({ ...cognito, OIDC_ISSUER_URL: `${cognito.OIDC_ISSUER_URL}/` }),
    ).toThrow(/no trailing slash/);
  });

  it('requires https identity endpoints in deployed environments', () => {
    const deployedOidc = {
      ...base,
      ...deployed,
      ...oidc,
      APP_ENV: 'staging',
      OIDC_ISSUER_URL: 'http://idp.internal/',
      OIDC_JWKS_URL: 'http://idp.internal/jwks.json',
    };
    expect(() => loadApiEnv(deployedOidc)).toThrow(/must use https/);
  });

  it('requires the JWKS to be served by the issuer origin', () => {
    expect(() =>
      loadApiEnv({ ...base, ...oidc, OIDC_JWKS_URL: 'https://keys.attacker.example/jwks.json' }),
    ).toThrow(/same origin/);
  });

  it('requires complete OIDC settings in oidc mode', () => {
    expect(() => loadApiEnv({ ...base, AUTH_MODE: 'oidc' })).toThrow(/OIDC_ISSUER_URL/);
  });

  it('rejects symmetric / unknown JWT algorithms at config time', () => {
    expect(() => loadApiEnv({ ...base, ...oidc, OIDC_ALLOWED_ALGORITHMS: 'HS256' })).toThrow(
      ConfigError,
    );
  });

  it('requires internal HMAC and pseudonymisation secrets when deployed', () => {
    expect(() => loadApiEnv({ ...base, ...oidc, APP_ENV: 'staging' })).toThrow(
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
});
