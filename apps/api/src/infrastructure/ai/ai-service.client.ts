import {
  CONTRACT_VERSION,
  INTERNAL_CALLER_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  REQUEST_ID_HEADER,
  aiErrorSchema,
  completionResponseSchema,
  streamEventSchema,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
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
