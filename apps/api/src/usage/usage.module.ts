import { Module } from '@nestjs/common';
import { UsageLimitsService } from './usage-limits.service.js';

/**
 * Per-user AI usage accounting (ADR-0023), moved out of `conversation` in Phase 03 M5a (M-09) so
 * that both `conversation` and `memory` can use it without a module cycle. Imports neither.
 */
@Module({
  providers: [UsageLimitsService],
  exports: [UsageLimitsService],
})
export class UsageModule {}
