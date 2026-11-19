import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  apiErrorSchema,
  approvalDecisionRequestSchema,
  createTaskRequestSchema,
} from './index.js';

describe('public API contracts', () => {
  it('error envelope matches the spec shape and rejects unknown codes', () => {
    const valid = {
      error: {
        code: 'PROVIDER_CAPABILITY_UNAVAILABLE',
        message: 'This provider cannot complete the requested action through KAREN right now.',
        correlation_id: 'req-12345678',
        retryable: false,
        next_options: ['PREPARE_MANUAL_HANDOFF'],
      },
    };
    expect(apiErrorSchema.safeParse(valid).success).toBe(true);
    expect(
      apiErrorSchema.safeParse({ error: { ...valid.error, code: 'SOMETHING_ELSE' } }).success,
    ).toBe(false);
  });

  it('task creation requires a client dedupe id and rejects unknown fields', () => {
    const base = {
      type: 'REFUND_FOLLOW_UP',
      desired_outcome: 'Confirm status of my flight refund and follow up',
      constraints: { contact_requires_approval: true },
      source: 'CHAT',
      client_request_id: '7f0c2c7e-8d1a-4a8f-9a53-2b8f8a8f6f11',
    };
    expect(createTaskRequestSchema.safeParse(base).success).toBe(true);
    const { client_request_id: _omit, ...withoutDedupe } = base;
    expect(createTaskRequestSchema.safeParse(withoutDedupe).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ ...base, user_id: 'spoofed' }).success).toBe(false);
  });

  it('clients can only submit a decision, never approval terms', () => {
    expect(
      approvalDecisionRequestSchema.safeParse({
        decision: 'APPROVE',
        payload_hash: 'sha256:x',
        maximum_total_amount: 1,
      }).success,
    ).toBe(false);
  });

  it('end users never hold staff permissions', () => {
    expect(ROLE_PERMISSIONS.user).not.toContain('ops:read');
    expect(ROLE_PERMISSIONS.user).not.toContain('audit:read');
  });
});
