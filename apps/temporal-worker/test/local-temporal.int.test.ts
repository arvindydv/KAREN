/**
 * Runs the example workflow against the docker-compose Temporal dev server (localhost:7233)
 * with real workers on both task queues. Provider activities are an in-memory SANDBOX.
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { TASK_QUEUES, actionWorkflowId } from '@karen/domain';
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
});
