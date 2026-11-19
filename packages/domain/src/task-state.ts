/**
 * Canonical Responsibility Engine task state machine.
 *
 * Source: product spec §10 TASK-03 reconciled with architecture §4 (see ADR-0003).
 * Only backend code may transition a task; every transition is validated here and
 * persisted with optimistic concurrency (`version`) by the owning service.
 */

export const TASK_STATES = [
  'RECEIVED',
  'UNDERSTANDING',
  'PLANNING',
  'AWAITING_USER_INPUT',
  'AWAITING_APPROVAL',
  'READY_TO_EXECUTE',
  'IN_PROGRESS',
  'AWAITING_EXTERNAL_SERVICE',
  'VERIFYING',
  'COMPLETED_VERIFIED',
  'BLOCKED',
  'PAUSED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'RECOVERY_IN_PROGRESS',
  'ESCALATED',
  'FAILED',
  'REJECTED',
  'EXPIRED',
  'CLOSED_UNRESOLVED',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  'COMPLETED_VERIFIED',
  'FAILED',
  'CANCELLED',
  'REJECTED',
  'CLOSED_UNRESOLVED',
]);

/**
 * States in which no external side effect can be in flight. A task may be cancelled
 * directly only from these states; anything later must go through CANCEL_REQUESTED so
 * the provider state is reconciled first ("a cancellation request is not a cancellation").
 */
export const PRE_EXECUTION_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  'RECEIVED',
  'UNDERSTANDING',
  'PLANNING',
  'AWAITING_USER_INPUT',
  'AWAITING_APPROVAL',
  'READY_TO_EXECUTE',
  'EXPIRED',
]);

const PRIMARY_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  RECEIVED: ['UNDERSTANDING'],
  UNDERSTANDING: ['PLANNING', 'AWAITING_USER_INPUT'],
  PLANNING: ['AWAITING_USER_INPUT', 'AWAITING_APPROVAL', 'READY_TO_EXECUTE'],
  AWAITING_USER_INPUT: ['UNDERSTANDING'],
  AWAITING_APPROVAL: ['READY_TO_EXECUTE', 'REJECTED', 'EXPIRED', 'PLANNING'],
  READY_TO_EXECUTE: ['IN_PROGRESS'],
  IN_PROGRESS: ['AWAITING_EXTERNAL_SERVICE', 'VERIFYING', 'RECOVERY_IN_PROGRESS'],
  AWAITING_EXTERNAL_SERVICE: ['VERIFYING', 'RECOVERY_IN_PROGRESS'],
  VERIFYING: ['COMPLETED_VERIFIED', 'RECOVERY_IN_PROGRESS'],
  RECOVERY_IN_PROGRESS: ['IN_PROGRESS', 'VERIFYING', 'ESCALATED', 'FAILED'],
  BLOCKED: ['AWAITING_USER_INPUT', 'ESCALATED', 'FAILED'],
  // Resuming never jumps straight back into execution: executing work is reconciled first.
  PAUSED: [
    'UNDERSTANDING',
    'PLANNING',
    'AWAITING_USER_INPUT',
    'AWAITING_APPROVAL',
    'READY_TO_EXECUTE',
    'RECOVERY_IN_PROGRESS',
  ],
  CANCEL_REQUESTED: ['CANCELLED', 'RECOVERY_IN_PROGRESS', 'ESCALATED', 'CLOSED_UNRESOLVED'],
  ESCALATED: ['IN_PROGRESS', 'VERIFYING', 'CLOSED_UNRESOLVED'],
  EXPIRED: ['PLANNING'],
  COMPLETED_VERIFIED: [],
  CANCELLED: [],
  FAILED: [],
  REJECTED: [],
  CLOSED_UNRESOLVED: [],
};

/** Interrupt edges available from every non-terminal state (spec: ANY NONTERMINAL → …). */
const INTERRUPT_TARGETS: readonly TaskState[] = ['BLOCKED', 'PAUSED', 'CANCEL_REQUESTED'];

