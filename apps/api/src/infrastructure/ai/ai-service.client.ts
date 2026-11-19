import {
  CONTRACT_VERSION,
  INTERNAL_CALLER_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  REQUEST_ID_HEADER,
  aiErrorSchema,
  completionResponseSchema,
  type CompletionRequest,
  type CompletionResponse,
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
  ) {
    super(message);
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

  /** Readiness probe of the AI service (non-critical dependency for the API). */
  async checkReady(timeoutMs = 1_500): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/health/ready`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`ai-service not ready (${response.status})`);
  }
}
