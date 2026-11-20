import {
  type ConsentDecisionResult,
  type ConsentHistory,
  type ConsentStateList,
  type LegalStatus,
  type Notice,
  type NoticeList,
  type PurposeCatalog,
  type ReceiptVerification,
  consentDecisionRequestSchema,
  consentDecisionResultSchema,
  consentHistorySchema,
  consentPurposeSchema,
  consentStateListSchema,
  legalAcceptanceRequestSchema,
  legalStatusSchema,
  noticeKindSchema,
  noticeListSchema,
  noticeLocaleSchema,
  noticeSchema,
  purposeCatalogSchema,
  receiptVerificationSchema,
} from '@karen/api-contracts';
import { Controller, Get, Headers, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { CurrentPrincipal, Public } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { ApiError } from '../common/api-error.js';
import { requireIfMatch } from '../common/precondition.js';
import { ApiStandardErrors, ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod.js';
import { ConsentService } from './consent.service.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** Public notices and purpose catalog (Phase 01 M6). Drafts only in local/test. */
@ApiTags('consent')
@ApiStandardErrors()
@Public()
@Controller({ path: 'consent', version: '1' })
export class NoticesController {
  constructor(private readonly consent: ConsentService) {}

  @Get('notices')
  @ApiZodResponse(200, noticeListSchema)
  list(): Promise<NoticeList> {
    return this.consent.listNotices();
  }

  @Get('notices/:kind/:version')
  @ApiZodResponse(200, noticeSchema)
  get(
    @Param('kind') kind: string,
    @Param('version') version: string,
    @Query('locale') locale: string | undefined,
  ): Promise<Notice> {
    const k = noticeKindSchema.safeParse(kind);
    const l = noticeLocaleSchema.safeParse(locale ?? 'en-IN');
    if (!k.success || !l.success || version.length > 32)
      throw new ApiError('NOT_FOUND', 'Notice not found.');
    return this.consent.getNotice(k.data, version, l.data);
  }

  @Get('purposes')
  @ApiZodResponse(200, purposeCatalogSchema)
  purposes(): PurposeCatalog {
    return this.consent.catalog();
  }
}

/** The caller's consents, receipts and legal acknowledgements (Phase 01 M6). */
@ApiTags('consent')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'me', version: '1' })
export class MyConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get('consents')
  @ApiZodResponse(200, consentStateListSchema)
  states(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<ConsentStateList> {
    return this.consent.currentStates(p.userId);
  }

  @Put('consents/:purpose')
  @ApiOperation({ summary: 'Grant, deny or revoke one purpose (If-Match = its version)' })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiZodBody(consentDecisionRequestSchema)
  @ApiZodResponse(200, consentDecisionResultSchema)
  decide(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('purpose') purpose: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @ZodBody(consentDecisionRequestSchema) body: z.infer<typeof consentDecisionRequestSchema>,
  ): Promise<ConsentDecisionResult> {
    const parsed = consentPurposeSchema.safeParse(purpose);
    if (!parsed.success) throw new ApiError('NOT_FOUND', 'Unknown consent purpose.');
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new ApiError('VALIDATION_FAILED', 'Idempotency-Key must be 8–128 URL-safe characters.');
    }
    return this.consent.decide(
      p.userId,
      parsed.data,
      requireIfMatch(ifMatch),
      body,
      idempotencyKey,
    );
  }

  @Get('consents/history')
  @ApiZodResponse(200, consentHistorySchema)
  history(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Query('cursor') cursor: string | undefined,
  ): Promise<ConsentHistory> {
    const c = cursor === undefined ? undefined : Number(cursor);
    if (c !== undefined && (!Number.isInteger(c) || c < 1)) {
      throw new ApiError('VALIDATION_FAILED', 'Invalid cursor.');
    }
    return this.consent.history(p.userId, c);
  }

  @Get('consents/receipts/verify')
  @ApiOperation({ summary: 'Recompute your receipt chain (hashes, links and MACs)' })
  @ApiZodResponse(200, receiptVerificationSchema)
  verify(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<ReceiptVerification> {
    return this.consent.verifyReceipts(p.userId);
  }

  @Get('legal')
  @ApiZodResponse(200, legalStatusSchema)
  legal(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<LegalStatus> {
    return this.consent.legalStatus(p.userId);
  }

  @Post('legal/acceptances')
  @HttpCode(200)
  @ApiZodBody(legalAcceptanceRequestSchema)
  @ApiZodResponse(200, legalStatusSchema)
  accept(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(legalAcceptanceRequestSchema) body: z.infer<typeof legalAcceptanceRequestSchema>,
  ): Promise<LegalStatus> {
    return this.consent.acceptLegal(p.userId, body.kind, body.version, body.locale);
  }
}
