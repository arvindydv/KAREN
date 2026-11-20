import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { TASK_QUEUES } from '@karen/domain';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataRightsActivities } from '../activities/types.js';
import { accountDeletionWorkflow, dataExportWorkflow } from './data-rights.workflow.js';

const workflowsPath = createRequire(import.meta.url).resolve('../../dist/workflows/index.js');
const DAY = 86_400;

type Erasure = 'completed' | 'cancelled' | 'not_due' | 'fail';

/** Scriptable in-memory stand-in for the API's internal steps. */
function fakeApi() {
  const calls: { step: string; requestId: string }[] = [];
  let erasure: Erasure[] = [];
  let expiry: ('expired' | 'not_due')[] = [];
  let built: Awaited<ReturnType<DataRightsActivities['buildExport']>> = {
    outcome: 'ready',
    expiresInSeconds: 7 * DAY,
  };
  const activities: DataRightsActivities = {
    buildExport(requestId) {
      calls.push({ step: 'buildExport', requestId });
      return Promise.resolve(built);
    },
    expireExport(requestId) {
      calls.push({ step: 'expireExport', requestId });
      return Promise.resolve(expiry.shift() ?? 'expired');
    },
    executeErasure(requestId) {
      calls.push({ step: 'executeErasure', requestId });
      const next = erasure.shift() ?? 'completed';
      return next === 'fail'
        ? Promise.reject(new Error('API temporarily unavailable'))
        : Promise.resolve(next);
    },
  };
  return {
    activities,
    stepsFor: (requestId: string) =>
      calls.filter((c) => c.requestId === requestId).map((c) => c.step),
    script(opts: { erasure?: Erasure[]; expiry?: typeof expiry; built?: typeof built }) {
      erasure = opts.erasure ?? [];
      expiry = opts.expiry ?? [];
      if (opts.built) built = opts.built;
    },
  };
}

describe('data-rights workflows (Temporal time-skipping test server)', () => {
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
  });
  afterAll(async () => {
    await shutdown();
    await env.teardown();
  });

  /** Runs a workflow to completion; returns its result and the durable timers it set (s). */
  async function run<A>(wf: (a: A) => Promise<string>, arg: A) {
    const workflowId = `test-${randomUUID()}`;
    const result = await env.client.workflow.execute(wf, {
      taskQueue: TASK_QUEUES.TASKS,
      workflowId,
      args: [arg],
    });
    const history = await env.client.workflow.getHandle(workflowId).fetchHistory();
    const timers = (history.events ?? [])
      .map((e) => e.timerStartedEventAttributes?.startToFireTimeout?.seconds)
      .filter((s) => s !== undefined && s !== null)
      .map((s) => Number(s));
    return { result, timers };
  }

  it('deletion sets one durable timer for the whole window, then erases once', async () => {
    api.script({ erasure: ['completed'] });
    const requestId = randomUUID();
    const { result, timers } = await run(accountDeletionWorkflow, {
      requestId,
      waitSeconds: 7 * DAY,
    });
    expect(result).toBe('completed');
    expect(timers).toEqual([7 * DAY]);
    expect(api.stepsFor(requestId)).toEqual(['executeErasure']);
  });

  it('a cancelled deletion ends without retrying', async () => {
    api.script({ erasure: ['cancelled'] });
    const requestId = randomUUID();
    const { result } = await run(accountDeletionWorkflow, { requestId, waitSeconds: 3600 });
    expect(result).toBe('cancelled');
    expect(api.stepsFor(requestId)).toEqual(['executeErasure']);
  });

  it('re-checks hourly while the API says not_due, and retries transient API failures', async () => {
    api.script({ erasure: ['not_due', 'fail', 'fail', 'completed'] });
    const requestId = randomUUID();
    const { result, timers } = await run(accountDeletionWorkflow, { requestId, waitSeconds: 0 });
    expect(result).toBe('completed');
    expect(timers).toEqual([3600]);
    expect(api.stepsFor(requestId)).toEqual(Array(4).fill('executeErasure'));
  });

  it('export: builds once, keeps it until expiry, then purges it', async () => {
    api.script({
      built: { outcome: 'ready', expiresInSeconds: 7 * DAY },
      expiry: ['not_due', 'expired'],
    });
    const requestId = randomUUID();
    const { result, timers } = await run(dataExportWorkflow, { requestId });
    expect(result).toBe('expired');
    expect(timers).toEqual([7 * DAY, 3600]);
    expect(api.stepsFor(requestId)).toEqual(['buildExport', 'expireExport', 'expireExport']);
  });

  it('export: a cancelled request ends immediately', async () => {
    api.script({ built: { outcome: 'cancelled', expiresInSeconds: null } });
    const requestId = randomUUID();
    const { result, timers } = await run(dataExportWorkflow, { requestId });
    expect(result).toBe('cancelled');
    expect(timers).toEqual([]);
    expect(api.stepsFor(requestId)).toEqual(['buildExport']);
  });
});
