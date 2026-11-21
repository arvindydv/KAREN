import { describe, expect, it } from 'vitest';
import { getServerEnv, publicEnv } from './env';

describe('public env', () => {
  it('contains only NEXT_PUBLIC_ values and no API address (the browser talks only to the BFF)', () => {
    expect(Object.keys(publicEnv).every((k) => k.startsWith('NEXT_PUBLIC_'))).toBe(true);
    expect(Object.keys(publicEnv)).not.toContain('NEXT_PUBLIC_API_BASE_URL');
  });
});

describe('server env', () => {
  it('defaults the internal API URL to local', () => {
    const env = getServerEnv({});
    expect(env.API_INTERNAL_BASE_URL).toBe('http://localhost:4100');
    expect(env.APP_ENV).toBe('local');
  });

  it('refuses a deployed artifact without an explicit APP_ENV', () => {
    expect(() => getServerEnv({ KAREN_DEPLOYED_ARTIFACT: 'true' })).toThrow(/APP_ENV/);
  });
});

describe('server env: client-IP signing secret', () => {
  it('is required outside local/test so users never share one rate-limit bucket', () => {
    expect(() =>
      getServerEnv({ APP_ENV: 'production', WEB_PUBLIC_ORIGIN: 'https://app.karen.test' }),
    ).toThrow(/INTERNAL_SERVICE_HMAC_SECRET/);
    expect(getServerEnv({ APP_ENV: 'local' }).INTERNAL_SERVICE_HMAC_SECRET).toBeUndefined();
  });
});
