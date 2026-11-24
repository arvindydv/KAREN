import {
  clearMemoryRequestSchema,
  clearMemoryResponseSchema,
  confirmSuggestionRequestSchema,
  createMemoryRequestSchema,
  memoryActivityQuerySchema,
  memoryActivitySchema,
  memoryExportSchema,
  memoryItemListSchema,
  memoryItemSchema,
  memoryListQuerySchema,
  memorySettingsSchema,
  memoryStatusResponseSchema,
  memorySuggestionListQuerySchema,
  memorySuggestionListSchema,
  restoreMemoryRequestSchema,
  restoreMemoryResponseSchema,
  undoMemoryResponseSchema,
  updateMemoryRequestSchema,
  updateMemorySettingsRequestSchema,
  type ClearMemoryResponse,
  type MemoryActivity,
  type MemoryExport,
  type MemoryItem,
  type MemoryItemList,
  type MemorySettings,
  type MemoryStatusResponse,
  type MemorySuggestionList,
  type RestoreMemoryResponse,
  type UndoMemoryResponse,
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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { AllowDeletionPending, CurrentPrincipal } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { etag, requireIfMatch } from '../common/precondition.js';
import {
  ApiStandardErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  ZodBody,
  ZodQuery,
} from '../common/zod.js';
import { requireIdempotencyKeyHeader } from '../infrastructure/database/idempotency.js';
import { MemoryDeletionService } from './memory-deletion.service.js';
import { MemoryExportService } from './memory-export.service.js';
import { MemoryRateLimiter } from './memory-rate-limit.js';
import { MemoryService } from './memory.service.js';

const Uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Personal memory (Phase 03, ADR-0036; arch §3.7). The user is always the verified principal.
 * Viewing, exporting, deleting and clearing need no consent and keep working with the feature
 * off and during the account-deletion window. Content writes need the feature on (else 404) and
 * an eligible MEMORY_STORAGE consent (checked inside the write transaction, not by a guard, so it
 * serialises with a concurrent revoke).
 */
@ApiTags('memory')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'memory', version: '1' })
export class MemoryController {
  constructor(
    private readonly memory: MemoryService,
    private readonly deletion: MemoryDeletionService,
    private readonly exporter: MemoryExportService,
    private readonly limiter: MemoryRateLimiter,
  ) {}

  @Get()
  @AllowDeletionPending()
  @ApiOperation({ summary: 'List or search your memories' })
  @ApiZodQuery('cursor', memoryListQuerySchema.shape.cursor)
  @ApiZodQuery('limit', memoryListQuerySchema.shape.limit)
  @ApiZodQuery('kind', memoryListQuerySchema.shape.kind)
  @ApiZodQuery('status', memoryListQuerySchema.shape.status)
  @ApiZodQuery('pinned', memoryListQuerySchema.shape.pinned)
  @ApiZodQuery('q', memoryListQuerySchema.shape.q)
  @ApiZodQuery('conversation_id', memoryListQuerySchema.shape.conversation_id)
  @ApiZodResponse(200, memoryItemListSchema)
  list(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodQuery(memoryListQuerySchema) q: z.infer<typeof memoryListQuerySchema>,
  ): Promise<MemoryItemList> {
    return this.memory.list(p.userId, q);
  }

