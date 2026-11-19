/**
 * Responsibility Engine example workflow: one approval-gated provider action, executed at
 * most once per idempotency key, verified before completion.
 *
 * Invariants enforced here (architecture §4, product spec §10/§12):
 *  - Policy is decided in code; the (possibly model-proposed) category is untrusted.
 *  - HIGH/MEDIUM risk needs an approval whose payload hash, amount cap and expiry match.
 *  - Side effects run on the provider worker with a stable idempotency key.
 *  - An ambiguous provider result is RECONCILED via status before anything else happens —
 *    never blindly retried.
 *  - COMPLETED_VERIFIED requires evidence; otherwise the task escalates honestly.
 *
 * Versioning: change behaviour of running workflows only behind `patched('<change-id>')`
 * (docs/runbooks/temporal-workflow-versioning.md).
 */
import {
  FAILURE_TYPES,
  QUERIES,
  SIGNALS,
  TASK_QUEUES,
  buildIdempotencyKey,
  decideExecution,
  transitionTask,
  verifyExecutionAgainstApproval,
  type ActionExecutionInput,
  type ActionExecutionResult,
  type ApprovalDecisionSignal,
  type TaskState,
  type TaskStatusView,
} from '@karen/domain';
import {
  ActivityFailure,
  ApplicationFailure,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type { ProviderActivities, TaskActivities } from '../activities/types.js';

export const approvalDecisionSignal = defineSignal<[ApprovalDecisionSignal]>(
  SIGNALS.APPROVAL_DECISION,
);
export const taskStatusQuery = defineQuery<TaskStatusView>(QUERIES.TASK_STATUS);

const taskActivities = proxyActivities<TaskActivities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 5, initialInterval: '1 second', backoffCoefficient: 2 },
});

/** Side-effecting call: retried only when the provider reports a transient, non-ambiguous failure. */
const providerExecute = proxyActivities<Pick<ProviderActivities, 'executeProviderOperation'>>({
  taskQueue: TASK_QUEUES.PROVIDER_OPERATIONS,
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    nonRetryableErrorTypes: [
      FAILURE_TYPES.PROVIDER_AMBIGUOUS,
      FAILURE_TYPES.PROVIDER_REJECTED,
      FAILURE_TYPES.CAPABILITY_UNAVAILABLE,
    ],
  },
});

/** Read-only status checks are safe to retry generously. */
const providerStatus = proxyActivities<Pick<ProviderActivities, 'getProviderOperationStatus'>>({
  taskQueue: TASK_QUEUES.PROVIDER_OPERATIONS,
  startToCloseTimeout: '15 seconds',
  retry: { maximumAttempts: 10, initialInterval: '2 seconds', maximumInterval: '1 minute' },
});

