import {
  CONTRACT_VERSION,
  INTERNAL_CALLER_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  REQUEST_ID_HEADER,
  SPEECH_RESPONSE_HEADERS,
  aiErrorSchema,
  completionResponseSchema,
  liveEventSchema,
  liveSessionStartResponseSchema,
  voiceCatalogResponseSchema,
  streamEventSchema,
  transcriptionResponseSchema,
  type CompletionRequest,
  type CompletionResponse,
  type LiveEvent,
  type LiveSessionStartRequest,
  type LiveSessionStartResponse,
  type VoiceCatalogResponse,
  type SpeechLanguage,
  type SpeechRequest,
  type StreamEvent,
  type TranscriptionRequest,
  type TranscriptionResponse,
} from '@karen/ai-model-contracts';
import { internalRequestSigningString, signTimestamped } from '@karen/domain/node';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENV } from '../../config/config.module.js';
import type { ApiEnv } from '../../config/env.js';

export class AiServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiServiceError';
  }
}

export type CompletionInput = Omit<CompletionRequest, 'contract_version'>;
export type TranscriptionInput = Omit<TranscriptionRequest, 'contract_version'>;
export type SpeechInput = Omit<SpeechRequest, 'contract_version'>;
export type LiveSessionInput = Omit<LiveSessionStartRequest, 'contract_version'>;
/** One live-session event plus its resume cursor (SSE `id:`). */
export interface LiveEventFrame {
  readonly id: string | null;
  readonly event: LiveEvent;
}

/** Streamed speech audio plus the voice metadata the AI service chose (never the text). */
export interface SpeechAudio {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly voiceId: string | null;
  readonly language: SpeechLanguage | null;
  readonly isMock: boolean;
  readonly textTruncated: boolean;
  /** Worst-case cost the AI service reserved (speech usage is not reported upstream). */
  readonly estimatedCostUsd: number | null;
}

const SPEECH_LANGUAGE_VALUES: readonly string[] = ['en', 'hi', 'hi-Latn'];

/**
 * Internal client for apps/ai-service. Requests are signed (HMAC, timestamped) so the AI
 * service can reject unauthenticated callers; see docs/security/internal-service-auth.md.
 * The API never talks to the model gateway directly.
 */
