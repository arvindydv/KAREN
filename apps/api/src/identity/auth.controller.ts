import {
  type AuthActionResult,
  type AuthChallengeResponse,
  type LoginResponse,
  type RefreshResponse,
  authActionResultSchema,
  loginRequestSchema,
  loginResponseSchema,
  refreshRequestSchema,
  refreshResponseSchema,
  authChallengeResponseSchema,
  forgotPasswordRequestSchema,
  registerRequestSchema,
  resendChallengeRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from '@karen/api-contracts';
import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { SensitiveRateLimit } from '../common/rate-limit.js';
import { ApiStandardErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { AuthFlowsService } from './auth-flows.service.js';
import { LoginService } from './login.service.js';
import { SessionService } from './session.service.js';

/**
 * First-party authentication flows (ADR-0015/0016). Public by nature. Credential routes use the
 * strict fail-closed per-IP limiter; none reveals whether an e-mail address has an account.
 */
@ApiTags('auth')
@ApiStandardErrors()
@Public()
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly flows: AuthFlowsService,
    private readonly logins: LoginService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Sign in with e-mail and password' })
  @ApiZodBody(loginRequestSchema)
  @ApiZodResponse(200, loginResponseSchema)
  login(
    @ZodBody(loginRequestSchema) body: z.infer<typeof loginRequestSchema>,
  ): Promise<LoginResponse> {
    return this.logins.login(body);
  }

  /**
   * Mobile refresh. Not on the strict per-IP limiter: many legitimate devices share carrier
   * NAT addresses and refresh every few minutes; abuse is bounded by 256-bit tokens, single
   * use and reuse detection (default limiter still applies).
   */
  @Post('token/refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate a mobile refresh token for a new access token' })
  @ApiZodBody(refreshRequestSchema)
  @ApiZodResponse(200, refreshResponseSchema)
  refresh(
    @ZodBody(refreshRequestSchema) body: z.infer<typeof refreshRequestSchema>,
  ): Promise<RefreshResponse> {
    return this.sessions.refresh(body.refresh_token, body.installation_id);
  }

  @Post('register')
  @HttpCode(202)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Create an account and e-mail a verification code' })
  @ApiZodBody(registerRequestSchema)
  @ApiZodResponse(202, authChallengeResponseSchema, 'Code sent if the address can receive one')
  register(
    @ZodBody(registerRequestSchema) body: z.infer<typeof registerRequestSchema>,
  ): Promise<AuthChallengeResponse> {
    return this.flows.register(body);
  }

  @Post('verify-email')
  @HttpCode(200)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Confirm the e-mail address with the 6-digit code' })
  @ApiZodBody(verifyEmailRequestSchema)
  @ApiZodResponse(200, authActionResultSchema)
  verifyEmail(
    @ZodBody(verifyEmailRequestSchema) body: z.infer<typeof verifyEmailRequestSchema>,
  ): Promise<AuthActionResult> {
    return this.flows.verifyEmail(body.challenge_handle, body.code);
  }

  @Post('challenges/resend')
  @HttpCode(202)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Send a new code for an open verification or reset challenge' })
  @ApiZodBody(resendChallengeRequestSchema)
  @ApiZodResponse(202, authChallengeResponseSchema)
  resend(
    @ZodBody(resendChallengeRequestSchema) body: z.infer<typeof resendChallengeRequestSchema>,
  ): Promise<AuthChallengeResponse> {
    return this.flows.resend(body.challenge_handle);
  }

  @Post('password/forgot')
  @HttpCode(202)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'E-mail a password reset code (same response for every address)' })
  @ApiZodBody(forgotPasswordRequestSchema)
  @ApiZodResponse(202, authChallengeResponseSchema)
  forgot(
    @ZodBody(forgotPasswordRequestSchema) body: z.infer<typeof forgotPasswordRequestSchema>,
  ): Promise<AuthChallengeResponse> {
    return this.flows.forgotPassword(body.email);
  }

  @Post('password/reset')
  @HttpCode(200)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Set a new password with the e-mailed code (does not sign in)' })
  @ApiZodBody(resetPasswordRequestSchema)
  @ApiZodResponse(200, authActionResultSchema)
  reset(
    @ZodBody(resetPasswordRequestSchema) body: z.infer<typeof resetPasswordRequestSchema>,
  ): Promise<AuthActionResult> {
    return this.flows.resetPassword(body);
  }
}
