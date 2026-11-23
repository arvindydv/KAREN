import {
  aiUsageSchema,
  conversationListQuerySchema,
  conversationListSchema,
  conversationSchema,
  createConversationRequestSchema,
  feedbackRequestSchema,
  forkConversationRequestSchema,
  messageListQuerySchema,
  messageListSchema,
  messageSchema,
  regenerateResponseSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  updateConversationRequestSchema,
  type AiUsage,
  type Conversation,
  type ConversationList,
  type Message,
  type MessageList,
  type RegenerateResponse,
  type SendMessageResponse,
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
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Req } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/decorators.js';
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
import { RequireConsent } from '../consent/consent.guard.js';
import { parseResumeSeq, SSE_HEARTBEAT, sseFrame } from './chat-policy.js';
import { ConversationService, requireIdempotencyKey } from './conversation.service.js';
import { HEARTBEAT, StreamReaderService } from './stream-reader.service.js';
import { UsageLimitsService } from './usage-limits.service.js';

const Uuid = new ParseUUIDPipe({ version: '4' });
const caller = (p: AuthenticatedPrincipal) => ({ userId: p.userId, userRef: p.userRef });

/**
 * Conversations (Phase 02, F02-01/F02-02). Reading, renaming and deleting your conversations
 * never needs consent (you can always see and erase your data); anything that sends text to
 * the AI (send, regenerate, edit-and-resend) requires an ACTIVE `AI_PROCESSING` consent.
 */