@Injectable()
export class AiServiceClient {
  private readonly baseUrl: string;
  private readonly secret: string | undefined;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.baseUrl = env.AI_SERVICE_URL.replace(/\/$/, '');
    this.secret = env.INTERNAL_SERVICE_HMAC_SECRET;
  }

  /** Headers for a signed internal request (exported for tests and SSE callers). */
  signedHeaders(
    method: string,
    pathWithQuery: string,
    body: string,
    requestId: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [INTERNAL_CALLER_HEADER]: 'karen-api',
      [REQUEST_ID_HEADER]: requestId,
    };
    if (this.secret) {
      headers[INTERNAL_SIGNATURE_HEADER] = signTimestamped(
        this.secret,
        internalRequestSigningString(method, pathWithQuery, body),
        Math.floor(Date.now() / 1000),
      );
    }
    return headers;
  }

  /** Signed POST returning the raw response; maps transport and envelope errors uniformly. */
  private async post(
    path: string,
    payload: Record<string, unknown> & { request_id: string },
    options: { timeoutMs?: number; signal?: AbortSignal },
    omitFromBody: readonly string[] = [],
  ): Promise<Response> {
    const wire: Record<string, unknown> = { contract_version: CONTRACT_VERSION, ...payload };
    for (const key of omitFromBody) delete wire[key];
    const body = JSON.stringify(wire);
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.signedHeaders('POST', path, body, payload.request_id),
        body,
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
    } catch {
      throw new AiServiceError('AI_SERVICE_UNREACHABLE', 'AI service request failed', true, null);
    }
    if (!response.ok) throw await errorFrom(response);
    return response;
  }

  /** Speech-to-text for a voice command. The audio is not stored anywhere. */
  async transcribe(
    input: TranscriptionInput,
    options: { timeoutMs?: number } = {},
  ): Promise<TranscriptionResponse> {
    const response = await this.post('/internal/v1/audio/transcriptions', input, options);
    const parsed = transcriptionResponseSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!parsed.success) {
      throw new AiServiceError(
        'AI_SERVICE_CONTRACT_VIOLATION',
        'AI service response violated the contract',
        false,
        response.status,
      );
    }
    return parsed.data;
  }

  /**
   * Text-to-speech: returns as soon as audio starts. Aborting `signal` (the listener left or
   * interrupted) cancels the upstream synthesis, so no further sentences are generated.
   */
  async speech(
    input: SpeechInput,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<SpeechAudio> {
    const response = await this.post('/internal/v1/audio/speech', input, options);
    if (!response.body) {
      throw new AiServiceError('AI_SERVICE_BAD_RESPONSE', 'AI service sent no audio', true, 200);
    }
    const header = (name: string): string | null => response.headers.get(name);
    const language = header(SPEECH_RESPONSE_HEADERS.language);
    const cost = Number(header(SPEECH_RESPONSE_HEADERS.estimatedCostUsd));
    return {
      body: response.body,
      contentType: header('content-type') ?? 'application/octet-stream',
      voiceId: header(SPEECH_RESPONSE_HEADERS.voiceId),
      language:
        language && SPEECH_LANGUAGE_VALUES.includes(language) ? (language as SpeechLanguage) : null,
      isMock: header(SPEECH_RESPONSE_HEADERS.isMock) === 'true',
      textTruncated: header(SPEECH_RESPONSE_HEADERS.textTruncated) === 'true',
      estimatedCostUsd: Number.isFinite(cost) && cost >= 0 ? cost : null,
    };
  }

  async complete(
    input: CompletionInput,
    options: { timeoutMs?: number } = {},
  ): Promise<CompletionResponse> {
    const path = '/internal/v1/completions';
    const body = JSON.stringify({ contract_version: CONTRACT_VERSION, ...input });
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.signedHeaders('POST', path, body, input.request_id),
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch {
      throw new AiServiceError('AI_SERVICE_UNREACHABLE', 'AI service request failed', true, null);
    }
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = aiErrorSchema.safeParse(json);
      if (parsed.success) {
        throw new AiServiceError(
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.retryable,
          response.status,
        );
      }
      throw new AiServiceError(
        'AI_SERVICE_BAD_RESPONSE',
        `AI service returned ${response.status}`,
        response.status >= 500,
        response.status,
      );
    }
    const parsed = completionResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new AiServiceError(
        'AI_SERVICE_CONTRACT_VIOLATION',
        'AI service response violated the contract',
        false,
        response.status,
      );
    }
    return parsed.data;
  }

  /**
   * Streams `/internal/v1/completions/stream`. Refusals before the stream starts (tier,
   * capability, budget) throw `AiServiceError`; afterwards failures arrive as a terminal
   * `error` event. Frames that violate the contract end the stream with
   * `AI_SERVICE_CONTRACT_VIOLATION`. Never retried here: an interrupted stream is surfaced,
   * not replayed (architecture §2.5).
   */
  async *stream(
    input: CompletionInput,
    options: { signal?: AbortSignal; connectTimeoutMs?: number } = {},
  ): AsyncGenerator<StreamEvent> {
    const path = '/internal/v1/completions/stream';
    const body = JSON.stringify({ contract_version: CONTRACT_VERSION, ...input });
    const connectTimeout = AbortSignal.timeout(options.connectTimeoutMs ?? 15_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, connectTimeout])
      : connectTimeout;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          ...this.signedHeaders('POST', path, body, input.request_id),
          accept: 'text/event-stream',
        },
        body,
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new AiServiceError('AI_SERVICE_UNREACHABLE', 'AI service request failed', true, null);
    }
    if (!response.ok || !response.body) {
      const json: unknown = await response.json().catch(() => undefined);
      const parsed = aiErrorSchema.safeParse(json);
      if (parsed.success) {
        throw new AiServiceError(
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.retryable,
          response.status,
        );
      }
      throw new AiServiceError(
        'AI_SERVICE_BAD_RESPONSE',
        `AI service returned ${response.status}`,
        response.status >= 500,
        response.status,
      );
    }
    // Once headers arrived, only the caller's signal (cancel / overall timeout) may abort.
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const abort = () => void reader.cancel().catch(() => undefined);
    options.signal?.addEventListener('abort', abort, { once: true });
    const frames = async function* () {
      try {
        yield* sseDataFrames(reader);
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        // Socket reset / body terminated after the stream started: an interrupted stream.
        throw new AiServiceError(
          'AI_SERVICE_STREAM_DROPPED',
          'AI service stream was interrupted',
          true,
          response.status,
          { cause: error },
        );
      }
    };
    try {
      for await (const data of frames()) {
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          json = undefined;
        }
        const parsed = streamEventSchema.safeParse(json);
        if (!parsed.success) {
          throw new AiServiceError(
            'AI_SERVICE_CONTRACT_VIOLATION',
            'AI service stream violated the contract',
            false,
            response.status,
          );
        }
        yield parsed.data;
        if (parsed.data.event === 'done' || parsed.data.event === 'error') return;
      }
      if (options.signal?.aborted) throw options.signal.reason;
      throw new AiServiceError(
        'AI_SERVICE_STREAM_DROPPED',
        'AI service stream ended without a terminal event',
        true,
        response.status,
      );
    } finally {
      options.signal?.removeEventListener('abort', abort);
      abort();
    }
  }

  /** Readiness probe of the AI service (non-critical dependency for the API). */
  async checkReady(timeoutMs = 1_500): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/health/ready`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`ai-service not ready (${response.status})`);
  }

  private modeCache: { mode: 'mock' | 'live'; at: number } | null = null;

  // ------------------------------------------------------------------ voice (ADR-0027)

  private voicesCache: { value: VoiceCatalogResponse; at: number } | null = null;

  /** Signed GET; the signature covers the path and query (no body). */
  private async signedGet(pathWithQuery: string, requestId: string, signal: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathWithQuery}`, {
        method: 'GET',
        headers: this.signedHeaders('GET', pathWithQuery, '', requestId),
        signal,
      });
    } catch {
      throw new AiServiceError('AI_SERVICE_UNREACHABLE', 'AI service request failed', true, null);
    }
    if (!response.ok) throw await errorFrom(response);
    return response;
  }

  /** The usable voice catalog (cached for a minute; voices change only on redeploy). */
  async voices(requestId: string): Promise<VoiceCatalogResponse> {
    if (this.voicesCache && Date.now() - this.voicesCache.at < 60_000) {
      return this.voicesCache.value;
    }
    const response = await this.signedGet(
      '/internal/v1/audio/voices',
      requestId,
      AbortSignal.timeout(5_000),
    );
    const parsed = voiceCatalogResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new AiServiceError(
        'AI_SERVICE_CONTRACT_VIOLATION',
        'Invalid voice catalog',
        false,
        200,
      );
    }
    this.voicesCache = { value: parsed.data, at: Date.now() };
    return parsed.data;
  }

  async startLiveSession(input: LiveSessionInput): Promise<LiveSessionStartResponse> {
    const response = await this.post('/internal/v1/audio/live-sessions', input, {
      timeoutMs: 20_000,
    });
    const parsed = liveSessionStartResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new AiServiceError('AI_SERVICE_CONTRACT_VIOLATION', 'Invalid live session', false, 200);
    }
    return parsed.data;
  }

  async appendLiveAudio(
    sessionId: string,
    input: { user_ref: string; seq: number; audio_base64: string },
    requestId: string,
  ): Promise<void> {
    await this.post(
      `/internal/v1/audio/live-sessions/${sessionId}/audio`,
      { ...input, request_id: requestId },
      { timeoutMs: 5_000 },
      ['request_id'],
    );
  }

  async closeLiveSession(sessionId: string, userRef: string, requestId: string): Promise<void> {
    await this.post(
      `/internal/v1/audio/live-sessions/${sessionId}/close`,
      { user_ref: userRef, request_id: requestId },
      { timeoutMs: 5_000 },
      ['request_id'],
    );
  }

  /**
   * Live-session events (SSE). Refusals (unknown/foreign session) throw before the first event;
   * the stream ends after `closed` or when `signal` aborts (the listener left).
   */
  async *liveEvents(
    sessionId: string,
    userRef: string,
    after: string | null,
    requestId: string,
    signal: AbortSignal,
  ): AsyncGenerator<LiveEventFrame> {
    const query = new URLSearchParams({ user_ref: userRef });
    if (after) query.set('after', after);
    const path = `/internal/v1/audio/live-sessions/${sessionId}/events?${query.toString()}`;
    const connect = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const response = await this.signedGet(path, requestId, connect);
    if (!response.body) {
      throw new AiServiceError('AI_SERVICE_BAD_RESPONSE', 'Live events without a body', true, 200);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const abort = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener('abort', abort, { once: true });
    try {
      for await (const frame of sseFrames(reader)) {
        let json: unknown;
        try {
          json = JSON.parse(frame.data);
        } catch {
          json = undefined;
        }
        const parsed = liveEventSchema.safeParse(json);
        if (!parsed.success) {
          throw new AiServiceError(
            'AI_SERVICE_CONTRACT_VIOLATION',
            'Live event violated the contract',
            false,
            200,
          );
        }
        yield { id: frame.id, event: parsed.data };
        if (parsed.data.type === 'closed') return;
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof AiServiceError) throw error;
      throw new AiServiceError('AI_SERVICE_STREAM_DROPPED', 'Live events interrupted', true, 200, {
        cause: error,
      });
    } finally {
      signal.removeEventListener('abort', abort);
      abort();
    }
  }

  /**
   * The AI service's gateway mode (from its readiness body), cached for a minute. Unknown
   * (unreachable) is reported as `mock` = "not a live, billed answer" — never the reverse.
   */
  async gatewayMode(): Promise<'mock' | 'live'> {
    if (this.modeCache && Date.now() - this.modeCache.at < 60_000) return this.modeCache.mode;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(1_500),
      });
      const body = (await response.json()) as { gateway_mode?: unknown };
      const mode = body.gateway_mode === 'live' ? 'live' : 'mock';
      this.modeCache = { mode, at: Date.now() };
      return mode;
    } catch {
      return 'mock';
    }
  }
}

