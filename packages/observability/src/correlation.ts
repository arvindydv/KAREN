import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation identifiers carried through a request / workflow / provider operation.
 * Field names are the canonical log/trace attribute names across all KAREN services
 * (Python uses the same snake_case keys).
 */
export interface CorrelationContext {
  request_id: string;
  trace_id?: string;
  /** Pseudonymous user reference — NEVER the raw user ID or e-mail. */
  user_ref?: string;
  task_id?: string;
  workflow_id?: string;
  provider_operation_id?: string;
  approval_id?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export const runWithCorrelation = <T>(ctx: CorrelationContext, fn: () => T): T =>
  storage.run(ctx, fn);

export const currentCorrelation = (): CorrelationContext | undefined => storage.getStore();

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Accept a client/upstream request ID only if it is well-formed; otherwise mint one. */
export const normaliseRequestId = (incoming: unknown): string =>
  typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

/**
 * Bind a correlation context to the current async execution (for framework hooks such as
 * Fastify `onRequest` that cannot wrap the handler in a callback).
 */
export const enterCorrelation = (ctx: CorrelationContext): void => storage.enterWith(ctx);
