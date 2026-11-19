import { describe, expect, it } from 'vitest';
import {
  ProviderCapabilityUnavailableError,
  assertCapability,
  isSearchOnly,
  providerDescriptorSchema,
} from './provider.js';
import { buildIdempotencyKey } from './idempotency.js';

const searchOnly = {
  id: 'mock-search',
  displayName: 'Mock search',
  environment: 'SANDBOX',
  legalAccess: 'SANDBOX_ONLY',
  capabilities: [
    {
      capability: 'search',
      idempotencySupport: 'NONE',
      requiredApproval: 'NONE',
      userActionRequired: false,
    },
  ],
  supportedGeographies: ['IN'],
  allowedAuthMethods: ['NONE'],
  dataResidency: 'IN',
  rateLimitPerMinute: 60,
  webhookSignature: 'NONE',
} as const;

describe('provider descriptor validation', () => {
  it('accepts a valid search-only provider and labels it search-only', () => {
    const d = providerDescriptorSchema.parse(searchOnly);
    expect(isSearchOnly(d)).toBe(true);
    expect(() => assertCapability(d, 'confirm')).toThrow(ProviderCapabilityUnavailableError);
  });

  it('rejects side-effecting capabilities without approval or idempotency', () => {
    const bad = {
      ...searchOnly,
      capabilities: [
        {
          capability: 'confirm',
          idempotencySupport: 'NONE',
          requiredApproval: 'NONE',
          userActionRequired: false,
        },
      ],
    };
    const r = providerDescriptorSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('must require approval');
    expect(JSON.stringify(r.error?.issues)).toContain('idempotency strategy');
  });

  it('rejects webhooks without signature validation and unknown fields', () => {
    const r = providerDescriptorSchema.safeParse({
      ...searchOnly,
      capabilities: [
        {
          capability: 'webhook',
          idempotencySupport: 'CLIENT_REFERENCE',
          requiredApproval: 'NONE',
          userActionRequired: false,
        },
      ],
    });
    expect(r.success).toBe(false);
    expect(providerDescriptorSchema.safeParse({ ...searchOnly, extra: 1 }).success).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('are stable per intent and reject unsafe parts', () => {
    const parts = {
      scope: 'provider-op',
      taskId: 't1',
      stepId: 's1',
      operation: 'confirm',
    } as const;
    expect(buildIdempotencyKey(parts)).toBe(buildIdempotencyKey({ ...parts }));
    expect(() => buildIdempotencyKey({ ...parts, taskId: 'a:b' })).toThrow();
  });
});
