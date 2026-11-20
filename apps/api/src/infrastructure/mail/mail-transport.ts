import { createTransport, type Transporter } from 'nodemailer';

/** A fully rendered transactional message. Contents may include one-time codes: never log. */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable template id for logs/metrics (e.g. `auth.email_verification`). */
  template: string;
}

export interface MailTransport {
  readonly kind: 'brevo-smtp' | 'memory';
  send(message: OutgoingMail): Promise<{ messageId: string }>;
}

/** Permanent SMTP rejection (5xx): retrying cannot help. */
export class PermanentMailError extends Error {
  constructor(
    readonly responseCode: number | undefined,
    cause?: unknown,
  ) {
    super(`Mail permanently rejected (${responseCode ?? 'unknown'})`, { cause });
    this.name = 'PermanentMailError';
  }
}

export interface BrevoSmtpOptions {
  host: string;
  port: number;
  login: string;
  key: string;
  from: string;
}

/**
 * Brevo SMTP relay. STARTTLS is REQUIRED (no plaintext fallback), TLS ≥ 1.2, certificate
 * verification on. Credentials come from config (Secrets Manager when deployed).
 */
export class BrevoSmtpTransport implements MailTransport {
  readonly kind = 'brevo-smtp' as const;
  private readonly transporter: Transporter;

  constructor(private readonly options: BrevoSmtpOptions) {
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
      requireTLS: options.port !== 465,
      auth: { user: options.login, pass: options.key },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      pool: true,
      maxConnections: 3,
      // Never let nodemailer log message bodies (they contain one-time codes).
      logger: false,
      debug: false,
    });
  }

  async send(message: OutgoingMail): Promise<{ messageId: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { 'X-Mailin-Tag': message.template }, // Brevo tag for delivery analytics
      });
      return { messageId: String(info.messageId) };
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode;
      if (code !== undefined && code >= 500) throw new PermanentMailError(code, error);
      throw error;
    }
  }

  close(): void {
    this.transporter.close();
  }
}

/** LOCAL/TEST ONLY (config refuses it when deployed): keeps messages in memory. */
export class MemoryMailTransport implements MailTransport {
  readonly kind = 'memory' as const;
  readonly messages: OutgoingMail[] = [];
  private seq = 0;
  /** Test hook: make the next N sends fail (transient). */
  failNext = 0;

  send(message: OutgoingMail): Promise<{ messageId: string }> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error('memory transport: injected transient failure'));
    }
    this.messages.push(message);
    this.seq += 1;
    return Promise.resolve({ messageId: `memory-${this.seq}` });
  }

  to(address: string): OutgoingMail[] {
    return this.messages.filter((m) => m.to.toLowerCase() === address.toLowerCase());
  }
}
