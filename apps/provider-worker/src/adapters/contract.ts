/**
 * Provider adapter contract. Every external integration implements this interface and
 * declares its capabilities in a validated ProviderDescriptor. The registry refuses to call
 * an operation the descriptor does not declare — a search-only provider can never "book".
 */
import type {
  ProviderCapability,
  ProviderDescriptor,
  ProviderOperationRequest,
  ProviderOperationOutcome,
  ProviderProvenance,
  ProviderStatusResult,
} from '@karen/domain';

export interface SearchQuery {
  query: string;
  geography: string;
}

export interface SearchResult {
  items: { id: string; title: string }[];
  provenance: ProviderProvenance;
}

/** Thrown when the provider's response is ambiguous (timeout after send, 5xx after commit…). */
export class ProviderAmbiguousError extends Error {
  readonly type = 'ProviderAmbiguousError';
}

export interface VerifiedWebhookEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  /** Correlation back to our operation (merchant reference / idempotency key). */
  merchantReference: string | null;
  providerOperationId: string | null;
  status: string | null;
}

export type WebhookVerification =
  | { ok: true; event: VerifiedWebhookEvent }
  | {
      ok: false;
      reason: 'MALFORMED' | 'SIGNATURE_MISMATCH' | 'TIMESTAMP_OUT_OF_TOLERANCE' | 'INVALID_PAYLOAD';
    };

export interface ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  search?(query: SearchQuery): Promise<SearchResult>;
  /** Side-effecting operations MUST be idempotent on request.idempotencyKey. */
  execute?(request: ProviderOperationRequest): Promise<ProviderOperationOutcome>;
  status?(idempotencyKey: string): Promise<ProviderStatusResult>;
  verifyWebhook?(
    rawBody: string,
    headers: Record<string, string | undefined>,
    nowUnixSeconds: number,
  ): WebhookVerification;
}

export type { ProviderCapability };
