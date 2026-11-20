/**
 * Runs the example workflow against the docker-compose Temporal dev server (localhost:7233)
 * with real workers on both task queues. Provider activities are an in-memory SANDBOX.
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { QUERIES, SIGNALS, TASK_QUEUES, actionWorkflowId } from '@karen/domain';
import { computePayloadHash } from '@karen/domain/node';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';
import { createTaskActivities } from '../src/activities/task-activities.js';

const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

describe('example workflow on the local Temporal server', () => {
  it('executes a LOW-risk sandbox action end-to-end and completes with evidence', async () => {
    const nativeConnection = await NativeConnection.connect({ address });
    const suffix = randomUUID().slice(0, 8);
    // Unique queues per run so stale workers from other runs cannot pick up tasks.
    const tasksQueue = `${TASK_QUEUES.TASKS}-it-${suffix}`;
    const providerQueue = TASK_QUEUES.PROVIDER_OPERATIONS;
    const refs = new Map<string, string>();
    const tasksWorker = await Worker.create({
      connection: nativeConnection,
      taskQueue: tasksQueue,
      workflowsPath: createRequire(import.meta.url).resolve('../dist/workflows/index.js'),
      activities: createTaskActivities(),
    });
    const providerWorker = await Worker.create({
      connection: nativeConnection,
      taskQueue: providerQueue,
      activities: {
        async executeProviderOperation(req: { idempotencyKey: string }) {
          refs.set(req.idempotencyKey, `SANDBOX-${suffix}`);
          return {
            kind: 'ACCEPTED',
            providerOperationId: `op-${suffix}`,
            providerReference: `SANDBOX-${suffix}`,
            environment: 'SANDBOX',
          };
        },
        async getProviderOperationStatus({ idempotencyKey }: { idempotencyKey: string }) {
          return {
            providerOperationId: `op-${suffix}`,
            status: refs.has(idempotencyKey) ? 'CONFIRMED' : 'UNKNOWN',
            providerReference: refs.get(idempotencyKey) ?? null,
            checkedAt: new Date().toISOString(),
            environment: 'SANDBOX',
          };
        },
      },
    });
    const connection = await Connection.connect({ address });
    const client = new Client({ connection });
    const payload = { query: 'sandbox' };
    const taskId = `it-${suffix}`;
    try {
      const result = await Promise.race([
        tasksWorker.runUntil(
          providerWorker.runUntil(
            client.workflow.execute('actionExecutionWorkflow', {
              taskQueue: tasksQueue,
              workflowId: actionWorkflowId(taskId, 's1'),
              args: [
                {
                  taskId,
                  stepId: 's1',
                  userId: 'u-it',
                  providerId: 'mock-sandbox',
                  operation: 'confirm',
                  actionCategory: 'SEARCH',
                  payload,
                  payloadHash: computePayloadHash(payload),
                  total: { currency: 'INR', minorUnits: 0 },
                  consentGranted: true,
                  approvalTimeoutMs: 60_000,
                },
              ],
            }),
          ),
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('workflow timed out')), 45_000),
        ),
      ]);
      expect(result).toMatchObject({
        finalState: 'COMPLETED_VERIFIED',
        evidence: [{ reference: `SANDBOX-${suffix}` }],
      });
    } finally {
      await connection.close();
      await nativeConnection.close();
    }
  });

  it('survives a worker restart while awaiting approval: resumes and executes exactly once', async () => {
    const nativeConnection = await NativeConnection.connect({ address });
    const connection = await Connection.connect({ address });
    const client = new Client({ connection });
    const suffix = randomUUID().slice(0, 8);
    const tasksQueue = `${TASK_QUEUES.TASKS}-restart-${suffix}`;
    const providerQueue = `${TASK_QUEUES.PROVIDER_OPERATIONS}`;
    const executions: string[] = [];
    const refs = new Map<string, string>();
    const workflowsPath = createRequire(import.meta.url).resolve('../dist/workflows/index.js');
    const newTasksWorker = () =>
      Worker.create({
        connection: nativeConnection,
        taskQueue: tasksQueue,
        workflowsPath,
        activities: createTaskActivities(),
      });
    const providerWorker = await Worker.create({
      connection: nativeConnection,
      taskQueue: providerQueue,
      activities: {
        async executeProviderOperation(req: { idempotencyKey: string }) {
          executions.push(req.idempotencyKey);
          refs.set(req.idempotencyKey, `SANDBOX-${suffix}`);
          return {
            kind: 'ACCEPTED',
            providerOperationId: `op-${suffix}`,
            providerReference: `SANDBOX-${suffix}`,
            environment: 'SANDBOX',
          };
        },
        async getProviderOperationStatus({ idempotencyKey }: { idempotencyKey: string }) {
          return {
            providerOperationId: `op-${suffix}`,
            status: refs.has(idempotencyKey) ? 'CONFIRMED' : 'UNKNOWN',
            providerReference: refs.get(idempotencyKey) ?? null,
            checkedAt: new Date().toISOString(),
            environment: 'SANDBOX',
          };
        },
      },
    });
    const providerRun = providerWorker.run();
    const payload = { offerId: 'sandbox-restart' };
    const taskId = `restart-${suffix}`;
    const input = {
      taskId,
      stepId: 's1',
      userId: 'u-it',
      providerId: 'mock-sandbox',
      operation: 'confirm',
      actionCategory: 'BOOKING_WITH_PENALTY',
      payload,
      payloadHash: computePayloadHash(payload),
      total: { currency: 'INR', minorUnits: 100_000 },
      consentGranted: true,
      approvalTimeoutMs: 120_000,
    };
    try {
      // Worker #1 runs the workflow up to AWAITING_APPROVAL, then is shut down (deploy/crash).
      const first = await newTasksWorker();
      const firstRun = first.run();
      const handle = await client.workflow.start('actionExecutionWorkflow', {
        taskQueue: tasksQueue,
        workflowId: actionWorkflowId(taskId, 's1'),
        args: [input],
      });
      for (let i = 0; i < 50; i += 1) {
        const state = await handle
          .query<{ state: string }>(QUERIES.TASK_STATUS)
          .then((s) => s.state)
          .catch(() => 'pending');
        if (state === 'AWAITING_APPROVAL') break;
        await new Promise((r) => setTimeout(r, 200));
      }
      first.shutdown();
      await firstRun;
      expect(executions).toEqual([]);

      // Approval arrives while NO workflow worker is running; worker #2 replays and continues.
      await handle.signal(SIGNALS.APPROVAL_DECISION, {
        approvalId: `appr-${suffix}`,
        decision: 'APPROVE',
        userId: input.userId,
        taskId,
        actionType: input.actionCategory,
        providerId: input.providerId,
        payloadHash: input.payloadHash,
        maximumTotal: input.total,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        assurance: 'STEP_UP',
      });
      const second = await newTasksWorker();
      const result = await second.runUntil(
        Promise.race([
          handle.result(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('workflow timed out after restart')), 45_000),
          ),
        ]),
      );
      expect(result).toMatchObject({ finalState: 'COMPLETED_VERIFIED' });
      expect(executions).toHaveLength(1); // replay never re-ran the side effect
    } finally {
      providerWorker.shutdown();
      await providerRun;
      await connection.close();
      await nativeConnection.close();
    }
  });
});
