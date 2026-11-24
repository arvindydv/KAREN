import type { MemoryExtractionWorkflowInput } from '@karen/domain';
import { proxyActivities, type RetryPolicy } from '@temporalio/workflow';
import type { MemoryActivities } from '../activities/types.js';

/**
 * Memory extraction (Phase 03, ADR-0036 §8.3). Best-effort, unlike erasure: giving up is safe
 * because nothing is stored until the API's write step succeeds. Input and history: the job id
 * and outcome codes only (no content). Deterministic: activities only.
 *
 * Timeouts are ALIGNED (SR-WF-06): the activity's HTTP call times out at 85 s, inside the 90 s
 * `startToCloseTimeout`, and the API only lets a retry take over a `running` job after 90 s — so a
 * retry never races a still-running first attempt; the job's version CAS guards it anyway.
 */
export const MEMORY_ACTIVITY_START_TO_CLOSE = '90 seconds';
export const MEMORY_RETRY: RetryPolicy = {
  initialInterval: '5 seconds',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
  maximumAttempts: 5,
  nonRetryableErrorTypes: ['InternalCallRejected', 'ConfigError'],
};

const { runMemoryExtraction } = proxyActivities<MemoryActivities>({
  startToCloseTimeout: MEMORY_ACTIVITY_START_TO_CLOSE,
  retry: MEMORY_RETRY,
});
const { abandonMemoryExtraction } = proxyActivities<MemoryActivities>({
  startToCloseTimeout: MEMORY_ACTIVITY_START_TO_CLOSE,
  retry: { ...MEMORY_RETRY, maximumAttempts: 10 },
});

export async function memoryExtractionWorkflow(
  input: MemoryExtractionWorkflowInput,
): Promise<string> {
  try {
    return (await runMemoryExtraction(input.jobId)).outcome;
  } catch {
    // Retries exhausted or a non-retryable rejection: mark the job failed (idempotent). If this
    // also fails, the API's stale-job sweep terminates the job after its DB-held max age.
    return (await abandonMemoryExtraction(input.jobId)).outcome;
  }
}