@ApiTags('conversations')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'conversations', version: '1' })
export class ConversationController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly reader: StreamReaderService,
  ) {}

  @Post()
  @ApiZodBody(createConversationRequestSchema)
  @ApiZodResponse(201, conversationSchema)
  create(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(createConversationRequestSchema)
    body: z.infer<typeof createConversationRequestSchema>,
  ): Promise<Conversation> {
    return this.conversations.create(p.userId, body);
  }

  @Get()
  @ApiZodQuery('cursor', conversationListQuerySchema.shape.cursor)
  @ApiZodQuery('limit', conversationListQuerySchema.shape.limit)
  @ApiZodQuery('q', conversationListQuerySchema.shape.q)
  @ApiZodQuery('archived', conversationListQuerySchema.shape.archived)
  @ApiZodResponse(200, conversationListSchema)
  list(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodQuery(conversationListQuerySchema) query: z.infer<typeof conversationListQuerySchema>,
  ): Promise<ConversationList> {
    return this.conversations.list(p.userId, query);
  }

  @Get(':id')
  @ApiZodResponse(200, conversationSchema)
  async get(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Conversation> {
    const c = await this.conversations.get(p.userId, id);
    void reply.header('ETag', etag(c.version));
    return c;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename, pin or archive (If-Match = version)' })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiZodBody(updateConversationRequestSchema)
  @ApiZodResponse(200, conversationSchema)
  async update(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ZodBody(updateConversationRequestSchema)
    body: z.infer<typeof updateConversationRequestSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Conversation> {
    const c = await this.conversations.update(p.userId, id, requireIfMatch(ifMatch), body);
    void reply.header('ETag', etag(c.version));
    return c;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a conversation and all its messages (permanent)' })
  async remove(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
  ): Promise<void> {
    await this.conversations.remove(p.userId, id);
  }

  @Get(':id/messages')
  @ApiZodQuery('before', messageListQuerySchema.shape.before)
  @ApiZodQuery('limit', messageListQuerySchema.shape.limit)
  @ApiZodResponse(200, messageListSchema)
  messages(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @ZodQuery(messageListQuerySchema) query: z.infer<typeof messageListQuerySchema>,
  ): Promise<MessageList> {
    return this.conversations.listMessages(p.userId, id, query);
  }

  @Post(':id/messages')
  @HttpCode(202)
  @RequireConsent('AI_PROCESSING')
  @ApiOperation({ summary: 'Send a message; the answer streams from `stream_path`' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiZodBody(sendMessageRequestSchema)
  @ApiZodResponse(202, sendMessageResponseSchema)
  send(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(sendMessageRequestSchema) body: z.infer<typeof sendMessageRequestSchema>,
  ): Promise<SendMessageResponse> {
    return this.conversations.send(
      caller(p),
      id,
      body.content,
      requireIdempotencyKey(key),
      body.input_mode ?? 'text',
    );
  }

  @Post(':id/fork')
  @HttpCode(202)
  @RequireConsent('AI_PROCESSING')
  @ApiOperation({ summary: 'Edit a previous message: new conversation from that point' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiZodBody(forkConversationRequestSchema)
  @ApiZodResponse(202, sendMessageResponseSchema)
  fork(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @ZodBody(forkConversationRequestSchema) body: z.infer<typeof forkConversationRequestSchema>,
  ): Promise<SendMessageResponse> {
    return this.conversations.fork(
      caller(p),
      id,
      body.from_message_id,
      body.content,
      requireIdempotencyKey(key),
    );
  }

  @Get(':id/messages/:messageId')
  @ApiZodResponse(200, messageSchema)
  message(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Param('messageId', Uuid) messageId: string,
  ): Promise<Message> {
    return this.conversations.getMessage(p.userId, id, messageId);
  }

  @Get(':id/messages/:messageId/stream')
  @ApiOperation({
    summary: 'Server-sent events for an assistant message (resume with Last-Event-ID)',
  })
  @ApiProduces('text/event-stream')
  @ApiHeader({ name: 'Last-Event-ID', required: false })
  @ApiZodQuery('after', messageListQuerySchema.shape.before)
  async stream(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Param('messageId', Uuid) messageId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Query('after') after: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Authorisation BEFORE committing to SSE, so failures stay JSON errors with a status.
    await this.reader.assertReadable(p.userId, id, messageId);
    const resume = parseResumeSeq(lastEventId ?? after);
    const abort = new AbortController();
    reply.hijack();
    const raw = reply.raw;
    // The response socket closing (client went away, proxy timeout) ends this reader only;
    // the generation itself continues (ADR-0022: disconnect is not cancel).
    raw.on('close', () => abort.abort());
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write('retry: 2000\n\n');
    try {
      for await (const item of this.reader.events(p.userId, messageId, resume, abort.signal)) {
        // Backpressure: wait for the socket to drain before producing more.
        const ok = raw.write(item === HEARTBEAT ? SSE_HEARTBEAT : sseFrame(item));
        if (!ok) await new Promise((r) => raw.once('drain', r));
        if (abort.signal.aborted) break;
      }
    } catch (error) {
      // Headers are already sent: end the stream; the client resumes with Last-Event-ID.
      request.log?.warn?.({ err: error }, 'chat stream ended with an error');
    } finally {
      raw.end();
    }
  }

  @Post(':id/messages/:messageId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop a running answer (idempotent)' })
  @ApiZodResponse(200, messageSchema)
  cancel(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Param('messageId', Uuid) messageId: string,
  ): Promise<Message> {
    return this.conversations.cancel(p.userId, id, messageId);
  }

  @Post(':id/messages/:messageId/regenerate')
  @HttpCode(202)
  @RequireConsent('AI_PROCESSING')
  @ApiOperation({ summary: 'New answer to the same question (latest answer only)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiZodResponse(202, regenerateResponseSchema)
  regenerate(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Param('messageId', Uuid) messageId: string,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<RegenerateResponse> {
    return this.conversations.regenerate(caller(p), id, messageId, requireIdempotencyKey(key));
  }

  @Post(':id/messages/:messageId/feedback')
  @HttpCode(200)
  @ApiZodBody(feedbackRequestSchema)
  @ApiZodResponse(200, messageSchema)
  feedback(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Param('messageId', Uuid) messageId: string,
    @ZodBody(feedbackRequestSchema) body: z.infer<typeof feedbackRequestSchema>,
  ): Promise<Message> {
    return this.conversations.feedback(p.userId, id, messageId, body);
  }

  @Delete(':id/messages/:messageId/feedback')
  @HttpCode(200)
  @ApiZodResponse(200, messageSchema)
  clearFeedback(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', Uuid) id: string,
    @Param('messageId', Uuid) messageId: string,
  ): Promise<Message> {
    return this.conversations.clearFeedback(p.userId, id, messageId);
  }
}

/** The caller's AI usage against their limits (ratios only; no money exposed). */
@ApiTags('conversations')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ path: 'me', version: '1' })
export class AiUsageController {
  constructor(private readonly usage: UsageLimitsService) {}

  @Get('ai-usage')
  @ApiZodResponse(200, aiUsageSchema)
  get(@CurrentPrincipal() p: AuthenticatedPrincipal): Promise<AiUsage> {
    return this.usage.usage(p.userId);
  }
}
