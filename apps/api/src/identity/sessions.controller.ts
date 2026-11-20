import {
  type DeviceList,
  type RevokeResult,
  type SessionList,
  deviceListSchema,
  revokeResultSchema,
  sessionListSchema,
} from '@karen/api-contracts';
import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowDeletionPending, CurrentPrincipal } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { ApiStandardErrors, ApiZodResponse } from '../common/zod.js';
import { SessionService } from './session.service.js';

/**
 * The caller's own sessions and devices (ADR-0016). The user is always the authenticated
 * principal; ids in paths are looked up within that user's scope, so another user's id is
 * indistinguishable from a non-existent one (404).
 */
@ApiTags('sessions')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ version: '1' })
export class SessionsController {
  constructor(private readonly sessions: SessionService) {}

  @Post('auth/logout')
  @HttpCode(200)
  @AllowDeletionPending()
  @ApiOperation({ summary: 'Sign out this session' })
  @ApiZodResponse(200, revokeResultSchema)
  async logout(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<RevokeResult> {
    return {
      revoked_sessions: await this.sessions.revoke(p.userId, { sessionId: p.sessionId }, 'logout'),
    };
  }

  @Post('auth/logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out every session, including this one' })
  @ApiZodResponse(200, revokeResultSchema)
  async logoutAll(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<RevokeResult> {
    return { revoked_sessions: await this.sessions.revoke(p.userId, {}, 'logout_all') };
  }

  @Get('me/sessions')
  @ApiOperation({ summary: 'List active sessions' })
  @ApiZodResponse(200, sessionListSchema)
  list(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<SessionList> {
    return this.sessions.list(p.userId, p.sessionId);
  }

  @Delete('me/sessions/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke one of your sessions' })
  @ApiZodResponse(200, revokeResultSchema)
  async revokeSession(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<RevokeResult> {
    return { revoked_sessions: await this.sessions.revokeOwned(p.userId, 'session', id) };
  }

  @Get('me/devices')
  @ApiOperation({ summary: 'List devices that signed in to your account' })
  @ApiZodResponse(200, deviceListSchema)
  devices(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<DeviceList> {
    return this.sessions.devices(p.userId, p.sessionId);
  }

  @Delete('me/devices/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out every session on one device' })
  @ApiZodResponse(200, revokeResultSchema)
  async revokeDevice(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<RevokeResult> {
    return { revoked_sessions: await this.sessions.revokeOwned(p.userId, 'device', id) };
  }
}
