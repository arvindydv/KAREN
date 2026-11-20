import type { AccountDeletionWorkflowInput, DataExportWorkflowInput } from '@karen/domain';
import { proxyActivities, sleep } from '@temporalio/workflow';
import type { DataRightsActivities } from '../activities/types.js';

/**
 * Durable data-rights workflows (Phase 01 M7, ADR-0020). Deterministic: only `sleep` and
 * activities — no clock reads; the API supplies every duration. Inputs and history contain request ids and timestamps only — no personal data.
 *
 * Activities retry with capped exponential backoff and no attempt limit: a deletion must
 * eventually happen (or be visibly stuck and alerted on), never silently give up.
 */
const { buildExport, expireExport, executeErasure } = proxyActivities<DataRightsActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { initialInterval: '5 seconds', backoffCoefficient: 2, maximumInterval: '15 minutes' },
});

const RECHECK_INTERVAL = '1 hour';

/** Build the export, keep it downloadable until it expires, then purge it. */
export async function dataExportWorkflow(input: DataExportWorkflowInput): Promise<string> {
  const built = await buildExport(input.requestId);
  if (built.outcome === 'cancelled' || built.expiresInSeconds === null) return built.outcome;
  if (built.expiresInSeconds > 0) await sleep(built.expiresInSeconds * 1000);
  for (;;) {
    const outcome = await expireExport(input.requestId);
    if (outcome !== 'not_due') return outcome;
    await sleep(RECHECK_INTERVAL);
  }
}

/**
 * Wait out the cancellation window, then erase. The API decides: a cancelled request ends the
 * workflow; `not_due` (clock skew / window extended) waits and re-checks.
 */
export async function accountDeletionWorkflow(
  input: AccountDeletionWorkflowInput,
): Promise<string> {
  if (input.waitSeconds > 0) await sleep(input.waitSeconds * 1000);
  for (;;) {
    const outcome = await executeErasure(input.requestId);
    if (outcome !== 'not_due') return outcome;
    await sleep(RECHECK_INTERVAL);
  }
}
