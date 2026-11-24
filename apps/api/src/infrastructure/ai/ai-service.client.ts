import {
  CONTRACT_VERSION,
  INTERNAL_CALLER_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  REQUEST_ID_HEADER,
  aiErrorSchema,
  completionRequestSchema,
  completionResponseSchema,
  memoryExtractRequestSchema,
  memoryExtractResponseSchema,
  streamEventSchema,
  type CompletionRequest,
  type CompletionResponse,
  type MemoryExtractRequest,
  type MemoryExtractResponse,
  type StreamEvent,
} from '@karen/ai-model-contracts';
import { internalRequestSigningString, signTimestamped } from '@karen/domain/node';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENV } from '../../config/config.module.js';
import type { ApiEnv } from '../../config/env.js';

/**
 * Validates an outgoing completion request against the contract BEFORE it leaves the API (v5:
 * memory fields, character policy, status rules). A violation is a programming error here, never
 * sent to the AI service; the field path is reported, never the content.
 */
function outgoingCompletion(input: CompletionInput): string {
  const parsed = completionRequestSchema.safeParse({
    contract_version: CONTRACT_VERSION,
    ...input,
  });
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw new AiServiceError(
      'VALIDATION_ERROR',
      `Outgoing completion request violates the contract at: ${where}`,
      false,
      null,
    );
  }
  return JSON.stringify(parsed.data);
}

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

  /**
   * Phase 03 (M5a): `POST /internal/v1/memory/extract` — candidate PROPOSALS for one user message.
   * The request is validated before sending, the response is validated as UNTRUSTED input (the
   * caller still re-validates every candidate, V1–V12). Timeout ≤ 30 s. Errors carry codes and
   * HTTP status only — never message or candidate text. Retryable: network, timeout, 5xx, 429;
   * non-retryable: 4xx and contract violations.
   */
  async extractMemory(
    input: Omit<MemoryExtractRequest, 'contract_version'>,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<MemoryExtractResponse> {
    const path = '/internal/v1/memory/extract';
    const outgoing = memoryExtractRequestSchema.safeParse({
      contract_version: CONTRACT_VERSION,
      ...input,
    });
    if (!outgoing.success) {
      const where = outgoing.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
      throw new AiServiceError(
        'VALIDATION_ERROR',
        `Outgoing extract request invalid at: ${where}`,
        false,
        null,
      );
    }
    const body = JSON.stringify(outgoing.data);
    const timeout = AbortSignal.timeout(Math.min(options.timeoutMs ?? 30_000, 30_000));
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.signedHeaders('POST', path, body, input.request_id),
        body,
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
    } catch {
      throw new AiServiceError('AI_SERVICE_UNREACHABLE', 'AI service request failed', true, null);
    }
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const err = aiErrorSchema.safeParse(json);
      const retryable = response.status >= 500 || response.status === 429;
      throw new AiServiceError(
        err.success ? err.data.error.code : 'AI_SERVICE_BAD_RESPONSE',
        err.success ? err.data.error.message : `AI service returned ${response.status}`,
        err.success ? err.data.error.retryable : retryable,
        response.status,
      );
    }
    const parsed = memoryExtractResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.request_id !== input.request_id) {
      throw new AiServiceError(
        'AI_SERVICE_CONTRACT_VIOLATION',
        'AI service extract response violated the contract',
        false,
        response.status,
      );
    }
    return parsed.data;
  }

  async complete(
    input: CompletionInput,
    options: { timeoutMs?: number } = {},
  ): Promise<CompletionResponse> {
    const path = '/internal/v1/completions';
    const body = outgoingCompletion(input);
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
    const body = outgoingCompletion(input);
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
