import { loadApiEnv, type ApiEnv } from '../src/config/env.js';

/** Owner/migration role: applies migrations and seeds fixtures directly (bypasses RLS). */
export const TEST_OWNER_DATABASE_URL =
  process.env.TEST_OWNER_DATABASE_URL ??
  'postgresql://karen:karen_local_only@localhost:5442/karen_test';
/** Least-privilege runtime role (infra/database/roles.sql) — what the API itself uses. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://karen_api_local:karen_api_local_only@localhost:5442/karen_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6390/1';

export const testEnv = (overrides: Record<string, string> = {}): ApiEnv =>
  loadApiEnv({
    APP_ENV: 'test',
    LOG_LEVEL: 'fatal',
    AUTH_MODE: 'local-dev',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    AI_SERVICE_URL: 'http://127.0.0.1:9',
    API_RATE_LIMIT_PER_MINUTE: '1000',
    API_SENSITIVE_RATE_LIMIT_PER_MINUTE: '1000',
    API_BODY_LIMIT_BYTES: '4096',
    ALLOW_DRAFT_NOTICES: 'true',
    DATA_RIGHTS_DISPATCH: 'manual',
    INTERNAL_SERVICE_HMAC_SECRET: 'test-only-internal-hmac-secret-0123456789',
    ...overrides,
  });
