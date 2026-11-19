/**
 * Idempotency key conventions (architecture §4, product spec §10 TASK-06).
 *
 * The key identifies the *intent* (task + step + operation), never the attempt, so every
 * retry of the same consequential operation reuses it and the provider / our ledger can
 * deduplicate. Keys are persisted (unique constraint) before dispatch.
 */
export interface IdempotencyKeyParts {
  readonly scope: 'provider-op' | 'notification' | 'workflow' | 'webhook';
  readonly taskId: string;
  readonly stepId: string;
  readonly operation: string;
}

const SAFE = /^[A-Za-z0-9_.-]{1,80}$/;

export function buildIdempotencyKey(parts: IdempotencyKeyParts): string {
  for (const [name, value] of Object.entries(parts) as [string, string][]) {
    if (!SAFE.test(value)) throw new RangeError(`Invalid idempotency key part "${name}"`);
  }
  return `karen:${parts.scope}:${parts.taskId}:${parts.stepId}:${parts.operation}`;
}
