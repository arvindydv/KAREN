import {
  type AdminSystemStatus,
  type CeremonyOptions,
  type Elevation,
  type StaffInvitation,
  type StaffMe,
  type StaffSessionResponse,
  type UserStatusLookup,
  adminSystemStatusSchema,
  ceremonyFinishSchema,
  ceremonyOptionsSchema,
  elevationDecisionSchema,
  elevationRequestSchema,
  elevationSchema,
  enrollmentFinishSchema,
  enrollmentStartSchema,
  staffInvitationRequestSchema,
  staffInvitationSchema,
  staffLoginStartSchema,
  staffMeSchema,
  staffRoleSchema,
  staffSessionSchema,
  userStatusLookupSchema,
} from '@karen/api-contracts';
import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Public } from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { SensitiveRateLimit } from '../common/rate-limit.js';
import { ApiStandardErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { ExecutionPolicyService } from '../policy/execution-policy.service.js';
import { StaffAdminService } from './staff-admin.service.js';
import { StaffAuthService, type StaffPrincipal } from './staff-auth.service.js';
import {
  CurrentStaff,
  NoStaffSession,
  RequireStaffPermissions,
  RequireStepUp,
  StaffAuthGuard,
} from './staff.guard.js';

const uuid = () => new ParseUUIDPipe({ version: '4' });
const disableSchema = z.object({ reason: z.string().trim().min(10).max(300) }).strict();

/**
 * Staff sign-in, enrollment and step-up (ADR-0017). `@Public()` only opts out of the CONSUMER
 * guard; every route here is behind StaffAuthGuard (sign-in steps marked @NoStaffSession).
 */
@ApiTags('staff')
@ApiStandardErrors()
@Public()
@UseGuards(StaffAuthGuard)
@Controller({ path: 'staff/auth', version: '1' })
export class StaffAuthController {
  constructor(private readonly auth: StaffAuthService) {}

  @Post('login/options')
  @HttpCode(200)
  @NoStaffSession()
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Staff sign-in step 1: password → security-key challenge' })
  @ApiZodBody(staffLoginStartSchema)
  @ApiZodResponse(200, ceremonyOptionsSchema)
  loginOptions(
    @ZodBody(staffLoginStartSchema) body: z.infer<typeof staffLoginStartSchema>,
  ): Promise<CeremonyOptions> {
    return this.auth.loginStart(body.email, body.password);
  }

  @Post('login/verify')
  @HttpCode(200)
  @NoStaffSession()
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Staff sign-in step 2: security-key assertion → staff session' })
  @ApiZodBody(ceremonyFinishSchema)
  @ApiZodResponse(200, staffSessionSchema)
  loginVerify(
    @ZodBody(ceremonyFinishSchema) body: z.infer<typeof ceremonyFinishSchema>,
  ): Promise<StaffSessionResponse> {
    return this.auth.loginFinish(body.ceremony_handle, body.credential);
  }

  @Post('enroll/options')
  @HttpCode(200)
  @NoStaffSession()
  @SensitiveRateLimit()
  @ApiZodBody(enrollmentStartSchema)
  @ApiZodResponse(200, ceremonyOptionsSchema)
  enrollOptions(
    @ZodBody(enrollmentStartSchema) body: z.infer<typeof enrollmentStartSchema>,
  ): Promise<CeremonyOptions> {
    return this.auth.enrollmentOptions(body.enrollment_token);
  }

  @Post('enroll/verify')
  @HttpCode(204)
  @NoStaffSession()
  @SensitiveRateLimit()
  @ApiZodBody(enrollmentFinishSchema)
  async enrollVerify(
    @ZodBody(enrollmentFinishSchema) body: z.infer<typeof enrollmentFinishSchema>,
  ): Promise<void> {
    await this.auth.enrollmentFinish(
      body.ceremony_handle,
      body.credential,
      body.name,
      body.password,
    );
  }

  @Post('step-up/options')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiZodResponse(200, ceremonyOptionsSchema)
  stepUpOptions(@CurrentStaff() staff: StaffPrincipal): Promise<CeremonyOptions> {
    return this.auth.stepUpStart(staff);
  }

  @Post('step-up/verify')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiZodBody(ceremonyFinishSchema)
  @ApiZodResponse(200, staffMeSchema)
  stepUpVerify(
    @CurrentStaff() staff: StaffPrincipal,
    @ZodBody(ceremonyFinishSchema) body: z.infer<typeof ceremonyFinishSchema>,
  ): Promise<StaffMe> {
    return this.auth.stepUpFinish(staff, body.ceremony_handle, body.credential);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  async logout(@CurrentStaff() staff: StaffPrincipal): Promise<void> {
    await this.auth.logout(staff);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiZodResponse(200, staffMeSchema)
  me(@CurrentStaff() staff: StaffPrincipal): StaffMe {
    return this.auth.toMe(staff);
  }
}

/** Staff administration and support tools. Every action is audited with the staff actor. */
@ApiTags('staff')
@ApiBearerAuth()
@ApiStandardErrors()
@Public()
@UseGuards(StaffAuthGuard)
@Controller({ path: 'staff', version: '1' })
export class StaffAdminController {
  constructor(private readonly admin: StaffAdminService) {}

  @Post('invitations')
  @HttpCode(201)
  @RequireStaffPermissions('staff:manage')
  @RequireStepUp()
  @ApiZodBody(staffInvitationRequestSchema)
  @ApiZodResponse(201, staffInvitationSchema)
  invite(
    @CurrentStaff() staff: StaffPrincipal,
    @ZodBody(staffInvitationRequestSchema) body: z.infer<typeof staffInvitationRequestSchema>,
  ): Promise<StaffInvitation> {
    return this.admin.invite(staff, body.email, body.display_name, body.roles);
  }

  @Put('accounts/:id/roles/:role')
  @HttpCode(204)
  @RequireStaffPermissions('staff:manage')
  @RequireStepUp()
  async grant(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', uuid()) id: string,
    @Param('role') role: string,
  ) {
    await this.admin.grantRole(staff, id, this.role(role));
  }

  @Delete('accounts/:id/roles/:role')
  @HttpCode(204)
  @RequireStaffPermissions('staff:manage')
  @RequireStepUp()
  async revoke(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', uuid()) id: string,
    @Param('role') role: string,
  ) {
    await this.admin.revokeRole(staff, id, this.role(role));
  }

  @Post('accounts/:id/disable')
  @HttpCode(204)
  @RequireStaffPermissions('staff:manage')
  @RequireStepUp()
  async disable(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', uuid()) id: string,
    @ZodBody(disableSchema) body: z.infer<typeof disableSchema>,
  ) {
    await this.admin.disable(staff, id, body.reason);
  }

  /** Any staff member may REQUEST elevation; only another security admin can approve it. */
  @Post('elevations')
  @HttpCode(201)
  @RequireStepUp()
  @ApiZodBody(elevationRequestSchema)
  @ApiZodResponse(201, elevationSchema)
  requestElevation(
    @CurrentStaff() staff: StaffPrincipal,
    @ZodBody(elevationRequestSchema) body: z.infer<typeof elevationRequestSchema>,
  ): Promise<Elevation> {
    return this.admin.requestElevation(
      staff,
      body.role,
      body.reason,
      body.ticket_ref,
      body.duration_minutes,
    );
  }

  @Get('elevations')
  @RequireStaffPermissions('staff:manage')
  @ApiZodResponse(200, z.object({ items: z.array(elevationSchema) }))
  async elevations(): Promise<{ items: Elevation[] }> {
    return { items: await this.admin.listElevations() };
  }

  @Post('elevations/:id/decision')
  @HttpCode(200)
  @RequireStaffPermissions('staff:manage')
  @RequireStepUp()
  @ApiZodBody(elevationDecisionSchema)
  @ApiZodResponse(200, elevationSchema)
  decide(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', uuid()) id: string,
    @ZodBody(elevationDecisionSchema) body: z.infer<typeof elevationDecisionSchema>,
  ): Promise<Elevation> {
    return this.admin.decideElevation(staff, id, body.decision === 'approve');
  }

  @Get('users/:id/status')
  @RequireStaffPermissions('users:read_status')
  @ApiOperation({ summary: 'Account status only; requires X-Access-Reason; audited' })
  @ApiZodResponse(200, userStatusLookupSchema)
  userStatus(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', uuid()) id: string,
    @Headers('x-access-reason') reason: string | undefined,
  ): Promise<UserStatusLookup> {
    return this.admin.userStatus(staff, id, reason);
  }

  private role(value: string) {
    const parsed = staffRoleSchema.safeParse(value);
    if (!parsed.success) throw new ApiError('NOT_FOUND', 'Unknown role.');
    return parsed.data;
  }
}

/**
 * Admin console system status — now in the STAFF realm (was gated by consumer tokens + legacy
 * identity.staff_role_grants). Same path, so the admin app contract is unchanged.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiStandardErrors()
@Public()
@UseGuards(StaffAuthGuard)
@Controller({ path: 'admin', version: '1' })
export class AdminSystemController {
  constructor(
    private readonly audit: AuditService,
    private readonly policy: ExecutionPolicyService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('system/status')
  @RequireStaffPermissions('ops:read')
  @ApiZodResponse(200, adminSystemStatusSchema)
  async systemStatus(@CurrentStaff() staff: StaffPrincipal): Promise<AdminSystemStatus> {
    await this.audit.record({
      actorType: 'STAFF',
      actorRef: staff.staffId,
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
