import { INTERNAL_CALLER_HEADER, INTERNAL_SIGNATURE_HEADER } from '@karen/ai-model-contracts';
import {
  type ErasureStepOutcome,
  type ExportExpiryOutcome,
  type ExportStepResult,
  INTERNAL_DATA_RIGHTS_PATHS,
} from '@karen/domain';
import { internalRequestSigningString, signTimestamped } from '@karen/domain/node';
import { ApplicationFailure } from '@temporalio/common';
import type { DataRightsActivities } from './types.js';

export interface DataRightsActivityOptions {
  apiBaseUrl: string;
  secret: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Signed internal calls to the API (ADR-0007). Classification for Temporal's retry policy:
 *  - 2xx → result; 4xx (except 408/429) → non-retryable failure (a bug or a gone request —
 *    retrying cannot help, and it surfaces for an operator); 5xx/408/429/network → retryable.
 * Logs and errors never include response bodies (they may describe user data).
 */
export function createDataRightsActivities(
  options: DataRightsActivityOptions,
): DataRightsActivities {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = options.apiBaseUrl.replace(/\/$/, '');

  async function call<T>(path: string): Promise<T> {
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
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (response.ok) return (await response.json()) as T;
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    const message = `internal call ${path.replace(/[0-9a-f-]{36}/, ':id')} failed with ${response.status}`;
    if (retryable) throw new Error(message);
    throw ApplicationFailure.nonRetryable(message, 'InternalCallRejected');
  }

  return {
    buildExport: (requestId) =>
      call<ExportStepResult>(INTERNAL_DATA_RIGHTS_PATHS.buildExport(requestId)),
    expireExport: async (requestId) =>
      (
        await call<{ outcome: ExportExpiryOutcome }>(
          INTERNAL_DATA_RIGHTS_PATHS.expireExport(requestId),
        )
      ).outcome,
    executeErasure: async (requestId) =>
      (
        await call<{ outcome: ErasureStepOutcome }>(
          INTERNAL_DATA_RIGHTS_PATHS.executeErasure(requestId),
        )
      ).outcome,
  };
}
