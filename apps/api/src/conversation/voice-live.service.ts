import { randomUUID } from 'node:crypto';
import type { LiveEvent } from '@karen/ai-model-contracts';
import type {
  VoiceAudioChunk,
  VoiceEvent,
  VoiceSession,
  VoiceSessionCreate,
} from '@karen/api-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { AiServiceClient, AiServiceError } from '../infrastructure/ai/ai-service.client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';
import { usdToMicro } from './chat-policy.js';
import { UsageLimitsService } from './usage-limits.service.js';
import { voiceFailure } from './voice.service.js';

interface Caller {
  userId: string;
  userRef: string;
}

/** What the API remembers about a live session (Redis; never the audio or transcript). */
interface LiveRecord {
  userId: string;
  userRef: string;
  reservationKey: string;
  requestId: string;
  threadId: string | null;
  startedAt: number;
}

const KEY = 'karen:voice:live:';
const ACTIVE_KEY = 'karen:voice:live:active:';
const SETTLED_KEY = 'karen:voice:live:settled:';
/** How long `close` waits for the AI service's final usage before leaving it to the stream. */
const CLOSE_SETTLE_WAIT_MS = 8_000;

export interface PublicVoiceEvent {
  readonly id: string | null;
  readonly event: VoiceEvent;
}

/** Internal live event → public event (usage details stay server-side). */
export function toPublicEvent(event: LiveEvent): VoiceEvent {
  if (event.type === 'closed') {
    return {
      type: 'closed',
      reason: event.usage.reason,
      audio_seconds: event.usage.audio_seconds,
    };
  }
  return event;
}

/**
 * Live voice conversations (ADR-0027): the browser streams small audio chunks here and reads
 * live transcripts over SSE; the AI service holds the Deepgram stream. This service adds what
 * only the API knows: the authenticated user, consent (controller), conversation ownership,
 * per-user rate limits, one active session per user, and per-user spend (reserve the worst case
 * up front, settle to the measured audio exactly once).
 *
 * The final transcript of each turn is NOT turned into a message here: the client sends it via
 * the normal message endpoint (Idempotency-Key `voice-<session>-<turn>`), so voice and typed
 * messages share one conversation, router, consent, limit and persistence path.
 */
