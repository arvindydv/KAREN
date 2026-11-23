import { randomUUID } from 'node:crypto';
import type { SpeechLanguage } from '@karen/ai-model-contracts';
import {
  VOICE_SPEED_PCT_MAX,
  VOICE_SPEED_PCT_MIN,
  type Transcription,
  type TranscriptionRequest,
  type VoiceOptions,
} from '@karen/api-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import {
  AiServiceClient,
  AiServiceError,
  type SpeechAudio,
} from '../infrastructure/ai/ai-service.client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';
import { usdToMicro } from './chat-policy.js';
import { speechSegment } from './speech-segments.js';
import { UsageLimitsService } from './usage-limits.service.js';

interface Caller {
  userId: string;
  userRef: string;
}

/** Defaults when the user has not saved preferences (mirrors ProfileService defaults). */
const DEFAULT_VOICE = { accent: 'indian', gender: 'any', speedPct: 100 } as const;

/** Answer statuses while KAREN is still writing (speech follows the text as it arrives). */
const ACTIVE_STATUSES: readonly string[] = ['pending', 'accepted', 'streaming'];
/** KAREN's voice-preview lines (server-owned text, ADR-0031). */
const PREVIEW_LINES = {
  // No promised actions: KAREN cannot set reminders or act yet, and must never imply she can.
  en: 'Hi, I’m KAREN. Ask me anything, from planning your day to a quick question, and I’ll talk it through with you.',
  hi: 'नमस्ते, मैं करेन हूँ। दिन की प्लानिंग हो या कोई छोटा सा सवाल, कुछ भी पूछिए, मैं आपके साथ सोचूँगी।',
} as const;
/** How often a speech request re-reads an answer that is still being written. */
const SEGMENT_POLL_MS = 80;

export interface SpeechPlayback extends SpeechAudio {
  /**
   * Must be called exactly once when the response ends. `delivered` = at least one audio byte
   * reached the client (then the upstream may have billed synthesis, so the reservation is
   * charged; otherwise it is released).
   */
  finish(outcome: { delivered: boolean; completed: boolean }): Promise<void>;
}

/** Maps AI-service failures to safe client errors (never upstream text). */
export function voiceFailure(error: unknown): ApiError {
  if (!(error instanceof AiServiceError)) {
    return new ApiError('INTERNAL_ERROR', 'Voice is not available right now.', { cause: error });
  }
  switch (error.code) {
    case 'TIER_DISABLED':
    case 'CAPABILITY_UNAVAILABLE':
      return new ApiError('PROVIDER_CAPABILITY_UNAVAILABLE', 'Voice is not available right now.', {
        retryable: false,
        cause: error,
      });
    case 'VALIDATION_ERROR':
      return new ApiError('VALIDATION_FAILED', 'KAREN couldn’t process that recording.', {
        retryable: false,
        cause: error,
      });
    case 'GATEWAY_RATE_LIMITED':
      return new ApiError('RATE_LIMITED', 'KAREN is very busy right now. Please try again.', {
        retryable: true,
        cause: error,
      });
    case 'BUDGET_EXCEEDED':
      return new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'KAREN has reached its AI usage limit for now. Please try again later.',
        { retryable: false, cause: error },
      );
    default:
      return new ApiError('DEPENDENCY_UNAVAILABLE', 'Voice is not available right now.', {
        retryable: error.retryable,
        cause: error,
      });
  }
}

