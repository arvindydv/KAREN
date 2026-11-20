/**
 * Step-up retry policy (ADR-0017 §4). Pure: the action and the step-up ceremony are injected.
 *
 * Sensitive staff actions may fail with 403 `STEP_UP_REQUIRED`. We then run the security-key
 * ceremony ONCE and, if it succeeds, retry the action ONCE. A second STEP_UP_REQUIRED (or any
 * other failure) is returned to the caller as-is — never an unbounded loop.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  correlation_id?: string;
  details?: { path: string; message: string }[];
}

export type BffResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody | null };

export const isStepUpRequired = (result: BffResult<unknown>): boolean =>
  !result.ok && result.status === 403 && result.error?.code === 'STEP_UP_REQUIRED';

export async function runWithStepUp<T>(
  action: () => Promise<BffResult<T>>,
  stepUp: () => Promise<boolean>,
): Promise<BffResult<T>> {
  const first = await action();
  if (!isStepUpRequired(first)) return first;
  const confirmed = await stepUp();
  if (!confirmed) return first;
  return action();
}
