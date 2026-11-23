import { SkipThrottle } from '@nestjs/throttler';
import { Readable } from 'node:stream';
import {
  LIVE_SESSION_ID_PATTERN,
  SPEECH_HEADERS,
  speechQuerySchema,
  transcriptionRequestSchema,
  voicePreviewRequestSchema,
  transcriptionSchema,
  voiceAudioChunkSchema,
  voiceOptionsSchema,
  voiceSessionCreateSchema,
  voiceSessionSchema,
  type Transcription,
  type VoiceOptions,
  type VoiceSession,
} from '@karen/api-contracts';
import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { AuthenticatedPrincipal } from '../auth/principal.js';
import { ApiStandardErrors, ApiZodBody, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod.js';
import { ApiError } from '../common/api-error.js';
import { RequireConsent } from '../consent/consent.guard.js';
import { SSE_HEARTBEAT } from './chat-policy.js';
import { VoiceLiveService } from './voice-live.service.js';
import { VoiceService, type SpeechPlayback } from './voice.service.js';

const caller = (p: AuthenticatedPrincipal) => ({ userId: p.userId, userRef: p.userRef });
const RESUME_CURSOR = /^[0-9]{1,20}(?:-[0-9]{1,10})?$/;
const HEARTBEAT_MS = 15_000;

function sessionId(value: string): string {
  if (!LIVE_SESSION_ID_PATTERN.test(value)) throw new ApiError('NOT_FOUND', 'Session not found.');
  return value;
}

/**
 * Voice (ADR-0026). Both routes send content to the AI, so both need ACTIVE `AI_PROCESSING`
 * consent (its notice covers "what you type or say"). Recordings are processed and discarded.
 */
@ApiTags('voice')
@ApiBearerAuth()
@ApiStandardErrors()
@Controller({ version: '1' })
export class VoiceController {
  constructor(
    private readonly voice: VoiceService,
    private readonly live: VoiceLiveService,
  ) {}

  @Get('voice/options')
  @ApiOperation({ summary: 'Voices, speeds and live-conversation availability (settings screen)' })
  @ApiZodResponse(200, voiceOptionsSchema)
  options(): Promise<VoiceOptions> {
    return this.voice.options();
  }

  @Post('voice/sessions')
  @HttpCode(201)
  @RequireConsent('AI_PROCESSING')
  @ApiOperation({
    summary: 'Start a live voice conversation (streamed audio, live transcripts, turn detection)',
  })
  @ApiZodBody(voiceSessionCreateSchema)
  @ApiZodResponse(201, voiceSessionSchema)
  startSession(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(voiceSessionCreateSchema) body: z.infer<typeof voiceSessionCreateSchema>,
  ): Promise<VoiceSession> {
    return this.live.start(caller(p), body);
  }

  @Post('voice/sessions/:sessionId/audio')
  @HttpCode(204)
  @RequireConsent('AI_PROCESSING')
  // A live conversation streams ~4 chunks/s (240/min), above the general per-IP limit, which cut
  // every conversation off after ~30 s (found in a browser E2E, ADR-0029). This route has its own
  // per-user limiter (VOICE_LIVE_CHUNKS_PER_MINUTE) behind auth, consent and session ownership.
  @SkipThrottle({ default: true })
  @ApiOperation({ summary: 'Stream one audio chunk (never stored; duplicates by seq ignored)' })
  @ApiZodBody(voiceAudioChunkSchema)
  async appendAudio(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('sessionId') id: string,
    @ZodBody(voiceAudioChunkSchema) body: z.infer<typeof voiceAudioChunkSchema>,
  ): Promise<void> {
    await this.live.append(caller(p), sessionId(id), body);
  }

  @Post('voice/sessions/:sessionId/close')
  @HttpCode(202)
  @ApiOperation({ summary: 'End a live voice conversation' })
  async closeSession(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('sessionId') id: string,
  ): Promise<void> {
    await this.live.close(caller(p), sessionId(id));
  }

  @Get('voice/sessions/:sessionId/events')
  @ApiOperation({ summary: 'Live transcript events (SSE; resume with Last-Event-ID or ?after=)' })
  @ApiProduces('text/event-stream')
  @ApiHeader({ name: 'Last-Event-ID', required: false })
  @ApiQuery({ name: 'after', required: false, type: String })
  async events(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('sessionId') id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Query('after') after: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const cursor = lastEventId ?? after ?? null;
    if (cursor !== null && !RESUME_CURSOR.test(cursor)) {
      throw new ApiError('VALIDATION_FAILED', 'Invalid resume cursor.');
    }
    const abort = new AbortController();
    // Ownership and upstream refusals BEFORE committing to SSE (JSON errors with a status).
    const events = await this.live.openEvents(caller(p), sessionId(id), cursor, abort.signal);
    reply.hijack();
    const raw = reply.raw;
    raw.on('close', () => abort.abort());
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write('retry: 1000\n\n');
    const heartbeat = setInterval(() => raw.write(SSE_HEARTBEAT), HEARTBEAT_MS);
    try {
      for await (const item of events) {
        const frame =
          (item.id ? `id: ${item.id}\n` : '') +
          `event: ${item.event.type}\ndata: ${JSON.stringify(item.event)}\n\n`;
        if (!raw.write(frame)) await new Promise((r) => raw.once('drain', r));
        if (abort.signal.aborted) break;
      }
    } catch (error) {
      // Headers are sent: end the stream; the client reconnects with Last-Event-ID.
      request.log?.warn?.({ err: error }, 'voice events ended with an error');
    } finally {
      clearInterval(heartbeat);
      raw.end();
    }
  }

  @Post('voice/transcriptions')
  @HttpCode(200)
  @RequireConsent('AI_PROCESSING')
  @ApiOperation({
    summary: 'Transcribe a voice command (audio is not stored); send the text as a message',
  })
  @ApiZodBody(transcriptionRequestSchema)
  @ApiZodResponse(200, transcriptionSchema)
  transcribe(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(transcriptionRequestSchema) body: z.infer<typeof transcriptionRequestSchema>,
  ): Promise<Transcription> {
    return this.voice.transcribe(caller(p), body);
  }

  @Post('voice/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hear a voice before choosing it (KAREN’s fixed sample line)' })
  @ApiZodBody(voicePreviewRequestSchema)
  @ApiProduces('audio/mpeg', 'audio/wav')
  async preview(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @ZodBody(voicePreviewRequestSchema) body: z.infer<typeof voicePreviewRequestSchema>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const abort = new AbortController();
    reply.raw.on('close', () => abort.abort());
    const playback = await this.voice.preview(caller(p), body.voice_id, abort.signal);
    await this.pipeAudio(playback, reply, abort);
  }

  @Post('conversations/:id/messages/:messageId/speech')
  @HttpCode(200)
  @RequireConsent('AI_PROCESSING')
  @ApiOperation({
    summary:
      'Read an assistant answer aloud in your saved voice (streamed audio; starts while the answer is still being written). `segment=N` returns one sentence group; 204 = no more.',
  })
  @ApiQuery({ name: 'segment', required: false, type: Number })
  @ApiProduces('audio/mpeg', 'audio/wav')
  async speech(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @ZodQuery(speechQuerySchema) query: z.infer<typeof speechQuerySchema>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.streamSpeech(p, id, messageId, query.segment, request, reply);
  }

  /**
   * The same spoken answer as a GET (ADR-0031), for native audio players that stream a URL
   * with an Authorization header (the phone plays KAREN's voice as it arrives). Bearer-only:
   * the web BFF does not expose it.
   */
  @Get('conversations/:id/messages/:messageId/speech')
  @RequireConsent('AI_PROCESSING')
  @ApiOperation({ summary: 'Stream an assistant answer aloud (GET form for native players)' })
  @ApiProduces('audio/mpeg', 'audio/wav')
  async speechStream(
    @CurrentPrincipal() p: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.streamSpeech(p, id, messageId, undefined, request, reply);
  }

  private async streamSpeech(
    p: AuthenticatedPrincipal,
    id: string,
    messageId: string,
    segment: number | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const abort = new AbortController();
    // The client hanging up while KAREN is still writing must stop the wait, too. (The RESPONSE
    // 'close' event: since Node 16 the request's own 'close' fires once its body has been read.)
    reply.raw.on('close', () => abort.abort());
    // Refusals (not found, consent, limits, voice disabled) happen BEFORE audio: JSON errors.
    const playback = await this.voice.speech(caller(p), id, messageId, abort.signal, {
      ...(segment !== undefined ? { segment } : {}),
    });
    if (!playback) {
      await reply.code(204).send();
      return;
    }
    await this.pipeAudio(playback, reply, abort, request);
  }

  /** Streams synthesised audio to the client; settles usage exactly once when it ends. */
  private async pipeAudio(
    playback: SpeechPlayback,
    reply: FastifyReply,
    abort: AbortController,
    request?: FastifyRequest,
  ): Promise<void> {
    reply.hijack();
    const raw = reply.raw;
    // The listener interrupting playback closes the socket: stop upstream synthesis at once.
    raw.on('close', () => abort.abort());
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': playback.contentType,
      'cache-control': 'no-store',
      [SPEECH_HEADERS.isMock]: String(playback.isMock),
      [SPEECH_HEADERS.textTruncated]: String(playback.textTruncated),
      ...(playback.language ? { [SPEECH_HEADERS.language]: playback.language } : {}),
      ...(playback.voiceId ? { [SPEECH_HEADERS.voiceId]: playback.voiceId } : {}),
    });
    let delivered = false;
    let completed = false;
    try {
      for await (const chunk of Readable.fromWeb(playback.body)) {
        delivered = true;
        if (!raw.write(chunk)) await new Promise((r) => raw.once('drain', r));
        if (abort.signal.aborted) break;
      }
      completed = !abort.signal.aborted;
    } catch (error) {
      if (!abort.signal.aborted) request?.log?.warn?.({ err: error }, 'speech stream ended early');
    } finally {
      raw.end();
      await playback.finish({ delivered, completed });
    }
  }
}
