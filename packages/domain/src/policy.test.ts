import { describe, expect, it } from 'vitest';
import { classifyRisk, decideExecution, type ExecutionPolicyInput } from './policy.js';

const base: ExecutionPolicyInput = {
  category: 'SEARCH',
  consentGranted: true,
  validApprovalPresent: false,
  executionPaused: false,
  providerSupportsOperation: true,
};

describe('execution policy', () => {
  it('treats unknown (e.g. model-invented) categories as PROHIBITED', () => {
    expect(classifyRisk('TRANSFER_ALL_MONEY')).toBe('PROHIBITED');
    expect(decideExecution({ ...base, category: 'TRANSFER_ALL_MONEY' })).toMatchObject({
      decision: 'DENY',
      reason: 'PROHIBITED_ACTION',
    });
  });

  it('allows LOW risk actions only with consent', () => {
    expect(decideExecution(base).decision).toBe('ALLOW');
    expect(decideExecution({ ...base, consentGranted: false })).toMatchObject({
      decision: 'DENY',
      reason: 'CONSENT_MISSING',
    });
  });

  it('HIGH risk always requires fresh approval, even with user autonomy configured', () => {
    expect(
      decideExecution({ ...base, category: 'PAYMENT', userAllowsAutonomyForCategory: true })
        .decision,
    ).toBe('REQUIRE_APPROVAL');
    expect(
      decideExecution({ ...base, category: 'PAYMENT', validApprovalPresent: true }).decision,
    ).toBe('ALLOW');
  });

  it('MEDIUM risk requires confirmation unless the user opted into autonomy', () => {
    const m = { ...base, category: 'SUBMIT_SUPPORT_TICKET' };
    expect(decideExecution(m).decision).toBe('REQUIRE_APPROVAL');
    expect(decideExecution({ ...m, userAllowsAutonomyForCategory: true }).decision).toBe('ALLOW');
  });

  it('kill switch and unsupported capability deny even approved actions', () => {
    const approved = { ...base, category: 'PURCHASE', validApprovalPresent: true };
    expect(decideExecution({ ...approved, executionPaused: true })).toMatchObject({
      decision: 'DENY',
      reason: 'EXECUTION_PAUSED',
    });
    expect(decideExecution({ ...approved, providerSupportsOperation: false })).toMatchObject({
      decision: 'DENY',
      reason: 'PROVIDER_CAPABILITY_UNAVAILABLE',
    });
  });

  it('prohibited actions are denied regardless of approval', () => {
    expect(
      decideExecution({ ...base, category: 'OTP_INTERCEPTION', validApprovalPresent: true })
        .decision,
    ).toBe('DENY');
  });
});