export const isTerminalTaskState = (state: TaskState): boolean => TERMINAL_TASK_STATES.has(state);

export function allowedTransitions(from: TaskState): ReadonlySet<TaskState> {
  const targets = new Set<TaskState>(PRIMARY_TRANSITIONS[from]);
  if (!isTerminalTaskState(from)) {
    for (const t of INTERRUPT_TARGETS) if (t !== from) targets.add(t);
    if (PRE_EXECUTION_STATES.has(from)) targets.add('CANCELLED');
  }
  return targets;
}

export type TransitionRejection =
  | { code: 'TASK_TERMINAL'; from: TaskState }
  | { code: 'TRANSITION_NOT_ALLOWED'; from: TaskState; to: TaskState }
  | { code: 'VERSION_CONFLICT'; expected: number; actual: number }
  | { code: 'EVIDENCE_REQUIRED' }
  | { code: 'APPROVAL_REQUIRED' };

export interface TaskSnapshot {
  readonly state: TaskState;
  readonly version: number;
}

export interface TransitionContext {
  /** Version the caller read; must equal the current version (optimistic concurrency). */
  readonly expectedVersion: number;
  /** Evidence record IDs backing a COMPLETED_VERIFIED transition. */
  readonly evidenceIds?: readonly string[];
  /** Approval that authorises AWAITING_APPROVAL → READY_TO_EXECUTE. */
  readonly approvalId?: string;
}

export type TransitionResult =
  { ok: true; next: TaskSnapshot } | { ok: false; rejection: TransitionRejection };

/**
 * Validate a transition. Pure: persistence (atomic compare-and-set on `version`,
 * append-only task_events row, outbox event) is the caller's job.
 */
export function transitionTask(
  current: TaskSnapshot,
  to: TaskState,
  ctx: TransitionContext,
): TransitionResult {
  if (ctx.expectedVersion !== current.version) {
    return {
      ok: false,
      rejection: {
        code: 'VERSION_CONFLICT',
        expected: ctx.expectedVersion,
        actual: current.version,
      },
    };
  }
  if (isTerminalTaskState(current.state)) {
    return { ok: false, rejection: { code: 'TASK_TERMINAL', from: current.state } };
  }
  if (!allowedTransitions(current.state).has(to)) {
    return { ok: false, rejection: { code: 'TRANSITION_NOT_ALLOWED', from: current.state, to } };
  }
  if (to === 'COMPLETED_VERIFIED' && (ctx.evidenceIds?.length ?? 0) === 0) {
    return { ok: false, rejection: { code: 'EVIDENCE_REQUIRED' } };
  }
  if (current.state === 'AWAITING_APPROVAL' && to === 'READY_TO_EXECUTE' && !ctx.approvalId) {
    return { ok: false, rejection: { code: 'APPROVAL_REQUIRED' } };
  }
  return { ok: true, next: { state: to, version: current.version + 1 } };
}

/**
 * Mapping from the architecture document's state vocabulary to the canonical states,
 * kept so documentation and older drafts remain traceable (ADR-0003).
 */
export const ARCHITECTURE_STATE_ALIASES: Readonly<Record<string, TaskState>> = {
  RESEARCHING: 'PLANNING',
  NEEDS_INFORMATION: 'AWAITING_USER_INPUT',
  PROPOSED: 'AWAITING_APPROVAL',
  WAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'READY_TO_EXECUTE',
  EXECUTING: 'IN_PROGRESS',
  AWAITING_PROVIDER: 'AWAITING_EXTERNAL_SERVICE',
  CANCELLING: 'CANCEL_REQUESTED',
  CANCELLED_VERIFIED: 'CANCELLED',
  FAILED_RECOVERABLE: 'RECOVERY_IN_PROGRESS',
  RECOVERING: 'RECOVERY_IN_PROGRESS',
};
