/**
 * @karen/types — the small set of TypeScript types that are genuinely shared by
 * every KAREN TypeScript runtime (mobile, web, admin, API, workers).
 *
 * Rules: no runtime dependencies, no framework types, no business rules
 * (those live in @karen/domain), no API DTOs (those live in @karen/api-contracts).
 */

declare const brand: unique symbol;

/** Nominal typing helper: prevents passing a TaskId where a UserId is expected. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Uuid = Brand<string, 'Uuid'>;
export type UserId = Brand<string, 'UserId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type ProviderOperationId = Brand<string, 'ProviderOperationId'>;
export type RequestId = Brand<string, 'RequestId'>;

/** ISO-8601 timestamp string with an explicit offset (always UTC `Z` on the wire). */
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;

/** ISO-4217 currency code. INR is the launch currency; others are supported structurally. */
export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD';

/**
 * Money is always represented in integer minor units (paise for INR) to avoid
 * floating-point drift in approvals and price caps.
 */
export interface Money {
  readonly currency: CurrencyCode;
  readonly minorUnits: number;
}

export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Deployment environments. `local` and `test` are the only ones allowed to use dev-only shortcuts. */
export const APP_ENVIRONMENTS = ['local', 'test', 'dev', 'staging', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const isDevelopmentEnvironment = (env: AppEnvironment): boolean =>
  env === 'local' || env === 'test';
