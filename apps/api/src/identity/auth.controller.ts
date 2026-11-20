import {
  type AuthActionResult,
  type AuthChallengeResponse,
  authActionResultSchema,
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

/**
 * First-party authentication flows (ADR-0015, Phase 01 M2). All routes are public by nature,
 * all use the strict fail-closed limiter, and none ever returns whether an e-mail address has
 * an account. Sign-in/sessions arrive in M3.
 */
@ApiTags('auth')
@ApiStandardErrors()
@Public()
@SensitiveRateLimit()
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly flows: AuthFlowsService) {}

  @Post('register')
  @HttpCode(202)
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
  @ApiOperation({ summary: 'Set a new password with the e-mailed code (does not sign in)' })
  @ApiZodBody(resetPasswordRequestSchema)
  @ApiZodResponse(200, authActionResultSchema)
  reset(
    @ZodBody(resetPasswordRequestSchema) body: z.infer<typeof resetPasswordRequestSchema>,
  ): Promise<AuthActionResult> {
    return this.flows.resetPassword(body);
  }
}
