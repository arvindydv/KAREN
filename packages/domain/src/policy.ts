/**
 * Action risk classification and execution policy (product spec §12 TRUST-01).
 *
 * This is executable policy, deliberately independent of any model output: an LLM may
 * *propose* an action category, but whether it may run is decided here, by code, from
 * server-side facts (consent, approvals, kill switches). Unknown → PROHIBITED.
 */

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'PROHIBITED'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ACTION_CATEGORIES = [
  // LOW
  'SEARCH',
  'COMPARE',
  'CREATE_DRAFT',
  'SET_USER_REQUESTED_REMINDER',
  'READ_STATUS',
  // MEDIUM
  'SEND_NON_SENSITIVE_MESSAGE',
  'SCHEDULE_APPOINTMENT',
  'SUBMIT_SUPPORT_TICKET',
  'MODIFY_CALENDAR_EVENT',
  // HIGH
  'PURCHASE',
  'BOOKING_WITH_PENALTY',
  'PAYMENT',
  'SENSITIVE_COMMUNICATION',
  'CONTRACT_COMMITMENT',
  'CANCEL_PAID_BOOKING',
  'REFUND_REQUEST',
  // PROHIBITED
  'ACCESS_CONTROL_BYPASS',
  'OTP_INTERCEPTION',
  'COVERT_ACCOUNT_ACCESS',
  'CREDENTIAL_COLLECTION',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

const RISK_BY_CATEGORY: Readonly<Record<ActionCategory, RiskLevel>> = {
  SEARCH: 'LOW',
  COMPARE: 'LOW',
  CREATE_DRAFT: 'LOW',
  SET_USER_REQUESTED_REMINDER: 'LOW',
  READ_STATUS: 'LOW',
  SEND_NON_SENSITIVE_MESSAGE: 'MEDIUM',
  SCHEDULE_APPOINTMENT: 'MEDIUM',
  SUBMIT_SUPPORT_TICKET: 'MEDIUM',
  MODIFY_CALENDAR_EVENT: 'MEDIUM',
  PURCHASE: 'HIGH',
  BOOKING_WITH_PENALTY: 'HIGH',
  PAYMENT: 'HIGH',
  SENSITIVE_COMMUNICATION: 'HIGH',
  CONTRACT_COMMITMENT: 'HIGH',
  CANCEL_PAID_BOOKING: 'HIGH',
  REFUND_REQUEST: 'HIGH',
  ACCESS_CONTROL_BYPASS: 'PROHIBITED',
  OTP_INTERCEPTION: 'PROHIBITED',
  COVERT_ACCOUNT_ACCESS: 'PROHIBITED',
  CREDENTIAL_COLLECTION: 'PROHIBITED',
};

const isActionCategory = (value: string): value is ActionCategory =>
  (ACTION_CATEGORIES as readonly string[]).includes(value);

/** Classify a (possibly model-proposed, therefore untrusted) category string. */
export function classifyRisk(category: string): RiskLevel {
  return isActionCategory(category) ? RISK_BY_CATEGORY[category] : 'PROHIBITED';
}

export interface ExecutionPolicyInput {
  /** Untrusted category string, e.g. from a model tool proposal. */
  readonly category: string;
  /** Server-verified: user holds an active consent covering this purpose/scope. */
  readonly consentGranted: boolean;
  /** Server-verified: a fresh, transaction-specific approval exists and was validated. */
  readonly validApprovalPresent: boolean;
  /** User-configured autonomy for this MEDIUM category (never honoured for HIGH). */
  readonly userAllowsAutonomyForCategory?: boolean;
  /** Global/per-provider kill switch or "Pause KAREN" (SEC-08, TRUST-05). */
  readonly executionPaused: boolean;
  /** Capability actually declared by the provider adapter for this operation. */
  readonly providerSupportsOperation: boolean;
}

export type ExecutionDecision =
  | { readonly decision: 'ALLOW'; readonly risk: RiskLevel }
  | { readonly decision: 'REQUIRE_APPROVAL'; readonly risk: RiskLevel }
  | { readonly decision: 'DENY'; readonly risk: RiskLevel; readonly reason: DenyReason };

export type DenyReason =
  'PROHIBITED_ACTION' | 'CONSENT_MISSING' | 'EXECUTION_PAUSED' | 'PROVIDER_CAPABILITY_UNAVAILABLE';

/** Deny-by-default execution policy. */
export function decideExecution(input: ExecutionPolicyInput): ExecutionDecision {
  const risk = classifyRisk(input.category);
  if (risk === 'PROHIBITED') return { decision: 'DENY', risk, reason: 'PROHIBITED_ACTION' };
  if (input.executionPaused) return { decision: 'DENY', risk, reason: 'EXECUTION_PAUSED' };
  if (!input.consentGranted) return { decision: 'DENY', risk, reason: 'CONSENT_MISSING' };
  if (!input.providerSupportsOperation) {
    return { decision: 'DENY', risk, reason: 'PROVIDER_CAPABILITY_UNAVAILABLE' };
  }
  switch (risk) {
    case 'LOW':
      return { decision: 'ALLOW', risk };
    case 'MEDIUM':
      return input.validApprovalPresent || input.userAllowsAutonomyForCategory === true
        ? { decision: 'ALLOW', risk }
        : { decision: 'REQUIRE_APPROVAL', risk };
    case 'HIGH':
      // HIGH risk always requires explicit, fresh, transaction-specific approval.
      return input.validApprovalPresent
        ? { decision: 'ALLOW', risk }
        : { decision: 'REQUIRE_APPROVAL', risk };
  }
}