export async function actionExecutionWorkflow(
  input: ActionExecutionInput,
): Promise<ActionExecutionResult> {
  const status: TaskStatusView = { state: 'RECEIVED', version: 0, history: [], evidence: [] };
  let approval: ApprovalDecisionSignal | undefined;

  setHandler(taskStatusQuery, () => status);
  setHandler(approvalDecisionSignal, (signal) => {
    // First decision wins; later signals cannot overwrite an approval.
    approval ??= signal;
  });

  const moveTo = async (
    to: TaskState,
    reason: string,
    ctx: { approvalId?: string; evidenceIds?: string[] } = {},
  ) => {
    const result = transitionTask({ state: status.state, version: status.version }, to, {
      expectedVersion: status.version,
      ...ctx,
    });
    if (!result.ok) {
      throw ApplicationFailure.nonRetryable(
        `Illegal transition: ${JSON.stringify(result.rejection)}`,
        'IllegalTransition',
      );
    }
    status.history.push({ from: status.state, to, reason });
    await taskActivities.recordTaskTransition({
      taskId: input.taskId,
      from: status.state,
      to,
      version: result.next.version,
      reason,
    });
    status.state = result.next.state;
    status.version = result.next.version;
  };
  const finish = (providerOperationId: string | null): ActionExecutionResult => ({
    finalState: status.state,
    providerOperationId,
    evidence: status.evidence,
  });

  await moveTo('UNDERSTANDING', 'workflow started');
  await moveTo('PLANNING', 'action proposed');

  const policyFacts = {
    category: input.actionCategory,
    consentGranted: input.consentGranted,
    executionPaused: false,
    providerSupportsOperation: true, // re-checked authoritatively by the provider worker
  };
  let decision = decideExecution({ ...policyFacts, validApprovalPresent: false });
  if (decision.decision === 'DENY') {
    await moveTo('BLOCKED', `policy denied: ${decision.reason}`);
    await moveTo('FAILED', 'action not permitted');
    return finish(null);
  }

  let approvalId: string | undefined;
  if (decision.decision === 'REQUIRE_APPROVAL') {
    await moveTo('AWAITING_APPROVAL', `approval required (${decision.risk})`);
    const decided = await condition(() => approval !== undefined, input.approvalTimeoutMs);
    if (!decided || !approval) {
      await moveTo('EXPIRED', 'approval window elapsed');
      return finish(null);
    }
    if (approval.decision === 'REJECT') {
      await moveTo('REJECTED', 'user rejected');
      return finish(null);
    }
    const violations = verifyExecutionAgainstApproval(
      {
        id: approval.approvalId,
        userId: input.userId,
        taskId: input.taskId,
        actionType: input.actionCategory,
        providerId: input.providerId,
        payloadHash: approval.payloadHash,
        maximumTotal: approval.maximumTotal,
        risk: decision.risk,
        status: 'APPROVED',
        expiresAt: new Date(approval.expiresAt),
        assurance: approval.assurance,
      },
      {
        userId: input.userId,
        taskId: input.taskId,
        actionType: input.actionCategory,
        providerId: input.providerId,
        payloadHash: input.payloadHash,
        total: input.total,
      },
      new Date(), // deterministic: Temporal replaces Date with workflow time
    );
    if (violations.length > 0) {
      await moveTo('PLANNING', `approval invalid: ${violations.join(',')}`);
      await moveTo('CANCELLED', 'approval did not match the exact action; nothing was executed');
      return finish(null);
    }
    approvalId = approval.approvalId;
    decision = decideExecution({ ...policyFacts, validApprovalPresent: true });
    if (decision.decision !== 'ALLOW') {
      await moveTo('CANCELLED', 'policy no longer allows execution');
      return finish(null);
    }
    await moveTo('READY_TO_EXECUTE', 'approved', { approvalId });
  } else {
    await moveTo('READY_TO_EXECUTE', 'low risk; no approval required');
  }

  const idempotencyKey = buildIdempotencyKey({
    scope: 'provider-op',
    taskId: input.taskId,
    stepId: input.stepId,
    operation: input.operation,
  });
  await moveTo('IN_PROGRESS', 'dispatching provider operation');

  let providerOperationId: string | null = null;
  try {
    const outcome = await providerExecute.executeProviderOperation({
      providerId: input.providerId,
      operation: input.operation,
      idempotencyKey,
      payload: input.payload,
      total: input.total,
    });
    if (outcome.kind === 'REJECTED') {
      await moveTo('RECOVERY_IN_PROGRESS', `provider rejected: ${outcome.reason}`);
      await moveTo('FAILED', 'provider rejected the operation');
      return finish(null);
    }
    providerOperationId = outcome.providerOperationId;
    await moveTo('AWAITING_EXTERNAL_SERVICE', 'provider accepted the request (not yet verified)');
  } catch (error) {
    const type =
      error instanceof ActivityFailure && error.cause instanceof ApplicationFailure
        ? error.cause.type
        : undefined;
    if (type !== FAILURE_TYPES.PROVIDER_AMBIGUOUS) throw error;
    // Ambiguous: do NOT retry the side effect. Reconcile by idempotency key first.
    await moveTo('RECOVERY_IN_PROGRESS', 'ambiguous provider response; reconciling');
    await moveTo('VERIFYING', 'querying provider status before any retry');
  }

  if (status.state === 'AWAITING_EXTERNAL_SERVICE')
    await moveTo('VERIFYING', 'checking authoritative status');
  const verified = await providerStatus.getProviderOperationStatus({
    providerId: input.providerId,
    idempotencyKey,
  });
  if (verified.status === 'CONFIRMED' && verified.providerReference) {
    status.evidence.push({
      method: 'PROVIDER_STATUS_API',
      reference: verified.providerReference,
      checkedAt: verified.checkedAt,
      environment: verified.environment,
    });
    await moveTo('COMPLETED_VERIFIED', 'provider confirmed', {
      evidenceIds: [verified.providerReference],
    });
    return finish(verified.providerOperationId);
  }
  // No authoritative confirmation: escalate rather than claim success.
  await moveTo('RECOVERY_IN_PROGRESS', `unverified status ${verified.status}`);
  await moveTo('ESCALATED', 'needs human review; outcome not verified');
  return finish(providerOperationId);
}
