import { defineConfig } from 'vitest/config';
import {
  NONSUPER_OWNER_DATABASE,
  nonsuperFixtureUrl,
  nonsuperRuntimeUrl,
} from './test/env.nonsuper-owner.js';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          globalSetup: ['test/global-setup.ts'],
          // Integration tests share one database; run files sequentially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // NEW-1 harness: the SAME integration suite against a database whose migration /
        // SECURITY DEFINER owner is a non-superuser, non-BYPASSRLS role (the AWS model).
        // See test/global-setup.nonsuper-owner.ts.
        extends: true,
        test: {
          name: 'integration-nonsuper-owner',
          include: ['test/**/*.int.test.ts'],
          globalSetup: ['test/global-setup.nonsuper-owner.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            KAREN_TEST_OWNER_MODEL: 'nonsuper',
            TEST_OWNER_DATABASE_URL: nonsuperFixtureUrl(),
            TEST_DATABASE_URL: nonsuperRuntimeUrl(),
            TEST_STAFF_DATABASE_URL: `postgresql://karen_staff_local:karen_staff_local_only@${process.env.TEST_DATABASE_HOST ?? 'localhost:5442'}/${NONSUPER_OWNER_DATABASE}`,
            // Separate Redis logical DB so rate-limit/nonce state never collides with the
            // normal integration run.
            TEST_REDIS_URL: process.env.TEST_REDIS_URL_NONSUPER ?? 'redis://localhost:6390/2',
          },
        },
      },
    ],
  },
});
