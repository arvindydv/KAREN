import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { securityEvent } from '../common/security-metrics.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';

const WINDOW_SECONDS = 3600;
const LOCAL_KEY = 'local-only-otp-hmac-key-not-a-secret-0000';

/**
 * Per-recipient hourly cap on auth e-mails (anti mail-bombing, anti SMTP-cost abuse). The
 * Redis key is an HMAC of the canonical address — no e-mail addresses in Redis. Redis
 * unavailable ⇒ 503 (fail closed, ADR-0013), never "send anyway".
 */
@Injectable()
export class EmailSendBudget {
  private readonly logger = new Logger(EmailSendBudget.name);
  private readonly key: string;
  private readonly limit: number;

  constructor(
    private readonly redis: RedisService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.key = env.OTP_HMAC_KEY ?? LOCAL_KEY;
    this.limit = env.EMAIL_SEND_LIMIT_PER_HOUR;
  }

  /** Consumes one unit for this address; false when the hourly budget is exhausted. */
  async take(canonicalEmail: string): Promise<boolean> {
    const id = createHmac('sha256', this.key).update(`mail:${canonicalEmail}`).digest('hex');
    const redisKey = `karen:mailbudget:${id.slice(0, 40)}`;
    let count: number;
    try {
      const result = await this.redis.client
        .multi()
        .incr(redisKey)
        .expire(redisKey, WINDOW_SECONDS, 'NX')
        .exec();
      count = Number(result?.[0]?.[1]);
      if (!Number.isFinite(count)) throw new Error('unexpected Redis reply');
    } catch (error) {
      this.logger.warn({ err: error }, 'E-mail budget unavailable; refusing to send');
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Please try again in a moment.', {
        retryable: true,
        cause: error,
      });
    }
    if (count > this.limit) {
      this.logger.warn({ budget: 'email_per_address' }, 'E-mail budget exhausted for an address');
      securityEvent('karen.auth.rate_limited', { limiter: 'email_per_address' });
      return false;
    }
    return true;
  }
}
