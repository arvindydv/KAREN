import {
  type OnboardingState,
  onboardingStateSchema,
  onboardingStepSchema,
} from '@karen/api-contracts';
import { Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { ApiStandardErrors, ApiZodResponse } from '../common/zod.js';
import { OnboardingService } from './onboarding.service.js';

/** First-run progress (Phase 01 M5). All transitions are idempotent. */
@ApiTags('onboarding')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'me/onboarding', version: '1' })
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @ApiZodResponse(200, onboardingStateSchema)
  get(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<OnboardingState> {
    return this.onboarding.get(p.userId);
  }

  @Put('steps/:step')
  @ApiOperation({ summary: 'Mark a step complete (idempotent)' })
  @ApiZodResponse(200, onboardingStateSchema)
  completeStep(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('step') step: string,
  ): Promise<OnboardingState> {
    const parsed = onboardingStepSchema.safeParse(step);
    if (!parsed.success) throw new ApiError('NOT_FOUND', 'Unknown onboarding step.');
    return this.onboarding.completeStep(p.userId, parsed.data);
  }

  @Post('skip')
  @HttpCode(200)
  @ApiZodResponse(200, onboardingStateSchema)
  skip(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<OnboardingState> {
    return this.onboarding.skip(p.userId);
  }

  @Post('resume')
  @HttpCode(200)
  @ApiZodResponse(200, onboardingStateSchema)
  resume(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<OnboardingState> {
    return this.onboarding.resume(p.userId);
  }

  @Post('complete')
  @HttpCode(200)
  @ApiZodResponse(200, onboardingStateSchema)
  complete(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<OnboardingState> {
    return this.onboarding.complete(p.userId);
  }
}
