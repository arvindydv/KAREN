import { Body, Controller, HttpCode, Inject, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from './decorators.js';
import { LOCAL_DEV_ISSUER, LocalDevIssuer } from './local-dev-issuer.js';
import { IdentityService } from '../identity/identity.service.js';
import { ApiError } from '../common/api-error.js';
import { SensitiveRateLimit } from '../common/rate-limit.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';

const LOCAL_DEV_ISSUER_TOKEN_KEY = Symbol.for('karen.localDevIssuer');
const requestSchema = z.object({ subject: z.string().regex(/^dev\|[a-z0-9-]{3,64}$/) }).strict();

/**
 * LOCAL/TEST ONLY. Registered exclusively when AUTH_MODE=local-dev, which config validation
 * forbids outside APP_ENV=local|test. Excluded from the OpenAPI document. Subjects are
 * restricted to the `dev|...` namespace so dev identities can never collide with real ones.
 */
@ApiExcludeController()
@Controller({ path: 'dev/auth', version: VERSION_NEUTRAL })
export class DevAuthController {
  constructor(
    @Inject(LOCAL_DEV_ISSUER_TOKEN_KEY) private readonly issuer: LocalDevIssuer | null,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly identity: IdentityService,
  ) {}

  @Public()
  @SensitiveRateLimit()
  @Post('token')
  @HttpCode(200)
  async issue(
    @Body() body: unknown,
  ): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    // Defence in depth: re-check the environment even though the route is not registered elsewhere.
    if (!this.issuer || (this.env.APP_ENV !== 'local' && this.env.APP_ENV !== 'test')) {
      throw new ApiError('NOT_FOUND', 'Not found.');
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'subject must match dev|<slug>.');
    // Explicit provisioning (local/test only). The auth guard itself never creates accounts.
    await this.identity.provisionLocalDevIdentity(LOCAL_DEV_ISSUER, parsed.data.subject);
    const expiresIn = 3600;
    return {
      access_token: await this.issuer.issue(parsed.data.subject, expiresIn),
      token_type: 'Bearer',
      expires_in: expiresIn,
    };
  }
}