  @Post()
  @ApiOperation({ summary: 'Add a memory yourself (needs memory permission)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiZodBody(createMemoryRequestSchema)
  @ApiZodResponse(201, memoryItemSchema)
  async create(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(createMemoryRequestSchema) body: z.infer<typeof createMemoryRequestSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MemoryItem> {
    const { item, created } = await this.memory.create(
      p.userId,
      body,
      requireIdempotencyKeyHeader(key),
    );
    void reply.status(created ? 201 : 200).header('ETag', etag(item.version));
    return item;
  }

  @Get('status')
  @AllowDeletionPending()
  @ApiZodResponse(200, memoryStatusResponseSchema)
  status(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<MemoryStatusResponse> {
    return this.memory.status(p.userId);
  }

  @Get('export')
  @AllowDeletionPending()
  @ApiOperation({ summary: 'Download your memories (machine-readable)' })
  @ApiZodResponse(200, memoryExportSchema)
  async export(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<MemoryExport> {
    await this.limiter.hit(p.userId, 'export');
    return this.exporter.build(p.userId);
  }

  @Get('activity')
  @ApiOperation({ summary: 'What was saved from a conversation (ids and outcome codes only)' })
  @ApiZodQuery('conversation_id', memoryActivityQuerySchema.shape.conversation_id)
  @ApiZodQuery('since', memoryActivityQuerySchema.shape.since)
  @ApiZodResponse(200, memoryActivitySchema)
  activity(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodQuery(memoryActivityQuerySchema) q: z.infer<typeof memoryActivityQuerySchema>,
  ): Promise<MemoryActivity> {
    return this.memory.activity(p.userId, q.conversation_id, q.since);
  }

  @Get('settings')
  @AllowDeletionPending()
  @ApiZodResponse(200, memorySettingsSchema)
  async settings(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MemorySettings> {
    const s = await this.memory.settings(p.userId);
    void reply.header('ETag', etag(s.version));
    return s;
  }

  @Patch('settings')
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiZodBody(updateMemorySettingsRequestSchema)
  @ApiZodResponse(200, memorySettingsSchema)
  async updateSettings(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateMemorySettingsRequestSchema)
    body: z.infer<typeof updateMemorySettingsRequestSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MemorySettings> {
    const s = await this.memory.updateSettings(
      p.userId,
      requireIfMatch(ifMatch),
      body.ask_before_saving,
    );
    void reply.header('ETag', etag(s.version));
    return s;
  }

  @Post('clear')
  @HttpCode(200)
  @AllowDeletionPending()
  @ApiOperation({ summary: 'Delete all memories, one kind, or those from one conversation' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiZodBody(clearMemoryRequestSchema)
  @ApiZodResponse(200, clearMemoryResponseSchema)
  async clear(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(clearMemoryRequestSchema) body: z.infer<typeof clearMemoryRequestSchema>,
  ): Promise<ClearMemoryResponse> {
    const k = requireIdempotencyKeyHeader(key);
    await this.limiter.hit(p.userId, 'clear');
    return this.deletion.clear(p.userId, body, k);
  }

  @Post('restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore memories suspended when memory permission was turned off' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiZodBody(restoreMemoryRequestSchema)
  @ApiZodResponse(200, restoreMemoryResponseSchema)
  async restore(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(restoreMemoryRequestSchema) body: z.infer<typeof restoreMemoryRequestSchema>,
  ): Promise<RestoreMemoryResponse> {
    const k = requireIdempotencyKeyHeader(key);
    await this.limiter.hit(p.userId, 'restore');
    return this.memory.restore(p.userId, body.ids, k);
  }

  @Get('suggestions')
  @AllowDeletionPending()
  @ApiZodQuery('cursor', memorySuggestionListQuerySchema.shape.cursor)
  @ApiZodQuery('limit', memorySuggestionListQuerySchema.shape.limit)
  @ApiZodResponse(200, memorySuggestionListSchema)
  suggestions(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodQuery(memorySuggestionListQuerySchema) q: z.infer<typeof memorySuggestionListQuerySchema>,
  ): Promise<MemorySuggestionList> {
    return this.memory.listSuggestions(p.userId, q);
  }

  @Post('suggestions/:id/confirm')
  @HttpCode(200)
  @ApiZodBody(confirmSuggestionRequestSchema)
  @ApiZodResponse(200, memoryItemSchema)
  confirm(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @ZodBody(confirmSuggestionRequestSchema) body: z.infer<typeof confirmSuggestionRequestSchema>,
  ): Promise<MemoryItem> {
    return this.memory.confirmSuggestion(p.userId, id, body);
  }

  @Post('suggestions/:id/dismiss')
  @HttpCode(204)
  @AllowDeletionPending()
  async dismiss(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
  ): Promise<void> {
    await this.memory.dismissSuggestion(p.userId, id);
  }

  @Get(':id')
  @AllowDeletionPending()
  @ApiZodResponse(200, memoryItemSchema)
  async get(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MemoryItem> {
    const item = await this.memory.get(p.userId, id);
    void reply.header('ETag', etag(item.version));
    return item;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Correct, re-categorise or pin a memory (If-Match = version)' })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiZodBody(updateMemoryRequestSchema)
  @ApiZodResponse(200, memoryItemSchema)
  async update(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateMemoryRequestSchema) body: z.infer<typeof updateMemoryRequestSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MemoryItem> {
    const item = await this.memory.update(p.userId, id, requireIfMatch(ifMatch), body);
    void reply.header('ETag', etag(item.version));
    return item;
  }

  @Delete(':id')
  @HttpCode(204)
  @AllowDeletionPending()
  @ApiOperation({ summary: 'Delete one memory (permanent; chat history is not changed)' })
  async remove(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
  ): Promise<void> {
    await this.memory.remove(p.userId, id);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo a save or an update (If-Match = the version you were shown)' })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiZodResponse(200, undoMemoryResponseSchema)
  undo(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<UndoMemoryResponse> {
    return this.memory.undo(p.userId, id, requireIfMatch(ifMatch));
  }
}