/** Yields the `data:` payload of each SSE frame (multi-line data joined with "\n"). */
export async function* sseDataFrames(
  reader: ReadableStreamDefaultReader<string>,
): AsyncGenerator<string> {
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value.replace(/\r\n?/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
        .join('\n');
      if (data) yield data;
      boundary = buffer.indexOf('\n\n');
    }
  }
}

/** Maps a non-2xx AI-service response to a typed error (never echoes upstream text to users). */
async function errorFrom(response: Response): Promise<AiServiceError> {
  const json: unknown = await response.json().catch(() => undefined);
  const parsed = aiErrorSchema.safeParse(json);
  if (parsed.success) {
    return new AiServiceError(
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.retryable,
      response.status,
    );
  }
  return new AiServiceError(
    'AI_SERVICE_BAD_RESPONSE',
    `AI service returned ${response.status}`,
    response.status >= 500,
    response.status,
  );
}

/** SSE frames with their `id:` (resume cursor) and joined `data:` payload. */
export async function* sseFrames(
  reader: ReadableStreamDefaultReader<string>,
): AsyncGenerator<{ id: string | null; data: string }> {
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value.replace(/\r\n?/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const lines = buffer.slice(0, boundary).split('\n');
      buffer = buffer.slice(boundary + 2);
      const idLine = lines.find((line) => line.startsWith('id:'));
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
        .join('\n');
      if (data) yield { id: idLine ? idLine.slice(3).trim() : null, data };
      boundary = buffer.indexOf('\n\n');
    }
  }
}
