import { Global, Module } from '@nestjs/common';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { ConcurrencyGate } from './concurrency-gate.js';
import { PasswordHasher, parsePepperKeys } from './password/password-hasher.js';

/**
 * Security primitives shared by identity features (ADR-0015). One PasswordHasher per process,
 * so the concurrency gate bounds ALL password hashing in this process.
 */
@Global()
@Module({
  providers: [
    {
      provide: PasswordHasher,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        new PasswordHasher({
          peppers: parsePepperKeys(env.PASSWORD_PEPPERS),
          currentPepperId: env.PASSWORD_PEPPER_CURRENT_ID ?? null,
          gate: new ConcurrencyGate({
            maxConcurrent: env.PASSWORD_HASH_MAX_CONCURRENCY,
            maxQueue: env.PASSWORD_HASH_MAX_QUEUE,
            queueTimeoutMs: env.PASSWORD_HASH_QUEUE_TIMEOUT_MS,
          }),
        }),
    },
  ],
  exports: [PasswordHasher],
})
export class SecurityModule {}
