/**
 * Temporal activities on task queue karen-provider-ops. Errors are mapped to typed,
 * non-retryable ApplicationFailures where retrying would be unsafe or pointless.
 */
import {
  FAILURE_TYPES,
  ProviderCapabilityUnavailableError,
  type ProviderOperationRequest,
} from '@karen/domain';
import { ApplicationFailure } from '@temporalio/common';
import { ProviderAmbiguousError } from './adapters/contract.js';
import type { ProviderRegistry } from './adapters/registry.js';

export function createProviderActivities(registry: ProviderRegistry) {
  return {
    async executeProviderOperation(request: ProviderOperationRequest) {
      try {
        const adapter = registry.require(request.providerId, request.operation);
        if (!adapter.execute)
          throw new ProviderCapabilityUnavailableError(request.providerId, request.operation);
        return await adapter.execute(request);
      } catch (error) {
        if (error instanceof ProviderAmbiguousError) {
          throw ApplicationFailure.nonRetryable(error.message, FAILURE_TYPES.PROVIDER_AMBIGUOUS);
        }
        if (error instanceof ProviderCapabilityUnavailableError) {
          throw ApplicationFailure.nonRetryable(
            error.message,
            FAILURE_TYPES.CAPABILITY_UNAVAILABLE,
          );
        }
        throw error;
      }
    },
    async getProviderOperationStatus(input: { providerId: string; idempotencyKey: string }) {
      const adapter = registry.require(input.providerId, 'status');
      if (!adapter.status) throw new ProviderCapabilityUnavailableError(input.providerId, 'status');
      return adapter.status(input.idempotencyKey);
    },
  };
}
