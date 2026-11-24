import type {
  ErasureStepOutcome,
  ExportExpiryOutcome,
  ExportStepResult,
  ProviderOperationOutcome,
  ProviderOperationRequest,
  ProviderStatusResult,
  TaskState,
} from '@karen/domain';

/** Activities implemented by THIS worker (task queue karen-tasks). */
export interface TaskActivities {
  /**
   * Records a task state transition. Foundation implementation: structured log only.
   * The Tasks feature (build step 07) replaces this with an append-only task_events write
   * via the API's task module. Must stay idempotent (keyed by workflowId + version).
   */
  recordTaskTransition(input: {
    taskId: string;
    from: TaskState;
    to: TaskState;
    version: number;
    reason: string;
  }): Promise<void>;
}

/** Activities implemented by apps/provider-worker (task queue karen-provider-ops). */
export interface ProviderActivities {
  executeProviderOperation(request: ProviderOperationRequest): Promise<ProviderOperationOutcome>;
  getProviderOperationStatus(input: {
    providerId: string;
    idempotencyKey: string;
  }): Promise<ProviderStatusResult>;
}

/**
 * Data-rights workflow steps (Phase 01 M7). Each is a signed internal call to the API, which
 * owns the data; all are idempotent so Temporal retries are safe. Inputs are request ids only.
 */
export interface DataRightsActivities {
  buildExport(requestId: string): Promise<ExportStepResult>;
  expireExport(requestId: string): Promise<ExportExpiryOutcome>;
  executeErasure(requestId: string): Promise<ErasureStepOutcome>;
}

/**
 * Phase 03 memory extraction (ADR-0036 §8.3): signed calls back to the API. Inputs are job ids,
 * results are content-free outcome codes.
 */
export interface MemoryActivities {
  runMemoryExtraction(jobId: string): Promise<{ outcome: string }>;
  abandonMemoryExtraction(jobId: string): Promise<{ outcome: string }>;
}
