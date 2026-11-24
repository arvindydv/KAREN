import { INTERNAL_CALLER_HEADER, INTERNAL_SIGNATURE_HEADER } from '@karen/ai-model-contracts';
import { INTERNAL_MEMORY_PATHS } from '@karen/domain';
import { internalRequestSigningString, signTimestamped } from '@karen/domain/node';
import { ApplicationFailure } from '@temporalio/common';
import type { MemoryActivities } from './types.js';

export interface MemoryActivityOptions {
  apiBaseUrl: string;
  secret: string | undefined;
  fetchImpl?: typeof fetch;
  /** Must stay below the activity startToCloseTimeout (90 s); see memory.workflow.ts. */
  timeoutMs?: number;
}

export const MEMORY_HTTP_TIMEOUT_MS = 85_000;

/**
 * Signed worker → API calls for memory extraction (ADR-0007). Classification: 2xx → result;
 * 4xx (except 408/429) → non-retryable `InternalCallRejected` (unknown job, bad signature: a
 * retry cannot help); 5xx/408/429/network/timeout → retryable. Never logs or forwards bodies.
 */
export function createMemoryActivities(options: MemoryActivityOptions): MemoryActivities {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = options.apiBaseUrl.replace(/\/$/, '');

  async function call(path: string): Promise<{ outcome: string }> {
    if (!options.secret) {
      throw ApplicationFailure.nonRetryable(
        'INTERNAL_SERVICE_HMAC_SECRET is not configured',
        'ConfigError',
      );
    }
    const signature = signTimestamped(
      options.secret,
      internalRequestSigningString('POST', path, ''),
      Math.floor(Date.now() / 1000),
    );
    const response = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        [INTERNAL_SIGNATURE_HEADER]: signature,
        [INTERNAL_CALLER_HEADER]: 'karen-temporal-worker',
      },
      signal: AbortSignal.timeout(
        Math.min(options.timeoutMs ?? MEMORY_HTTP_TIMEOUT_MS, MEMORY_HTTP_TIMEOUT_MS),
      ),
    });
    const safePath = path.replace(/[0-9a-f-]{36}/, ':id');
    if (response.ok) {
      const body = (await response.json()) as { outcome?: unknown };
      if (typeof body.outcome !== 'string' || !/^[a-z_]{1,40}$/.test(body.outcome)) {
        throw ApplicationFailure.nonRetryable(
          `internal call ${safePath} returned no outcome`,
          'InternalCallRejected',
        );
      }
      return { outcome: body.outcome };
    }
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    const message = `internal call ${safePath} failed with ${response.status}`;
    if (retryable) throw new Error(message);
    throw ApplicationFailure.nonRetryable(message, 'InternalCallRejected');
  }

  return {
    runMemoryExtraction: (jobId) => call(INTERNAL_MEMORY_PATHS.runExtractionJob(jobId)),
    abandonMemoryExtraction: (jobId) => call(INTERNAL_MEMORY_PATHS.abandonExtractionJob(jobId)),
  };
}
