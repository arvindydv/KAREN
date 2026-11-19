import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { DevAuthController } from './dev-auth.controller.js';
import { AuthGuard, PermissionsGuard, TOKEN_VERIFIER } from './auth.guard.js';
import { LOCAL_DEV_AUDIENCE, LOCAL_DEV_ISSUER, LocalDevIssuer } from './local-dev-issuer.js';
import { TokenVerifier, remoteJwks } from './token-verifier.js';

export const LOCAL_DEV_ISSUER_TOKEN = Symbol.for('karen.localDevIssuer');

/**
 * Wires token verification. In `oidc` mode keys come from the IdP's JWKS endpoint (Cognito,
 * Auth0, Clerk… — provider-neutral). In `local-dev` mode (local/test only) an in-memory key
 * pair is generated and the dev token route is registered. Guard order: Auth → Permissions.
 */
@Module({})
export class AuthModule {
  static forRoot(env: ApiEnv): DynamicModule {
    const localDev = env.AUTH_MODE === 'local-dev';
    return {
      module: AuthModule,
      controllers: localDev ? [DevAuthController] : [],
      providers: [
        {
          provide: LOCAL_DEV_ISSUER_TOKEN,
          useFactory: async () => (localDev ? LocalDevIssuer.create() : null),
        },
        {
          provide: TOKEN_VERIFIER,
          inject: [API_ENV, LOCAL_DEV_ISSUER_TOKEN],
          useFactory: (e: ApiEnv, issuer: LocalDevIssuer | null) =>
            issuer
              ? new TokenVerifier({
                  issuer: LOCAL_DEV_ISSUER,
                  audience: LOCAL_DEV_AUDIENCE,
                  algorithms: ['ES256'],
                  keys: issuer.keySet,
                })
              : new TokenVerifier({
                  issuer: e.OIDC_ISSUER_URL ?? '',
                  audience: e.OIDC_AUDIENCE ?? '',
                  algorithms: e.OIDC_ALLOWED_ALGORITHMS,
                  keys: remoteJwks(e.OIDC_JWKS_URL ?? ''),
                }),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
      exports: [TOKEN_VERIFIER, LOCAL_DEV_ISSUER_TOKEN],
    };
  }
}
