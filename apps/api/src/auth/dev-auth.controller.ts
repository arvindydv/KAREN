import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from './decorators.js';
import { ApiError } from '../common/api-error.js';
import { SensitiveRateLimit } from '../common/rate-limit.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { IdentityService, LOCAL_DEV_ISSUER } from '../identity/identity.service.js';
import { SessionService } from '../identity/session.service.js';

const requestSchema = z.object({ subject: z.string().regex(/^dev\|[a-z0-9-]{3,64}$/) }).strict();

/**
 * LOCAL/TEST ONLY. Registered exclusively when AUTH_MODE=local-dev, which config validation
 * forbids outside APP_ENV=local|test. Excluded from the OpenAPI document. Subjects are
 * restricted to the `dev|...` namespace. It explicitly provisions an ACTIVE account and creates
 * a REAL first-party session, so tokens go through exactly the production verification path.
 */
@ApiExcludeController()
@Controller({ path: 'dev/auth', version: VERSION_NEUTRAL })
export class DevAuthController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @SensitiveRateLimit()
  @Post('token')
  @HttpCode(200)
  async issue(
    @Body() body: unknown,
  ): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number }> {
    // Defence in depth: re-check the environment even though the route is not registered elsewhere.
    if (
      this.env.AUTH_MODE !== 'local-dev' ||
      (this.env.APP_ENV !== 'local' && this.env.APP_ENV !== 'test')
    ) {
      throw new ApiError('NOT_FOUND', 'Not found.');
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'subject must match dev|<slug>.');
    const link = await this.identity.provisionLocalDevIdentity(
      LOCAL_DEV_ISSUER,
      parsed.data.subject,
    );
    const { response } = await this.sessions.create(
      link.userId,
      'android',
      { installationId: randomUUID(), name: 'local-dev' },
      'local_dev',
    );
    if (!response.access_token || !response.access_token_expires_at) {
      throw new Error('dev token: mobile session did not return an access token');
    }
    const expiresIn = Math.round(
      (Date.parse(response.access_token_expires_at) - Date.now()) / 1000,
    );
    return { access_token: response.access_token, token_type: 'Bearer', expires_in: expiresIn };
  }
}
