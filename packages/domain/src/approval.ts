/**
 * Approval objects (product spec §12 TRUST-02, §27.1).
 *
 * An approval binds the user, task, exact payload hash, provider, maximum amount and
 * expiry. A material change produces a different hash and therefore invalidates it.
 */
import type { CurrencyCode, Money } from '@karen/types';
import type { RiskLevel } from './policy.js';

export const APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'INVALIDATED',
  'CONSUMED',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const AUTH_ASSURANCE_LEVELS = ['SESSION', 'STEP_UP'] as const;
export type AuthAssuranceLevel = (typeof AUTH_ASSURANCE_LEVELS)[number];

export interface ApprovalRecord {
  readonly id: string;
  readonly userId: string;
  readonly taskId: string;
  readonly actionType: string;
  readonly providerId: string;
  /** `sha256:<hex>` of the canonical JSON of the exact action payload. */
  readonly payloadHash: string;
  readonly maximumTotal: Money;
  readonly risk: RiskLevel;
  readonly status: ApprovalStatus;
  readonly expiresAt: Date;
  readonly assurance: AuthAssuranceLevel;
}

export interface ExecutionRequest {
  readonly userId: string;
  readonly taskId: string;
  readonly actionType: string;
  readonly providerId: string;
  readonly payloadHash: string;
  readonly total: Money;
}

export type ApprovalViolation =
  | 'APPROVAL_NOT_APPROVED'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_SUBJECT_MISMATCH'
  | 'APPROVAL_PAYLOAD_MISMATCH'
  | 'APPROVAL_CURRENCY_MISMATCH'
  | 'APPROVAL_AMOUNT_EXCEEDED'
  | 'APPROVAL_ASSURANCE_INSUFFICIENT';

/**
 * Check that an execution request is exactly what the user approved.
 * Returns the list of violations (empty = may proceed). Pure and deterministic.
 */
export function verifyExecutionAgainstApproval(
  approval: ApprovalRecord,
  request: ExecutionRequest,
  now: Date,
): ApprovalViolation[] {
  const violations: ApprovalViolation[] = [];
  if (approval.status !== 'APPROVED') violations.push('APPROVAL_NOT_APPROVED');
  if (now.getTime() >= approval.expiresAt.getTime()) violations.push('APPROVAL_EXPIRED');
  if (
    approval.userId !== request.userId ||
    approval.taskId !== request.taskId ||
    approval.actionType !== request.actionType ||
    approval.providerId !== request.providerId
  ) {
    violations.push('APPROVAL_SUBJECT_MISMATCH');
  }
  if (approval.payloadHash !== request.payloadHash) violations.push('APPROVAL_PAYLOAD_MISMATCH');
  if (approval.maximumTotal.currency !== request.total.currency) {
    violations.push('APPROVAL_CURRENCY_MISMATCH');
  } else if (request.total.minorUnits > approval.maximumTotal.minorUnits) {
    violations.push('APPROVAL_AMOUNT_EXCEEDED');
  }
  if (approval.risk === 'HIGH' && approval.assurance !== 'STEP_UP') {
    violations.push('APPROVAL_ASSURANCE_INSUFFICIENT');
  }
  return violations;
}

/**
 * Deterministic JSON serialisation used for payload hashing: object keys sorted,
 * `undefined` properties dropped, non-finite numbers and non-plain values rejected.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError('canonicalJson: only plain objects are supported');
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export const money = (currency: CurrencyCode, minorUnits: number): Money => {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new RangeError('Money minorUnits must be a non-negative safe integer');
  }
  return { currency, minorUnits };
};
