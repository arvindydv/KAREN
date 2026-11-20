import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { securityEvent } from '../../common/security-metrics.js';
import { PermanentMailError, type MailTransport, type OutgoingMail } from './mail-transport.js';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

const RETRY_DELAYS_MS = [1_000, 4_000, 15_000];

/**
 * Post-commit, best-effort delivery of transactional e-mail.
 *
 * Why not the outbox: OTP mails carry a one-time code, and the outbox would store it in
 * plaintext at rest. Instead the code exists only in memory between commit and send; if the
 * process dies before sending, the user taps "resend" (which rotates the code). Delivery is
 * asynchronous so SMTP latency never reveals whether an address has an account.
 *
 * Bounded retries on transient failures; permanent (5xx) rejections are not retried.
 * Logs carry the template id and outcome only — never recipient, subject or body.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly inFlight = new Set<Promise<void>>();

  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  /** Schedule delivery; returns immediately. */
  dispatch(message: OutgoingMail): void {
    // Deferred to a later tick: the request handler returns before any transport work starts.
    const job: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.deliver(message))
      .finally(() => this.inFlight.delete(job));
    this.inFlight.add(job);
  }

  /** Waits for all scheduled deliveries (graceful shutdown, tests). */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain();
    if ('close' in this.transport && typeof this.transport.close === 'function') {
      (this.transport as { close: () => void }).close();
    }
  }

  private async deliver(message: OutgoingMail): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const { messageId } = await this.transport.send(message);
        securityEvent('karen.mail.delivery', { template: message.template, outcome: 'sent' });
        this.logger.log(
          {
            template: message.template,
            transport: this.transport.kind,
            message_id: messageId,
            attempt,
          },
          'Mail sent',
        );
        return;
      } catch (error) {
        const permanent = error instanceof PermanentMailError;
        const delay = RETRY_DELAYS_MS[attempt];
        if (permanent || delay === undefined) {
          securityEvent('karen.mail.delivery', {
            template: message.template,
            outcome: permanent ? 'rejected' : 'failed',
          });
          this.logger.error(
            {
              template: message.template,
              transport: this.transport.kind,
              attempt,
              permanent,
              response_code: permanent ? error.responseCode : undefined,
            },
            'Mail delivery failed; user can request a resend',
          );
          return;
        }
        this.logger.warn({ template: message.template, attempt }, 'Mail send failed; retrying');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
