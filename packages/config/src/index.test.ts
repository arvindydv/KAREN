import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  baseServiceEnv,
  booleanFlag,
  databaseEnv,
  findSecretLookingPublicEnvNames,
  loadEnv,
  observabilityEnv,
  port,
  requiredWhenDeployed,
} from './index.js';

const shape = {
  ...baseServiceEnv,
  ...databaseEnv,
  ...observabilityEnv,
  PORT: port(4100),
  FLAG: booleanFlag(false),
};

describe('loadEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = loadEnv(shape, { source: { DATABASE_URL: 'postgresql://u:p@localhost:5442/db' } });
    expect(env).toMatchObject({ APP_ENV: 'local', PORT: 4100, FLAG: false, DATABASE_POOL_MAX: 10 });
  });

  it('fails fast with a readable report that never echoes values', () => {
    const secretish = 'mysql://root:supersecret@db/x';
    let error: unknown;
    try {
      loadEnv(shape, { source: { DATABASE_URL: secretish, PORT: '99999', FLAG: 'yes' } });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const msg = (error as ConfigError).message;
    expect(msg).toContain('DATABASE_URL');
    expect(msg).toContain('PORT');
    expect(msg).toContain('FLAG');
    expect(msg).not.toContain('supersecret');
  });

  it('enforces per-environment rules', () => {
    const source = { DATABASE_URL: 'postgres://x', APP_ENV: 'production' };
    expect(() =>
      loadEnv(shape, { source, rules: [requiredWhenDeployed('LOG_PSEUDONYMIZATION_KEY')] }),
    ).toThrow(/LOG_PSEUDONYMIZATION_KEY: required when APP_ENV=production/);
    expect(() =>
      loadEnv(shape, {
        source: { ...source, APP_ENV: 'local' },
        rules: [requiredWhenDeployed('LOG_PSEUDONYMIZATION_KEY')],
      }),
    ).not.toThrow();
  });

  it('refuses the implicit APP_ENV=local default inside container images', () => {
    const source = { DATABASE_URL: 'postgres://x', KAREN_DEPLOYED_ARTIFACT: 'true' };
    expect(() => loadEnv(shape, { source })).toThrow(/APP_ENV: must be set explicitly/);
    expect(loadEnv(shape, { source: { ...source, APP_ENV: 'staging' } }).APP_ENV).toBe('staging');
  });

  it('rejects unknown APP_ENV values', () => {
    expect(() =>
      loadEnv(shape, { source: { DATABASE_URL: 'postgres://x', APP_ENV: 'prod' } }),
    ).toThrow(ConfigError);
  });
});

describe('redis url resolution', () => {
  it('prefers REDIS_URL and composes TLS URLs from ECS-style parts', async () => {
    const { resolveRedisUrl } = await import('./index.js');
    expect(
      resolveRedisUrl({
        REDIS_URL: 'redis://localhost:6390/0',
        REDIS_PORT: 6379,
        REDIS_TLS: 'false',
      }),
    ).toBe('redis://localhost:6390/0');
    expect(
      resolveRedisUrl({
        REDIS_HOST: 'cache.internal',
        REDIS_PORT: 6379,
        REDIS_TLS: 'true',
        REDIS_AUTH_TOKEN: 'a/b',
      }),
    ).toBe('rediss://:a%2Fb@cache.internal:6379');
    expect(() => resolveRedisUrl({ REDIS_PORT: 6379, REDIS_TLS: 'false' })).toThrow(ConfigError);
  });
});

describe('public env guard', () => {
  it('flags secret-looking public variables', () => {
    expect(
      findSecretLookingPublicEnvNames([
        'NEXT_PUBLIC_API_BASE_URL',
        'NEXT_PUBLIC_AI_GATEWAY_API_KEY',
        'EXPO_PUBLIC_SECRET',
        'AI_GATEWAY_API_KEY',
      ]),
    ).toEqual(['NEXT_PUBLIC_AI_GATEWAY_API_KEY', 'EXPO_PUBLIC_SECRET']);
  });
});
