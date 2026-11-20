import {
  type DataRightsList,
  type DataRightsRequest,
  dataRightsListSchema,
  dataRightsRequestSchema,
  deletionRequestSchema,
} from '@karen/api-contracts';
import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { AllowDeletionPending, CurrentPrincipal, Public } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { InternalAuthGuard } from '../common/internal-auth.guard.js';
import { SensitiveRateLimit } from '../common/rate-limit.js';
import { ApiStandardErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { DataRightsService } from './data-rights.service.js';

const uuid = () => new ParseUUIDPipe({ version: '4' });

/** The caller's data export and account deletion requests (Phase 01 M7). */
@ApiTags('data-rights')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'me/data-rights', version: '1' })
export class DataRightsController {
  constructor(private readonly rights: DataRightsService) {}

  @Get()
  @AllowDeletionPending()
  @ApiZodResponse(200, dataRightsListSchema)
  list(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<DataRightsList> {
    return this.rights.list(p.userId);
  }

  @Get(':id')
  @AllowDeletionPending()
  @ApiZodResponse(200, dataRightsRequestSchema)
  get(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', uuid()) id: string,
  ): Promise<DataRightsRequest> {
    return this.rights.get(p.userId, id);
  }

  @Post('export')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a copy of your data (idempotent while one is open)' })
  @ApiZodResponse(202, dataRightsRequestSchema)
  export(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<DataRightsRequest> {
    return this.rights.requestExport(p.userId);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download a ready export (JSON)' })
  async download(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', uuid()) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const { payload, sha256 } = await this.rights.download(p.userId, id);
    void reply
      .header('content-disposition', `attachment; filename="karen-export-${id}.json"`)
      .header('cache-control', 'no-store')
      .header('x-content-sha256', sha256);
    return payload;
  }

  @Post('deletion')
  @HttpCode(202)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Schedule account deletion (needs your current password)' })
  @ApiZodBody(deletionRequestSchema)
  @ApiZodResponse(202, dataRightsRequestSchema)
  deletion(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(deletionRequestSchema) body: z.infer<typeof deletionRequestSchema>,
  ): Promise<DataRightsRequest> {
    return this.rights.requestDeletion(p.userId, body.current_password);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @AllowDeletionPending()
  @ApiZodResponse(200, dataRightsRequestSchema)
  cancel(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', uuid()) id: string,
  ): Promise<DataRightsRequest> {
    return this.rights.cancel(p.userId, id);
  }
}

/**
 * Workflow steps, called ONLY by the Temporal worker with a signed request (InternalAuthGuard).
 * No user session: the request id is resolved to its owner by an exact-match DB lookup.
 * Excluded from the public OpenAPI document; blocked at the edge as well.
 */
@ApiExcludeController()
@Public()
@UseGuards(InternalAuthGuard)
@Controller({ path: 'internal/v1/data-rights', version: VERSION_NEUTRAL })
export class InternalDataRightsController {
  constructor(private readonly rights: DataRightsService) {}

  @Post(':id/export')
  @HttpCode(200)
  async buildExport(@Param('id', uuid()) id: string) {
    return this.rights.buildExport(id);
  }

  @Post(':id/expire-export')
  @HttpCode(200)
  async expireExport(@Param('id', uuid()) id: string) {
    return { outcome: await this.rights.expireExport(id) };
  }

  @Post(':id/erase')
  @HttpCode(200)
  async erase(@Param('id', uuid()) id: string) {
    return { outcome: await this.rights.executeErasure(id) };
  }
}
