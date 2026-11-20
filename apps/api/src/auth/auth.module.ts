import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { ApiEnv } from '../config/env.js';
import { DevAuthController } from './dev-auth.controller.js';
import { AuthGuard, PermissionsGuard } from './auth.guard.js';

/**
 * Global guards (order: Auth → Permissions). Credentials are first-party sessions/access tokens
 * (ADR-0016); the access-token service lives in SecurityModule. The dev token route is
 * registered only in AUTH_MODE=local-dev (refused outside APP_ENV=local|test by config).
 */
@Module({})
export class AuthModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AuthModule,
      controllers: env.AUTH_MODE === 'local-dev' ? [DevAuthController] : [],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    };
  }
}
