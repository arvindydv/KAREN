/**
 * @karen/test-fixtures — realistic but synthetic, non-sensitive fixtures shared by tests
 * across services (TypeScript and Python read the same JSON files).
 * Every secret in here is a TEST-ONLY value and must never be used outside tests.
 */
import { readFileSync } from 'node:fs';
import type { ProviderDescriptor } from '@karen/domain';

const load = <T>(relative: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/${relative}`, import.meta.url), 'utf8')) as T;

export interface SignatureVector {
  method: string;
  path_with_query: string;
  body: string;
  timestamp: number;
  signing_string: string;
  header: string;
}

export const internalSignatureVectors = () =>
  load<{ secret: string; tolerance_seconds: number; vectors: SignatureVector[] }>(
    'internal-auth/signature-vectors.json',
  );

export interface WebhookFixture {
  name: string;
  body: string;
  timestamp: number;
  header: string;
  expected: 'ACCEPT' | 'REJECT_SIGNATURE_MISMATCH' | 'REJECT_MALFORMED';
}

export const mockProviderWebhooks = () =>
  load<{
    provider_id: string;
    secret: string;
    tolerance_seconds: number;
    fixtures: WebhookFixture[];
  }>('webhooks/mock-provider-webhooks.json');

export interface SyntheticUser {
  external_subject: string;
  email: string;
  display_name: string;
  locale: string;
  timezone: string;
  roles: string[];
}

export const syntheticUsers = () =>
  load<{ users: SyntheticUser[] }>('users/synthetic-users.json').users;

/** A sandbox provider descriptor that declares transactional capabilities correctly. */
export const sandboxTransactionalProvider: ProviderDescriptor = {
  id: 'mock-sandbox',
  displayName: 'Mock Sandbox Provider (SANDBOX — not a real merchant)',
  environment: 'SANDBOX',
  legalAccess: 'SANDBOX_ONLY',
  capabilities: [
    {
      capability: 'search',
      idempotencySupport: 'NONE',
      requiredApproval: 'NONE',
      userActionRequired: false,
    },
    {
      capability: 'quote',
      idempotencySupport: 'NONE',
      requiredApproval: 'NONE',
      userActionRequired: false,
    },
    {
      capability: 'reserve',
      idempotencySupport: 'NATIVE_KEY',
      requiredApproval: 'TRANSACTION_APPROVAL',
      userActionRequired: false,
    },
    {
      capability: 'confirm',
      idempotencySupport: 'NATIVE_KEY',
      requiredApproval: 'TRANSACTION_APPROVAL',
      userActionRequired: false,
    },
    {
      capability: 'cancel',
      idempotencySupport: 'NATIVE_KEY',
      requiredApproval: 'TRANSACTION_APPROVAL',
      userActionRequired: false,
    },
    {
      capability: 'status',
      idempotencySupport: 'NONE',
      requiredApproval: 'NONE',
      userActionRequired: false,
    },
    {
      capability: 'webhook',
      idempotencySupport: 'CLIENT_REFERENCE',
      requiredApproval: 'NONE',
      userActionRequired: false,
    },
  ],
  supportedGeographies: ['IN'],
  allowedAuthMethods: ['API_KEY'],
  dataResidency: 'IN',
  rateLimitPerMinute: 120,
  webhookSignature: 'HMAC_SHA256',
};
