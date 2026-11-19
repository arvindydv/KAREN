import type { Logger } from '@karen/observability';
import type { VerifiedWebhookEvent } from '../adapters/contract.js';

/**
 * Where verified, de-duplicated provider events go. Foundation implementation records
 * metadata only. The Responsibility Engine feature replaces it with: persist to an inbox
 * table → signal the owning Temporal workflow (looked up by merchant reference). A webhook
 * is a hint, not proof: workflows still confirm via the provider status API.
 */
export interface InboundEventSink {
  accept(providerId: string, event: VerifiedWebhookEvent): Promise<void>;
}

export class LoggingInboundEventSink implements InboundEventSink {
  constructor(private readonly log: Logger) {}
  accept(providerId: string, event: VerifiedWebhookEvent): Promise<void> {
    this.log.info(
      {
        provider_id: providerId,
        event_id: event.eventId,
        event_type: event.type,
        provider_operation_id: event.providerOperationId,
      },
      'provider.webhook.accepted',
    );
    return Promise.resolve();
  }
}
