/**
 * Durable-execution contracts shared by the API (starts/signals workflows), the Temporal
 * worker (implements workflows) and the provider worker (implements provider activities).
 * Plain data only — these values cross the Temporal serialization boundary.
 */
import type { Money } from '@karen/types';
import type { ProviderCapability } from './provider.js';
import type { TaskState } from './task-state.js';

export const TASK_QUEUES = {
  /** Responsibility Engine workflows + internal activities (apps/temporal-worker). */
  TASKS: 'karen-tasks',
  /** Provider adapter activities (apps/provider-worker). */
  PROVIDER_OPERATIONS: 'karen-provider-ops',
} as const;

export const WORKFLOW_TYPES = { ACTION_EXECUTION: 'actionExecutionWorkflow' } as const;

export const SIGNALS = {
  APPROVAL_DECISION: 'approvalDecision',
  CANCEL_REQUESTED: 'cancelRequested',
} as const;
export const QUERIES = { TASK_STATUS: 'taskStatus' } as const;

/** Workflow IDs are deterministic per task step so a duplicate start is rejected, not re-run. */
export const actionWorkflowId = (taskId: string, stepId: string): string =>
  `task:${taskId}:step:${stepId}`;

export interface ActionExecutionInput {
  taskId: string;
  stepId: string;
  userId: string;
  providerId: string;
  operation: Extract<ProviderCapability, 'reserve' | 'confirm' | 'cancel' | 'refund'>;
  /** Untrusted (possibly model-proposed) category — classified by policy in code. */
  actionCategory: string;
  /** Normalised action payload; its hash is what the user approves. */
  payload: Record<string, unknown>;
  payloadHash: string;
  total: Money;
  /** Server-verified facts captured by the API when the task was accepted. */
  consentGranted: boolean;
  /** How long to wait for the user's decision before the approval expires. */
  approvalTimeoutMs: number;
}

export interface ApprovalDecisionSignal {
  approvalId: string;
  decision: 'APPROVE' | 'REJECT';
  /**
   * Subject the approval was issued for, copied from the stored approval record by the API.
   * The workflow compares these with its own input, so an approval for another user, task,
   * action or provider can never authorise this execution.
   */
  userId: string;
  taskId: string;
  actionType: string;
  providerId: string;
  /** Must equal the workflow's payloadHash: a material change invalidates the approval. */
  payloadHash: string;
  maximumTotal: Money;
  expiresAt: string;
  assurance: 'SESSION' | 'STEP_UP';
}

export interface ProviderOperationRequest {
  providerId: string;
  operation: ActionExecutionInput['operation'];
  idempotencyKey: string;
  payload: Record<string, unknown>;
  total: Money;
}

export type ProviderOperationOutcome =
  | {
      kind: 'ACCEPTED';
      providerOperationId: string;
      providerReference: string;
      environment: 'SANDBOX' | 'PRODUCTION';
    }
  | { kind: 'REJECTED'; reason: string };

export interface ProviderStatusResult {
  providerOperationId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN';
  providerReference: string | null;
  checkedAt: string;
  environment: 'SANDBOX' | 'PRODUCTION';
}

export interface TaskStatusView {
  state: TaskState;
  version: number;
  history: { from: TaskState; to: TaskState; reason: string }[];
  evidence: { method: string; reference: string; checkedAt: string; environment: string }[];
}

export interface ActionExecutionResult {
  finalState: TaskState;
  providerOperationId: string | null;
  evidence: TaskStatusView['evidence'];
}

/** Error type names used across worker boundaries (Temporal ApplicationFailure types). */
export const FAILURE_TYPES = {
  /** Provider timed out or returned an ambiguous response; MUST reconcile before any retry. */
  PROVIDER_AMBIGUOUS: 'ProviderAmbiguousError',
  PROVIDER_REJECTED: 'ProviderRejectedError',
  CAPABILITY_UNAVAILABLE: 'ProviderCapabilityUnavailableError',
  POLICY_DENIED: 'PolicyDeniedError',
  /** Global kill switch (KAREN_EXECUTION_PAUSED) refused a side effect; nothing was dispatched. */
  EXECUTION_PAUSED: 'ExecutionPausedError',
} as const;

// ── Data rights (Phase 01 M7) ──────────────────────────────────────────────────────────────

/**
 * Durable data-rights workflows. Inputs carry ONLY request ids and timestamps — never personal
 * data — because Temporal history is retained outside our deletion guarantees. The worker has no
 * database access: each step is a signed internal call to the API (ADR-0007).
 */
export const DATA_RIGHTS_WORKFLOWS = {
  EXPORT: 'dataExportWorkflow',
  DELETION: 'accountDeletionWorkflow',
} as const;

export const dataRightsWorkflowId = (kind: 'export' | 'deletion', requestId: string) =>
  `karen-data-${kind}-${requestId}`;

export interface DataExportWorkflowInput {
  requestId: string;
}
export interface AccountDeletionWorkflowInput {
  requestId: string;
  /**
   * Seconds until the cancellation window ends, computed by the API (which owns the clock).
   * Workflows never read the clock; the API's `not_due` answer guards against any skew.
   */
  waitSeconds: number;
}

/** Result of the API's internal export step. */
export type ExportStepOutcome = 'ready' | 'cancelled' | 'already_done';
/** What the export step tells the workflow: the outcome and when the download expires. */
export interface ExportStepResult {
  outcome: ExportStepOutcome;
  /** Seconds until the download expires (computed by the API); null when not ready. */
  expiresInSeconds: number | null;
}
/** Result of the API's internal erasure step. `not_due`: the window has not ended yet. */
export type ErasureStepOutcome = 'completed' | 'cancelled' | 'not_due';

/** Internal API routes called by the worker (signed; never exposed publicly). */
export const INTERNAL_DATA_RIGHTS_PATHS = {
  buildExport: (requestId: string) => `/internal/v1/data-rights/${requestId}/export`,
  executeErasure: (requestId: string) => `/internal/v1/data-rights/${requestId}/erase`,
  expireExport: (requestId: string) => `/internal/v1/data-rights/${requestId}/expire-export`,
} as const;

/** Result of expiring an export download (payload purged). */
export type ExportExpiryOutcome = 'expired' | 'not_due' | 'already_done';
