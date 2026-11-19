import type {
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