@Injectable()
export class VoiceLiveService {
  private readonly logger = new Logger(VoiceLiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ai: AiServiceClient,
    private readonly limits: UsageLimitsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private unavailable(cause: unknown): ApiError {
    return new ApiError('DEPENDENCY_UNAVAILABLE', 'Voice is not available right now.', {
      retryable: true,
      cause,
    });
  }

  private async counter(key: string, windowSeconds: number): Promise<number> {
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, windowSeconds * 2);
      return count;
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  private async load(userId: string, sessionId: string): Promise<LiveRecord> {
    let raw: string | null;
    try {
      raw = await this.redis.client.get(`${KEY}${sessionId}`);
    } catch (error) {
      throw this.unavailable(error);
    }
    const record = raw ? (JSON.parse(raw) as LiveRecord) : null;
    // Another user's session is indistinguishable from an unknown one.
    if (!record || record.userId !== userId) throw new ApiError('NOT_FOUND', 'Session not found.');
    return record;
  }

  async start(caller: Caller, body: VoiceSessionCreate): Promise<VoiceSession> {
    const minute = Math.floor(Date.now() / 60_000);
    if (
      (await this.counter(`karen:voice:rate:${caller.userId}:${minute}`, 60)) >
      this.env.VOICE_REQUESTS_PER_MINUTE
    ) {
      throw new ApiError('RATE_LIMITED', 'Too many voice requests. Please wait a moment.', {
        retryable: true,
      });
    }
    const { thread, prefs } = await this.prisma.withUserScope(caller.userId, async (tx) => ({
      thread: body.conversation_id
        ? await tx.conversationThread.findFirst({
            where: { id: body.conversation_id, userId: caller.userId },
            select: { id: true, expiresAt: true },
          })
        : null,
      prefs: await tx.userPreferences.findUnique({
        where: { userId: caller.userId },
        select: { voiceEnabled: true, replyLanguage: true },
      }),
    }));
    if (
      body.conversation_id &&
      (!thread || (thread.expiresAt && thread.expiresAt.getTime() <= Date.now()))
    ) {
      throw new ApiError('NOT_FOUND', 'Conversation not found.');
    }
    if (prefs && !prefs.voiceEnabled) {
      throw new ApiError('CONFLICT', 'Voice is turned off in your settings.', { retryable: false });
    }
    const sessionTtl = this.env.VOICE_LIVE_SESSION_TTL_SECONDS;
    const activeKey = `${ACTIVE_KEY}${caller.userId}`;
    const claim = randomUUID();
    let claimed: string | null;
    try {
      claimed = await this.redis.client.set(activeKey, claim, 'EX', sessionTtl, 'NX');
    } catch (error) {
      throw this.unavailable(error);
    }
    if (claimed !== 'OK') {
      throw new ApiError('CONFLICT', 'A voice conversation is already running. End it first.', {
        retryable: true,
      });
    }
    const requestId = `voice-live-${randomUUID()}`;
    const reserveMicro = usdToMicro(this.env.VOICE_LIVE_RESERVE_USD);
    try {
      await this.limits.reserve(caller.userId, requestId, new Date(), reserveMicro);
    } catch (error) {
      await this.redis.client.del(activeKey).catch(() => undefined);
      throw error;
    }
    const savedLanguage =
      prefs?.replyLanguage && prefs.replyLanguage !== 'auto' ? prefs.replyLanguage : undefined;
    const language = body.language ?? (savedLanguage as VoiceSessionCreate['language']);
    let started;
    try {
      started = await this.ai.startLiveSession({
        request_id: requestId,
        user_ref: caller.userRef,
        audio_format: body.audio_format,
        ...(language ? { language_hint: language } : {}),
        max_cost_usd: this.env.VOICE_LIVE_RESERVE_USD,
      });
    } catch (error) {
      // Nothing was streamed: release the reservation and the single-session claim.
      await this.limits.release(caller.userId, requestId);
      await this.redis.client.del(activeKey).catch(() => undefined);
      throw voiceFailure(error);
    }
    const record: LiveRecord = {
      userId: caller.userId,
      userRef: caller.userRef,
      reservationKey: requestId,
      requestId,
      threadId: thread?.id ?? null,
      startedAt: Date.now(),
    };
    try {
      await this.redis.client.set(
        `${KEY}${started.session_id}`,
        JSON.stringify(record),
        'EX',
        sessionTtl,
      );
      await this.redis.client.set(activeKey, started.session_id, 'EX', sessionTtl);
    } catch (error) {
      await this.ai
        .closeLiveSession(started.session_id, caller.userRef, requestId)
        .catch(() => undefined);
      throw this.unavailable(error);
    }
    return {
      session_id: started.session_id,
      max_seconds: started.max_seconds,
      idle_seconds: started.idle_seconds,
      is_mock: started.is_mock,
    };
  }

  async append(caller: Caller, sessionId: string, chunk: VoiceAudioChunk): Promise<void> {
    const record = await this.load(caller.userId, sessionId);
    const minute = Math.floor(Date.now() / 60_000);
    if (
      (await this.counter(`karen:voice:chunks:${caller.userId}:${minute}`, 60)) >
      this.env.VOICE_LIVE_CHUNKS_PER_MINUTE
    ) {
      throw new ApiError('RATE_LIMITED', 'Audio is arriving too fast.', { retryable: true });
    }
    try {
      await this.ai.appendLiveAudio(
        sessionId,
        { user_ref: record.userRef, seq: chunk.seq, audio_base64: chunk.audio_base64 },
        record.requestId,
      );
    } catch (error) {
      if (error instanceof AiServiceError && error.code === 'NOT_FOUND') {
        throw new ApiError('NOT_FOUND', 'Session not found.');
      }
      throw voiceFailure(error);
    }
  }

  /** Ends the session and settles its usage (waits briefly for the AI service's final figures). */
  async close(caller: Caller, sessionId: string): Promise<void> {
    const record = await this.load(caller.userId, sessionId);
    try {
      await this.ai.closeLiveSession(sessionId, record.userRef, record.requestId);
    } catch (error) {
      if (!(error instanceof AiServiceError && error.code === 'NOT_FOUND')) {
        throw voiceFailure(error);
      }
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), CLOSE_SETTLE_WAIT_MS);
    try {
      for await (const frame of this.ai.liveEvents(
        sessionId,
        record.userRef,
        null,
        record.requestId,
        abort.signal,
      )) {
        if (frame.event.type === 'closed') {
          await this.settle(sessionId, record, frame.event);
          return;
        }
      }
    } catch (error) {
      // The stream reader (or the reservation TTL) settles later; never fail the user's close.
      this.logger.warn({ err: error }, 'Live session close: usage not yet available');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Proxies live events for the owner. Settles usage when the final `closed` event passes by
   * (exactly once across close() and any number of readers).
   */
  async *events(
    caller: Caller,
    sessionId: string,
    after: string | null,
    signal: AbortSignal,
  ): AsyncGenerator<PublicVoiceEvent> {
    const record = await this.load(caller.userId, sessionId);
    const stream = this.ai.liveEvents(sessionId, record.userRef, after, record.requestId, signal);
    for await (const frame of stream) {
      if (frame.event.type === 'closed') await this.settle(sessionId, record, frame.event);
      yield { id: frame.id, event: toPublicEvent(frame.event) };
    }
  }

  /** Opens the upstream stream first so refusals surface as JSON errors before SSE starts. */
  async openEvents(
    caller: Caller,
    sessionId: string,
    after: string | null,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<PublicVoiceEvent>> {
    const iterator = this.events(caller, sessionId, after, signal);
    try {
      const first = await iterator.next();
      return (async function* () {
        if (!first.done) yield first.value;
        yield* iterator;
      })();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof AiServiceError && error.code === 'NOT_FOUND') {
        throw new ApiError('NOT_FOUND', 'Session not found.');
      }
      throw voiceFailure(error);
    }
  }

  private async settle(
    sessionId: string,
    record: LiveRecord,
    event: Extract<LiveEvent, { type: 'closed' }>,
  ): Promise<void> {
    let first: string | null;
    try {
      first = await this.redis.client.set(
        `${SETTLED_KEY}${sessionId}`,
        '1',
        'EX',
        this.env.VOICE_LIVE_SESSION_TTL_SECONDS,
        'NX',
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Live session settle claim failed');
      return;
    }
    if (first !== 'OK') return;
    const usage = event.usage;
    const costMicro = usage.is_mock ? 0 : usdToMicro(usage.estimated_cost_usd);
    await this.limits.settleCounters(record.userId, record.reservationKey, costMicro);
    try {
      await this.prisma.withUserScope(record.userId, async (tx) => {
        if (costMicro > 0) {
          await this.limits.recordInLedger(tx, {
            userId: record.userId,
            costMicroUsd: costMicro,
            inputTokens: null,
            outputTokens: null,
          });
        }
        await tx.aiInvocation.create({
          data: {
            userId: record.userId,
            messageId: null,
            requestId: record.requestId,
            routeTier: 'AUDIO',
            servedModel: usage.served_model,
            costMicroUsd: BigInt(costMicro),
            latencyMs: Date.now() - record.startedAt,
            isMock: usage.is_mock,
            status:
              usage.status === 'succeeded'
                ? 'completed'
                : usage.status === 'cancelled'
                  ? 'canceled'
                  : 'failed',
            errorCode: usage.reason === 'provider_error' ? 'PROVIDER_ERROR' : null,
          },
        });
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Live session usage ledger write failed');
    }
    try {
      const active = `${ACTIVE_KEY}${record.userId}`;
      if ((await this.redis.client.get(active)) === sessionId) await this.redis.client.del(active);
    } catch (error) {
      this.logger.warn({ err: error }, 'Live session active-claim release failed');
    }
  }
}
