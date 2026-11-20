import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  TASK_QUEUES,
  type ActionExecutionInput,
  type ApprovalDecisionSignal,
  type ProviderOperationRequest,
} from '@karen/domain';
import { computePayloadHash } from '@karen/domain/node';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderActivities } from '../activities/types.js';
import {
  actionExecutionWorkflow,
  approvalDecisionSignal,
  taskStatusQuery,
} from './action-execution.workflow.js';

const workflowsPath = createRequire(import.meta.url).resolve('../../dist/workflows/index.js');

type Mode = 'confirm' | 'ambiguous-then-confirmed' | 'unknown-status' | 'paused';

/** In-memory SANDBOX provider: idempotent per key, never touches the network. */
function sandboxProvider(mode: () => Mode) {
  const ops = new Map<string, { id: string; ref: string }>();
  const calls: ProviderOperationRequest[] = [];
  const activities: ProviderActivities = {
    async executeProviderOperation(req) {
      if (mode() === 'paused') {
        // Mirrors apps/provider-worker: refused before any provider contact.
        throw ApplicationFailure.nonRetryable('execution paused', 'ExecutionPausedError');
      }
      calls.push(req);
      const existing = ops.get(req.idempotencyKey);
      const op = existing ?? { id: `mockop_${ops.size + 1}`, ref: `SANDBOX-REF-${ops.size + 1}` };
      ops.set(req.idempotencyKey, op);
      if (mode() === 'ambiguous-then-confirmed') {
        throw ApplicationFailure.nonRetryable('provider timed out', 'ProviderAmbiguousError');
      }
      return {
        kind: 'ACCEPTED',
        providerOperationId: op.id,
        providerReference: op.ref,
        environment: 'SANDBOX',
      };
    },
    async getProviderOperationStatus({ idempotencyKey }) {
      const op = ops.get(idempotencyKey);
      const status = mode() === 'unknown-status' || !op ? 'UNKNOWN' : 'CONFIRMED';
      return {
        providerOperationId: op?.id ?? 'unknown',
        status,
        providerReference: status === 'CONFIRMED' ? (op?.ref ?? null) : null,
        checkedAt: new Date().toISOString(),
        environment: 'SANDBOX',
      };
    },
  };
  return { activities, calls };
}

