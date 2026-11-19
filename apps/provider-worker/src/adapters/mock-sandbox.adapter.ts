/**
 * SANDBOX-ONLY mock provider. Never talks to a network; every response is labelled SANDBOX
 * and every reference starts with "SANDBOX-" so it can never be mistaken for a real booking.
 * Used for the P0 sandbox journey (spec §29.1 step 10) and for tests.
 */
import { randomUUID } from 'node:crypto';
import type {
  ProviderDescriptor,
  ProviderOperationRequest,
  ProviderOperationOutcome,
  ProviderStatusResult,
} from '@karen/domain';
import { verifyTimestamped } from '@karen/domain/node';
import { z } from 'zod';
import {
  ProviderAmbiguousError,
  type ProviderAdapter,
  type SearchQuery,
  type SearchResult,
  type WebhookVerification,
} from './contract.js';

export const MOCK_SANDBOX_DESCRIPTOR: ProviderDescriptor = {
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

const webhookEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created_at: z.iso.datetime(),
  data: z.object({
    provider_operation_id: z.string().nullable().optional(),
    merchant_reference: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    environment: z.literal('SANDBOX'),
  }),
});

export interface MockSandboxOptions {
  webhookSecret: string;
  webhookToleranceSeconds?: number;
  /** Test hook: make the next execute() call ambiguous AFTER recording the operation. */
  failNextAmbiguously?: boolean;
}

export class MockSandboxAdapter implements ProviderAdapter {
  readonly descriptor = MOCK_SANDBOX_DESCRIPTOR;
  private readonly operations = new Map<
    string,
    { id: string; reference: string; status: 'CONFIRMED' | 'PENDING' }
  >();
  executeCalls = 0;

  constructor(private readonly options: MockSandboxOptions) {}

  search(query: SearchQuery): Promise<SearchResult> {
    return Promise.resolve({
      items: [
        { id: 'sandbox-item-1', title: `[SANDBOX] result for "${query.query.slice(0, 40)}"` },
      ],
      provenance: {
        providerId: this.descriptor.id,
        environment: 'SANDBOX',
        fetchedAt: new Date().toISOString(),
        ttlSeconds: 60,
        source: 'mock-sandbox',
        legalAccess: 'SANDBOX_ONLY',
      },
    });
  }

  execute(request: ProviderOperationRequest): Promise<ProviderOperationOutcome> {
    this.executeCalls += 1;
    let op = this.operations.get(request.idempotencyKey);
    if (!op) {
      op = {
        id: `mockop_${randomUUID()}`,
        reference: `SANDBOX-${randomUUID().slice(0, 8).toUpperCase()}`,
        status: 'CONFIRMED',
      };
      this.operations.set(request.idempotencyKey, op);
    }
    if (this.options.failNextAmbiguously) {
      this.options.failNextAmbiguously = false;
      return Promise.reject(new ProviderAmbiguousError('Sandbox: simulated timeout after commit'));
    }
    return Promise.resolve({
      kind: 'ACCEPTED',
      providerOperationId: op.id,
      providerReference: op.reference,
      environment: 'SANDBOX',
    });
  }

  status(idempotencyKey: string): Promise<ProviderStatusResult> {
    const op = this.operations.get(idempotencyKey);
    return Promise.resolve({
      providerOperationId: op?.id ?? 'unknown',
      status: op ? op.status : 'UNKNOWN',
      providerReference: op?.reference ?? null,
      checkedAt: new Date().toISOString(),
      environment: 'SANDBOX',
    });
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
    nowUnixSeconds: number,
  ): WebhookVerification {
    const sig = verifyTimestamped({
      secret: this.options.webhookSecret,
      payload: rawBody,
      header: headers['x-mock-signature'],
      nowUnixSeconds,
      toleranceSeconds: this.options.webhookToleranceSeconds ?? 300,
    });
    if (!sig.ok) return { ok: false, reason: sig.reason };
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: 'INVALID_PAYLOAD' };
    }
    const parsed = webhookEventSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: 'INVALID_PAYLOAD' };
    const e = parsed.data;
    return {
      ok: true,
      event: {
        eventId: e.id,
        type: e.type,
        occurredAt: e.created_at,
        merchantReference: e.data.merchant_reference ?? null,
        providerOperationId: e.data.provider_operation_id ?? null,
        status: e.data.status ?? null,
      },
    };
  }
}
