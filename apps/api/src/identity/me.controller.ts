import { meResponseSchema, type MeResponse } from '@karen/api-contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { ApiStandardErrors, ApiZodResponse } from '../common/zod.js';
import { IdentityService } from './identity.service.js';

@ApiTags('identity')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  @ApiZodResponse(200, meResponseSchema)
  async getMe(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<MeResponse> {
    // Ownership: the user is ALWAYS derived from the verified token, never from input.
    const user = await this.identity.getUser(principal.userId);
    return meResponseSchema.parse({
      id: user.id,
      display_name: user.displayName,
      locale: user.locale,
      timezone: user.timezone,
      roles: principal.roles,
      permissions: principal.permissions,
      created_at: user.createdAt.toISOString(),
    });
  }
}