/**
 * Voice commands and spoken replies (ADR-0026).
 *
 * - Speech-to-text: the transcript is returned for the user to review; it is then sent through
 *   the normal message endpoint, so voice and text share one router, consent and limit path.
 * - Text-to-speech: only for assistant answers the user owns (KAREN never speaks arbitrary
 *   client-supplied text), with the voice chosen from saved language/accent preferences.
 * - Audio is never stored. Costs count against the same per-user daily/monthly limits as chat
 *   (reserve → settle; mock costs nothing) and are recorded in the ledger with an
 *   `ai_invocations` row (route tier AUDIO, metadata only).
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ai: AiServiceClient,
    private readonly limits: UsageLimitsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Per-user voice request rate limit (Redis, fail closed). */
  private async rateLimit(userId: string): Promise<void> {
    const key = `karen:voice:rate:${userId}:${Math.floor(Date.now() / 60_000)}`;
    let count: number;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, 120);
    } catch (error) {
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Voice is not available right now.', {
        retryable: true,
        cause: error,
      });
    }
    if (count > this.env.VOICE_REQUESTS_PER_MINUTE) {
      throw new ApiError('RATE_LIMITED', 'Too many voice requests. Please wait a moment.', {
        retryable: true,
      });
    }
  }

  private async settle(input: {
    userId: string;
    reservationKey: string;
    requestId: string;
    messageId: string | null;
    costMicro: number;
    servedModel: string | null;
    isMock: boolean;
    status: 'completed' | 'incomplete' | 'failed' | 'canceled';
    errorCode: string | null;
    startedAt: number;
  }): Promise<void> {
    await this.limits.settleCounters(input.userId, input.reservationKey, input.costMicro);
    try {
      await this.prisma.withUserScope(input.userId, async (tx) => {
        if (input.costMicro > 0) {
          await this.limits.recordInLedger(tx, {
            userId: input.userId,
            costMicroUsd: input.costMicro,
            inputTokens: null,
            outputTokens: null,
          });
        }
        await tx.aiInvocation.create({
          data: {
            userId: input.userId,
            messageId: input.messageId,
            requestId: input.requestId,
            routeTier: 'AUDIO',
            servedModel: input.servedModel,
            costMicroUsd: BigInt(input.costMicro),
            latencyMs: Date.now() - input.startedAt,
            isMock: input.isMock,
            status: input.status,
            errorCode: input.errorCode,
          },
        });
      });
    } catch (error) {
      // Counters are settled; a ledger failure is reconciled from Redis-independent sources.
      this.logger.error({ err: error }, 'Voice usage ledger write failed');
    }
  }

  /**
   * What voice can do here (settings screen). Voice disabled server-side is not an error: the
   * client simply hides voice controls.
   */
  async options(): Promise<VoiceOptions> {
    let catalog;
    try {
      catalog = await this.ai.voices(`voice-options-${randomUUID()}`);
    } catch (error) {
      if (error instanceof AiServiceError && error.code === 'TIER_DISABLED') {
        return {
          available: false,
          live_available: false,
          is_mock: false,
          speed_pct_min: VOICE_SPEED_PCT_MIN,
          speed_pct_max: VOICE_SPEED_PCT_MAX,
          voices: [],
        };
      }
      throw voiceFailure(error);
    }
    return {
      available: true,
      live_available: catalog.live_available,
      is_mock: catalog.tts_provider === 'mock' || catalog.stt_provider === 'mock',
      speed_pct_min: Math.max(VOICE_SPEED_PCT_MIN, Math.round(catalog.speed_min * 100)),
      speed_pct_max: Math.min(VOICE_SPEED_PCT_MAX, Math.round(catalog.speed_max * 100)),
      voices: catalog.voices,
    };
  }

  private async savedVoice(userId: string) {
    return this.prisma.withUserScope(userId, (tx) =>
      tx.userPreferences.findUnique({
        where: { userId },
        select: {
          voiceAccent: true,
          voiceGender: true,
          voiceSpeedPct: true,
          voiceId: true,
          voiceReplies: true,
          replyLanguage: true,
        },
      }),
    );
  }

  async transcribe(caller: Caller, body: TranscriptionRequest): Promise<Transcription> {
    await this.rateLimit(caller.userId);
    const saved = body.language_hint === undefined ? await this.savedVoice(caller.userId) : null;
    // A saved reply language doubles as the expected spoken language (ADR-0027).
    const languageHint =
      body.language_hint ??
      (saved?.replyLanguage && saved.replyLanguage !== 'auto'
        ? (saved.replyLanguage as SpeechLanguage)
        : undefined);
    const requestId = `voice-stt-${randomUUID()}`;
    const reserveMicro = usdToMicro(this.env.VOICE_STT_RESERVE_USD);
    await this.limits.reserve(caller.userId, requestId, new Date(), reserveMicro);
    const startedAt = Date.now();
    try {
      const result = await this.ai.transcribe({
        request_id: requestId,
        user_ref: caller.userRef,
        audio_base64: body.audio_base64,
        audio_format: body.audio_format,
        ...(body.duration_ms !== undefined ? { duration_ms: body.duration_ms } : {}),
        ...(languageHint !== undefined ? { language_hint: languageHint } : {}),
        max_cost_usd: this.env.VOICE_STT_RESERVE_USD,
      });
      const costMicro = result.is_mock
        ? 0
        : usdToMicro(result.estimated_cost_usd ?? this.env.VOICE_STT_RESERVE_USD);
      await this.settle({
        userId: caller.userId,
        reservationKey: requestId,
        requestId,
        messageId: null,
        costMicro,
        servedModel: result.served_model,
        isMock: result.is_mock,
        status: 'completed',
        errorCode: null,
        startedAt,
      });
      return { text: result.text, language: result.language, is_mock: result.is_mock };
    } catch (error) {
      // A failed transcription without a transcript is not charged (ADR-0023).
      await this.settle({
        userId: caller.userId,
        reservationKey: requestId,
        requestId,
        messageId: null,
        costMicro: 0,
        servedModel: null,
        isMock: false,
        status: 'failed',
        errorCode: error instanceof AiServiceError ? error.code : 'INTERNAL_ERROR',
        startedAt,
      });
      throw voiceFailure(error);
    }
  }

  /** Text-to-speech for an assistant answer the caller owns. */
  /**
   * Reads an assistant answer aloud in the user's saved voice.
   *
   * - Finished answer: one synthesis of the whole text (the AI service streams it sentence by
   *   sentence).
   * - Answer still being written (ADR-0031): KAREN starts speaking as soon as the first sentence
   *   exists; later sentences are synthesised as they arrive and chained into the same stream.
   * - `segment` (mobile): only that speech segment, as a complete clip; `null` = no such segment
   *   (the answer is finished and shorter) → the client stops asking.
   *
   * KAREN only ever speaks text from the user's own assistant message (never client text).
   */
  async speech(
    caller: Caller,
    threadId: string,
    messageId: string,
    signal: AbortSignal,
    options: { segment?: number } = {},
  ): Promise<SpeechPlayback | null> {
    const { message, preferences } = await this.prisma.withUserScope(caller.userId, async (tx) => ({
      message: await tx.conversationMessage.findFirst({
        where: { id: messageId, threadId, userId: caller.userId, role: 'assistant' },
        select: { content: true, status: true },
      }),
      preferences: await tx.userPreferences.findUnique({
        where: { userId: caller.userId },
        select: {
          voiceAccent: true,
          voiceGender: true,
          voiceSpeedPct: true,
          voiceId: true,
          voiceReplies: true,
        },
      }),
    }));
    if (!message) throw new ApiError('NOT_FOUND', 'Message not found.');
    if (preferences && !preferences.voiceReplies) {
      throw new ApiError('CONFLICT', 'Spoken replies are turned off in your settings.', {
        retryable: false,
      });
    }
    const active = ACTIVE_STATUSES.includes(message.status);
    if (!active && message.content.trim() === '') {
      throw new ApiError('CONFLICT', 'This answer can’t be read aloud.', { retryable: false });
    }
    // One answer = one rate-limit unit: later segments of the same answer are not counted again.
    if (!options.segment) await this.rateLimit(caller.userId);
    const target = { caller, threadId, messageId, preferences };

    if (options.segment !== undefined) {
      const text = await this.waitForSegment(target, options.segment, signal);
      return text === null ? null : this.synthesize(target, text, signal);
    }
    if (!active) {
      // The AI service truncates at a sentence boundary to its configured limit.
      return this.synthesize(target, message.content.slice(0, 4_000), signal);
    }
    const first = await this.waitForSegment(target, 0, signal);
    if (first === null) {
      throw new ApiError('CONFLICT', 'This answer can’t be read aloud.', { retryable: false });
    }
    const head = await this.synthesize(target, first, signal);
    return this.chain(target, head, signal);
  }

  /** Waits until speech segment `index` of the (possibly still streaming) answer exists. */
  private async waitForSegment(
    target: SpeechTarget,
    index: number,
    signal: AbortSignal,
  ): Promise<string | null> {
    const deadline = Date.now() + (this.env.CHAT_GENERATION_TIMEOUT_SECONDS + 15) * 1000;
    while (!signal.aborted && Date.now() < deadline) {
      const row = await this.prisma.withUserScope(target.caller.userId, (tx) =>
        tx.conversationMessage.findFirst({
          where: {
            id: target.messageId ?? '',
            threadId: target.threadId,
            userId: target.caller.userId,
          },
          select: { content: true, status: true },
        }),
      );
      if (!row) throw new ApiError('NOT_FOUND', 'Message not found.');
      const final = !ACTIVE_STATUSES.includes(row.status);
      const result = speechSegment(row.content, index, final);
      if (result.kind === 'segment') return result.text;
      if (result.kind === 'done') return null;
      await sleep(SEGMENT_POLL_MS, signal);
    }
    return null;
  }

  /**
   * Chains the remaining segments behind `head` into one audio stream. The next segment is
   * synthesised while the current one plays, so there is no gap between sentences. Every
   * segment is reserved, charged and recorded on its own.
   */
  private chain(target: SpeechTarget, head: SpeechPlayback, signal: AbortSignal): SpeechPlayback {
    const voiceId = head.voiceId ?? undefined;
    const synth = (text: string) => this.synthesize(target, text, signal, voiceId);
    const next = (index: number): Promise<Segment | null> =>
      this.waitForSegment(target, index, signal).then(async (text) =>
        text === null || signal.aborted ? null : { text, playback: await synth(text) },
      );
    async function* audio(): AsyncGenerator<Uint8Array> {
      let current: Segment | null = { text: '', playback: head };
      let index = 0;
      let upcoming: Promise<Segment | null> | null = null;
      try {
        while (current) {
          // A concatenable format (MP3) can be chained; others (mock WAV) play only the first.
          upcoming = head.contentType.startsWith('audio/mpeg') ? next(index + 1) : null;
          let playing: SpeechPlayback = current.playback;
          for (let attempt = 0; ; attempt++) {
            let delivered = false;
            let completed = false;
            try {
              for await (const chunk of streamChunks(playing.body)) {
                delivered = true;
                yield chunk;
              }
              completed = true;
            } finally {
              await playing.finish({ delivered, completed });
            }
            // A segment that produced no audio at all (rare upstream hiccup) is retried once —
            // safe, because nothing of it was played (never replay after audio was delivered).
            if (delivered || attempt > 0 || !current.text || signal.aborted) break;
            playing = await synth(current.text);
          }
          current = upcoming ? await upcoming : null;
          upcoming = null;
          index += 1;
        }
      } finally {
        // Interrupted: release a segment that was prepared but never played.
        const pending = upcoming ? await upcoming.catch(() => null) : null;
        if (pending) {
          await pending.playback.body.cancel().catch(() => undefined);
          await pending.playback.finish({ delivered: false, completed: false });
        }
      }
    }
    return {
      body: ReadableStream.from(audio()),
      contentType: head.contentType,
      voiceId: head.voiceId,
      language: head.language,
      isMock: head.isMock,
      textTruncated: false,
      estimatedCostUsd: null,
      // Each segment settles itself inside the stream.
      finish: () => Promise.resolve(),
    };
  }

  /**
   * Speaks KAREN's fixed sample line in `voiceId` so the user can hear a voice before choosing it
   * (ADR-0031). The text is server-owned; the voice must be one this deployment offers.
   */
  async preview(caller: Caller, voiceId: string, signal: AbortSignal): Promise<SpeechPlayback> {
    const options = await this.options();
    const voice = options.voices.find((v) => v.voice_id === voiceId);
    if (!options.available || !voice) {
      throw new ApiError('NOT_FOUND', 'That voice is not available.', { retryable: false });
    }
    await this.rateLimit(caller.userId);
    const preferences = await this.prisma.withUserScope(caller.userId, (tx) =>
      tx.userPreferences.findUnique({
        where: { userId: caller.userId },
        select: {
          voiceAccent: true,
          voiceGender: true,
          voiceSpeedPct: true,
          voiceId: true,
          voiceReplies: true,
        },
      }),
    );
    const text = PREVIEW_LINES[voice.language === 'hi' ? 'hi' : 'en'];
    return this.synthesize(
      { caller, threadId: '', messageId: null, preferences },
      text,
      signal,
      voiceId,
    );
  }

  /** One synthesis call: per-user reservation → AI service → settle once when it ends. */
  private async synthesize(
    target: SpeechTarget,
    text: string,
    signal: AbortSignal,
    voiceId?: string,
  ): Promise<SpeechPlayback> {
    const { caller, messageId, preferences } = target;
    const requestId = `voice-tts-${randomUUID()}`;
    const reserveMicro = usdToMicro(this.env.VOICE_TTS_RESERVE_USD);
    await this.limits.reserve(caller.userId, requestId, new Date(), reserveMicro);
    const startedAt = Date.now();
    const chosenVoice = voiceId ?? preferences?.voiceId ?? undefined;
    let audio: SpeechAudio;
    try {
      audio = await this.ai.speech(
        {
          request_id: requestId,
          user_ref: caller.userRef,
          text,
          voice: {
            accent: (preferences?.voiceAccent ?? DEFAULT_VOICE.accent) as 'indian',
            gender: (preferences?.voiceGender ?? DEFAULT_VOICE.gender) as 'any',
            speed: (preferences?.voiceSpeedPct ?? DEFAULT_VOICE.speedPct) / 100,
            ...(chosenVoice ? { voice_id: chosenVoice } : {}),
          },
          max_cost_usd: this.env.VOICE_TTS_RESERVE_USD,
        },
        { signal },
      );
    } catch (error) {
      await this.settle({
        userId: caller.userId,
        reservationKey: requestId,
        requestId,
        messageId,
        costMicro: 0,
        servedModel: null,
        isMock: false,
        status: 'failed',
        errorCode: error instanceof AiServiceError ? error.code : 'INTERNAL_ERROR',
        startedAt,
      });
      throw voiceFailure(error);
    }
    let finished = false;
    return {
      ...audio,
      finish: async ({ delivered, completed }) => {
        if (finished) return;
        finished = true;
        const charge = delivered && !audio.isMock;
        await this.settle({
          userId: caller.userId,
          reservationKey: requestId,
          requestId,
          messageId,
          costMicro: charge
            ? usdToMicro(audio.estimatedCostUsd ?? this.env.VOICE_TTS_RESERVE_USD)
            : 0,
          servedModel: audio.voiceId,
          isMock: audio.isMock,
          status: completed ? 'completed' : delivered ? 'canceled' : 'failed',
          errorCode: null,
          startedAt,
        });
      },
    };
  }
}

interface Segment {
  text: string;
  playback: SpeechPlayback;
}

interface SpeechTarget {
  caller: Caller;
  threadId: string;
  /** null for a voice preview (not tied to a message). */
  messageId: string | null;
  preferences: {
    voiceAccent: string;
    voiceGender: string;
    voiceSpeedPct: number;
    voiceId: string | null;
    voiceReplies: boolean;
  } | null;
}

async function* streamChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export type { SpeechLanguage };
