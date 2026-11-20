import { describe, expect, it } from 'vitest';
import { assertAuditSemantics } from './audit.service.js';

describe('audit event semantics', () => {
  const base = { actorType: 'USER', action: 'authz.permission_denied' } as const;

  it('requires policy decision and reason code on DENIED events', () => {
    expect(() => assertAuditSemantics({ ...base, outcome: 'DENIED' })).toThrow(/policyDecision/);
    expect(() =>
      assertAuditSemantics({ ...base, outcome: 'DENIED', policyDecision: 'rbac:v1' }),
    ).toThrow(/reasonCode/);
    expect(() =>
      assertAuditSemantics({
        ...base,
        outcome: 'DENIED',
        policyDecision: 'rbac:v1',
        reasonCode: 'missing_permission',
      }),
    ).not.toThrow();
  });

  it('rejects free-text reason codes (no PII / prose in the trail)', () => {
    expect(() =>
      assertAuditSemantics({
        ...base,
        outcome: 'SUCCESS',
        reasonCode: 'user asha@example.com asked',
      }),
    ).toThrow(/machine-readable/);
  });
});