describe('actionExecutionWorkflow (Temporal time-skipping test server)', () => {
  let env: TestWorkflowEnvironment;
  let mode: Mode = 'confirm';
  const provider = sandboxProvider(() => mode);
  const transitions: string[] = [];
  let shutdown: () => Promise<void>;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    const tasksWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.TASKS,
      workflowsPath,
      activities: {
        recordTaskTransition: async (t: { to: string }) => void transitions.push(t.to),
      },
    });
    const providerWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.PROVIDER_OPERATIONS,
      activities: provider.activities,
    });
    const runs = Promise.all([tasksWorker.run(), providerWorker.run()]);
    shutdown = async () => {
      tasksWorker.shutdown();
      providerWorker.shutdown();
      await runs;
    };
  });
  afterAll(async () => {
    await shutdown();
    await env.teardown();
  });

  const payload = { offerId: 'sandbox-offer-1', passengers: 1 };
  const input = (over: Partial<ActionExecutionInput> = {}): ActionExecutionInput => ({
    taskId: `t-${randomUUID().slice(0, 8)}`,
    stepId: 's1',
    userId: 'u1',
    providerId: 'mock-sandbox',
    operation: 'confirm',
    actionCategory: 'BOOKING_WITH_PENALTY',
    payload,
    payloadHash: computePayloadHash(payload),
    total: { currency: 'INR', minorUnits: 150_000 },
    consentGranted: true,
    approvalTimeoutMs: 15 * 60_000,
    ...over,
  });
  const approval = async (
    i: ActionExecutionInput,
    over: Partial<ApprovalDecisionSignal> = {},
  ): Promise<ApprovalDecisionSignal> => ({
    approvalId: 'appr-1',
    decision: 'APPROVE',
    userId: i.userId,
    taskId: i.taskId,
    actionType: i.actionCategory,
    providerId: i.providerId,
    payloadHash: i.payloadHash,
    maximumTotal: i.total,
    // Expiry relative to the test server's (time-skipped) clock, not wall-clock time.
    expiresAt: new Date((await env.currentTimeMs()) + 3_600_000).toISOString(),
    assurance: 'STEP_UP',
    ...over,
  });
  const start = (i: ActionExecutionInput) =>
    env.client.workflow.start(actionExecutionWorkflow, {
      taskQueue: TASK_QUEUES.TASKS,
      workflowId: `task:${i.taskId}:step:${i.stepId}`,
      args: [i],
    });

  it('waits for approval, executes once, verifies and completes with evidence', async () => {
    mode = 'confirm';
    const i = input();
    const before = provider.calls.length;
    const handle = await start(i);
    // Block until the workflow is waiting for the user.
    for (;;) {
      if ((await handle.query(taskStatusQuery)).state === 'AWAITING_APPROVAL') break;
    }
    expect(provider.calls.length).toBe(before); // nothing executed before approval
    await handle.signal(approvalDecisionSignal, await approval(i));
    const result = await handle.result();
    expect(result.finalState).toBe('COMPLETED_VERIFIED');
    expect(result.evidence[0]).toMatchObject({
      method: 'PROVIDER_STATUS_API',
      environment: 'SANDBOX',
    });
    expect(provider.calls.length - before).toBe(1);
    expect(provider.calls.at(-1)?.idempotencyKey).toBe(`karen:provider-op:${i.taskId}:s1:confirm`);
  });

  it('expires when nobody approves in time and never executes', async () => {
    const before = provider.calls.length;
    const result = await (await start(input({ approvalTimeoutMs: 60_000 }))).result();
    expect(result.finalState).toBe('EXPIRED');
    expect(provider.calls.length).toBe(before);
  });

  it('honours rejection', async () => {
    const i = input();
    const handle = await start(i);
    await handle.signal(approvalDecisionSignal, await approval(i, { decision: 'REJECT' }));
    expect((await handle.result()).finalState).toBe('REJECTED');
  });

  it('refuses an approval for a materially different action (payload hash mismatch)', async () => {
    const i = input();
    const before = provider.calls.length;
    const handle = await start(i);
    await handle.signal(
      approvalDecisionSignal,
      await approval(i, { payloadHash: computePayloadHash({ ...payload, passengers: 9 }) }),
    );
    expect((await handle.result()).finalState).toBe('CANCELLED');
    expect(provider.calls.length).toBe(before);
  });

  it('refuses an approval issued for another task, user, action or provider', async () => {
    for (const over of [
      { taskId: 't-someone-elses-task' },
      { userId: 'u-attacker' },
      { actionType: 'SEARCH' },
      { providerId: 'other-provider' },
    ]) {
      const i = input();
      const before = provider.calls.length;
      const handle = await start(i);
      await handle.signal(approvalDecisionSignal, await approval(i, over));
      expect((await handle.result()).finalState).toBe('CANCELLED');
      expect(provider.calls.length).toBe(before);
    }
  });

  it('holds an already-approved action when the kill switch is on (nothing dispatched)', async () => {
    mode = 'paused';
    const i = input();
    const before = provider.calls.length;
    const handle = await start(i);
    await handle.signal(approvalDecisionSignal, await approval(i));
    const result = await handle.result();
    expect(result.finalState).toBe('ESCALATED');
    expect(result.providerOperationId).toBeNull();
    expect(provider.calls.length).toBe(before);
    mode = 'confirm';
  });

  it('refuses an approval whose cap is below the actual total (₹1,500 approved, ₹15,000 requested)', async () => {
    const i = input({ total: { currency: 'INR', minorUnits: 1_500_000 } });
    const handle = await start(i);
    await handle.signal(
      approvalDecisionSignal,
      await approval(i, { maximumTotal: { currency: 'INR', minorUnits: 150_000 } }),
    );
    expect((await handle.result()).finalState).toBe('CANCELLED');
  });

  it('reconciles an ambiguous provider response via status instead of retrying the side effect', async () => {
    mode = 'ambiguous-then-confirmed';
    const i = input();
    const before = provider.calls.length;
    const handle = await start(i);
    await handle.signal(approvalDecisionSignal, await approval(i));
    const result = await handle.result();
    expect(result.finalState).toBe('COMPLETED_VERIFIED');
    expect(provider.calls.length - before).toBe(1); // executed exactly once
    mode = 'confirm';
  });

  it('escalates instead of claiming success when the outcome cannot be verified', async () => {
    mode = 'unknown-status';
    const i = input({ actionCategory: 'SEARCH' }); // LOW risk: no approval needed
    const result = await (await start(i)).result();
    expect(result.finalState).toBe('ESCALATED');
    expect(result.evidence).toEqual([]);
    mode = 'confirm';
  });

  it('denies prohibited or unknown (model-invented) actions without waiting for approval', async () => {
    const before = provider.calls.length;
    const result = await (await start(input({ actionCategory: 'TRANSFER_ALL_FUNDS' }))).result();
    expect(result.finalState).toBe('FAILED');
    expect(provider.calls.length).toBe(before);
  });

  it('denies execution without consent', async () => {
    const result = await (
      await start(input({ actionCategory: 'SEARCH', consentGranted: false }))
    ).result();
    expect(result.finalState).toBe('FAILED');
  });

  it('rejects a duplicate start for the same task step (idempotent workflow id)', async () => {
    const i = input();
    await start(i);
    await expect(start(i)).rejects.toThrow(/already started/i);
  });
});
