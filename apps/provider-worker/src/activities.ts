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

export interface ProviderActivityOptions {
  /**
   * Global kill switch (KAREN_EXECUTION_PAUSED). Checked on every side-effecting call, at the
   * last point before the provider is contacted, so already-approved workflows are held too.
   * Read-only status checks keep working so open operations can still be reconciled.
   */
  executionPaused?: () => boolean;
}

export function createProviderActivities(
  registry: ProviderRegistry,
  options: ProviderActivityOptions = {},
) {
  return {
    async executeProviderOperation(request: ProviderOperationRequest) {
      if (options.executionPaused?.() === true) {
        throw ApplicationFailure.nonRetryable(
          'Execution is paused (kill switch); operation not dispatched',
          FAILURE_TYPES.EXECUTION_PAUSED,
        );
      }
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
