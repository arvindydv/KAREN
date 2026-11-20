import { describe, expect, it } from 'vitest';
import {
  ProviderCapabilityUnavailableError,
  assertCapability,
  hasCurrentLegalAccess,
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

describe('provider capability registry metadata (F00-04)', () => {
  const transactional = {
    ...searchOnly,
    capabilities: [
      {
        capability: 'confirm',
        idempotencySupport: 'NATIVE_KEY',
        requiredApproval: 'TRANSACTION_APPROVAL',
        userActionRequired: false,
      },
    ],
  } as const;

  it('side effects require provider read-back reconciliation (webhook alone is not proof)', () => {
    const r = providerDescriptorSchema.safeParse(transactional);
    expect(JSON.stringify(r.error?.issues)).toContain('read-back reconciliation');
    expect(
      providerDescriptorSchema.safeParse({ ...transactional, reconciliation: 'MANUAL_ONLY' })
        .success,
    ).toBe(false);
    expect(
      providerDescriptorSchema.safeParse({ ...transactional, reconciliation: 'STATUS_READBACK' })
        .success,
    ).toBe(true);
  });

  it('PRODUCTION providers need contracted access, an owner and an expiry', () => {
    const prod = { ...searchOnly, environment: 'PRODUCTION', legalAccess: 'SANDBOX_ONLY' };
    const r = providerDescriptorSchema.safeParse(prod);
    expect(JSON.stringify(r.error?.issues)).toContain('CONTRACTED or PUBLIC_API_TERMS');
    expect(JSON.stringify(r.error?.issues)).toContain('contractOwner');
    expect(
      providerDescriptorSchema.safeParse({
        ...prod,
        legalAccess: 'CONTRACTED',
        contractOwner: 'partnerships',
        legalAccessExpiresAt: '2027-12-31T00:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('legal access lapses at its expiry and is denied when unknown in production', () => {
    const now = new Date('2027-01-01T00:00:00Z');
    const base = { ...searchOnly, environment: 'PRODUCTION', legalAccess: 'CONTRACTED' } as const;
    expect(
      hasCurrentLegalAccess({ ...base, legalAccessExpiresAt: '2027-06-01T00:00:00Z' }, now),
    ).toBe(true);
    expect(
      hasCurrentLegalAccess({ ...base, legalAccessExpiresAt: '2026-06-01T00:00:00Z' }, now),
    ).toBe(false);
    expect(hasCurrentLegalAccess(base, now)).toBe(false);
    expect(hasCurrentLegalAccess(searchOnly, now)).toBe(true);
    expect(hasCurrentLegalAccess({ ...searchOnly, legalAccess: 'NOT_APPROVED' }, now)).toBe(false);
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
