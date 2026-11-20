import {
  type AuthChallengeResponse,
  type EmailChanged,
  type PasswordChanged,
  type Place,
  type PlaceList,
  type Preferences,
  type Profile,
  authChallengeResponseSchema,
  emailChangeConfirmSchema,
  emailChangeRequestSchema,
  emailChangedSchema,
  passwordChangeRequestSchema,
  passwordChangedSchema,
  placeInputSchema,
  placeListSchema,
  placeSchema,
  preferencesPatchSchema,
  preferencesSchema,
  profilePatchSchema,
  profileSchema,
} from '@karen/api-contracts';
import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { SensitiveRateLimit } from '../common/rate-limit.js';
import { etag, requireIfMatch } from '../common/precondition.js';
import { ApiStandardErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { ProfileService } from './profile.service.js';

const IfMatch = () =>
  ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Quoted version you last read, e.g. "3"',
  });

/** The caller's profile, preferences, places and account security settings (Phase 01 M4). */
@ApiTags('profile')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'me', version: '1' })
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('profile')
  @ApiZodResponse(200, profileSchema)
  async getProfile(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Profile> {
    const profile = await this.profiles.getProfile(p.userId);
    void reply.header('ETag', etag(profile.version));
    return profile;
  }

  @Patch('profile')
  @IfMatch()
  @ApiZodBody(profilePatchSchema)
  @ApiZodResponse(200, profileSchema)
  async patchProfile(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(profilePatchSchema) body: z.infer<typeof profilePatchSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Profile> {
    const profile = await this.profiles.patchProfile(p.userId, requireIfMatch(ifMatch), body);
    void reply.header('ETag', etag(profile.version));
    return profile;
  }

  @Get('preferences')
  @ApiZodResponse(200, preferencesSchema)
  async getPreferences(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Preferences> {
    const prefs = await this.profiles.getPreferences(p.userId);
    void reply.header('ETag', etag(prefs.version));
    return prefs;
  }

  @Patch('preferences')
  @IfMatch()
  @ApiZodBody(preferencesPatchSchema)
  @ApiZodResponse(200, preferencesSchema)
  async patchPreferences(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(preferencesPatchSchema) body: z.infer<typeof preferencesPatchSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Preferences> {
    const prefs = await this.profiles.patchPreferences(p.userId, requireIfMatch(ifMatch), body);
    void reply.header('ETag', etag(prefs.version));
    return prefs;
  }

  @Get('places')
  @ApiZodResponse(200, placeListSchema)
  listPlaces(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<PlaceList> {
    return this.profiles.listPlaces(p.userId);
  }

  @Post('places')
  @HttpCode(201)
  @ApiZodBody(placeInputSchema)
  @ApiZodResponse(201, placeSchema)
  createPlace(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(placeInputSchema) body: z.infer<typeof placeInputSchema>,
  ): Promise<Place> {
    return this.profiles.createPlace(p.userId, body);
  }

  @Put('places/:id')
  @IfMatch()
  @ApiZodBody(placeInputSchema)
  @ApiZodResponse(200, placeSchema)
  updatePlace(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(placeInputSchema) body: z.infer<typeof placeInputSchema>,
  ): Promise<Place> {
    return this.profiles.updatePlace(p.userId, id, requireIfMatch(ifMatch), body);
  }

  @Delete('places/:id')
  @HttpCode(204)
  @IfMatch()
  async deletePlace(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<void> {
    await this.profiles.deletePlace(p.userId, id, requireIfMatch(ifMatch));
  }

  @Post('email-change')
  @HttpCode(202)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Start changing your e-mail (needs your current password)' })
  @ApiZodBody(emailChangeRequestSchema)
  @ApiZodResponse(202, authChallengeResponseSchema)
  startEmailChange(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(emailChangeRequestSchema) body: z.infer<typeof emailChangeRequestSchema>,
  ): Promise<AuthChallengeResponse> {
    return this.profiles.startEmailChange(p.userId, body.new_email, body.current_password);
  }

  @Post('email-change/confirm')
  @HttpCode(200)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Confirm the new e-mail with the code sent to it' })
  @ApiZodBody(emailChangeConfirmSchema)
  @ApiZodResponse(200, emailChangedSchema)
  confirmEmailChange(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(emailChangeConfirmSchema) body: z.infer<typeof emailChangeConfirmSchema>,
  ): Promise<EmailChanged> {
    return this.profiles.confirmEmailChange(
      p.userId,
      p.sessionId,
      body.challenge_handle,
      body.code,
    );
  }

  @Post('password')
  @HttpCode(200)
  @SensitiveRateLimit()
  @ApiOperation({ summary: 'Change your password (signs out your other sessions)' })
  @ApiZodBody(passwordChangeRequestSchema)
  @ApiZodResponse(200, passwordChangedSchema)
  changePassword(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(passwordChangeRequestSchema) body: z.infer<typeof passwordChangeRequestSchema>,
  ): Promise<PasswordChanged> {
    return this.profiles.changePassword(
      p.userId,
      p.sessionId,
      body.current_password,
      body.new_password,
    );
  }
}
