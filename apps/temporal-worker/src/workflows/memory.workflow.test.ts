import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { TASK_QUEUES, memoryExtractionWorkflowId } from '@karen/domain';
import { ApplicationFailure, WorkflowIdReusePolicy } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemoryActivities } from '../activities/types.js';
import { memoryExtractionWorkflow } from './memory.workflow.js';

const workflowsPath = createRequire(import.meta.url).resolve('../../dist/workflows/index.js');

type Step = 'stored' | 'retryable' | 'rejected';

/** Scriptable stand-in for the API's run/abandon steps (T-WF-01…06). */
function fakeApi() {
  const calls: { step: 'run' | 'abandon'; jobId: string }[] = [];
  const scripts = new Map<string, Step[]>();
  const activities: MemoryActivities = {
    runMemoryExtraction(jobId) {
      calls.push({ step: 'run', jobId });
      const next = scripts.get(jobId)?.shift() ?? 'stored';
      if (next === 'retryable') return Promise.reject(new Error('API 503'));
      if (next === 'rejected') {
        return Promise.reject(ApplicationFailure.nonRetryable('404', 'InternalCallRejected'));
      }
      return Promise.resolve({ outcome: 'stored' });
    },
    abandonMemoryExtraction(jobId) {
      calls.push({ step: 'abandon', jobId });
      return Promise.resolve({ outcome: 'abandoned' });
    },
  };
  return {
    activities,
    script: (jobId: string, steps: Step[]) => scripts.set(jobId, steps),
    stepsFor: (jobId: string) => calls.filter((c) => c.jobId === jobId).map((c) => c.step),
  };
}

describe('memoryExtractionWorkflow (Temporal time-skipping test server)', () => {
  let env: TestWorkflowEnvironment;
  const api = fakeApi();
  let shutdown: () => Promise<void>;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.TASKS,
      workflowsPath,
      activities: api.activities,
    });
    const running = worker.run();
    shutdown = async () => {
      worker.shutdown();
      await running;
    };
  }, 120_000);
  afterAll(async () => {
    await shutdown();
    await env.teardown();
  });

  const start = (jobId: string) =>
    env.client.workflow.execute(memoryExtractionWorkflow, {
      taskQueue: TASK_QUEUES.TASKS,
      workflowId: memoryExtractionWorkflowId(randomUUID()),
      args: [{ jobId }],
    });

  it('T-WF-01 runs the step once and returns its outcome code', async () => {
    const jobId = randomUUID();
    expect(await start(jobId)).toBe('stored');
    expect(api.stepsFor(jobId)).toEqual(['run']);
  });

  it('T-WF-02 retries a retryable failure with backoff, then succeeds', async () => {
    const jobId = randomUUID();
    api.script(jobId, ['retryable', 'retryable', 'stored']);
    expect(await start(jobId)).toBe('stored');
    expect(api.stepsFor(jobId)).toEqual(['run', 'run', 'run']);
  });

  it('T-WF-03 gives up after 5 attempts and abandons (idempotent API step)', async () => {
    const jobId = randomUUID();
    api.script(
      jobId,
      Array.from({ length: 10 }, () => 'retryable' as const),
    );
    expect(await start(jobId)).toBe('abandoned');
    expect(api.stepsFor(jobId)).toEqual(['run', 'run', 'run', 'run', 'run', 'abandon']);
  });

  it('T-WF-04 a non-retryable rejection is not retried; the job is abandoned', async () => {
    const jobId = randomUUID();
    api.script(jobId, ['rejected']);
    expect(await start(jobId)).toBe('abandoned');
    expect(api.stepsFor(jobId)).toEqual(['run', 'abandon']);
  });

  it('T-WF-05 one workflow per source message: a second start with the same id is rejected', async () => {
    const workflowId = memoryExtractionWorkflowId(randomUUID());
    const opts = {
      taskQueue: TASK_QUEUES.TASKS,
      workflowId,
      args: [{ jobId: randomUUID() }] as [{ jobId: string }],
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    };
    await env.client.workflow.execute(memoryExtractionWorkflow, opts);
    await expect(env.client.workflow.start(memoryExtractionWorkflow, opts)).rejects.toThrow(
      /already started|AlreadyStarted/i,
    );
  });

  it('T-WF-06 / T-LOG-01 history carries the job id only (no content)', async () => {
    const jobId = randomUUID();
    const workflowId = memoryExtractionWorkflowId(randomUUID());
    await env.client.workflow.execute(memoryExtractionWorkflow, {
      taskQueue: TASK_QUEUES.TASKS,
      workflowId,
      args: [{ jobId }],
    });
    const history = await env.client.workflow.getHandle(workflowId).fetchHistory();
    const started = history.events?.[0]?.workflowExecutionStartedEventAttributes;
    const payload = started?.input?.payloads?.[0]?.data;
    expect(JSON.parse(Buffer.from(payload!).toString('utf8'))).toEqual({ jobId });
  });
});
