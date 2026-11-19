import { adminSystemStatusSchema, type AdminSystemStatus } from '@karen/api-contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { ApiStandardErrors, ApiZodResponse } from '../common/zod.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { ExecutionPolicyService } from '../policy/execution-policy.service.js';

/**
 * Staff endpoints. Authorisation is enforced HERE (server-side permission guard + audit),
 * never by the admin UI's navigation.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly audit: AuditService,
    private readonly policy: ExecutionPolicyService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('system/status')
  @RequirePermissions('ops:read')
  @ApiZodResponse(200, adminSystemStatusSchema)
  async systemStatus(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<AdminSystemStatus> {
    await this.audit.record({
      actorType: 'STAFF',
      actorRef: principal.userId,
      action: 'admin.system_status.read',
      outcome: 'SUCCESS',
    });
    return {
      environment: this.env.APP_ENV,
      execution_paused: this.policy.executionPaused,
      // The API does not know the AI service's gateway mode without asking it; report honestly.
      ai_gateway_mode: 'unknown',
      generated_at: new Date().toISOString(),
    };
  }
}
