import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';

const WINDOW_SECONDS = 15 * 60;
const LOCAL_KEY = 'local-only-otp-hmac-key-not-a-secret-0000';

/**
 * Per-account failed sign-in counter (credential stuffing / brute force), complementing the
 * per-IP limiter. Keyed by an HMAC of the submitted e-mail — existing or not — so blocking
 * reveals nothing about which accounts exist. After LOGIN_MAX_FAILURES failures in 15 minutes
 * further attempts are refused BEFORE any password hashing until the window expires; a
 * password reset is always available. Redis unavailable ⇒ 503 (fail closed, ADR-0013).
 */
@Injectable()
export class LoginThrottle {
  private readonly logger = new Logger(LoginThrottle.name);
  private readonly key: string;
  private readonly max: number;

  constructor(
    private readonly redis: RedisService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.key = env.OTP_HMAC_KEY ?? LOCAL_KEY;
    this.max = env.LOGIN_MAX_FAILURES;
  }

  async assertAllowed(email: string): Promise<void> {
    const count = await this.call((r) => r.get(this.redisKey(email)));
    if (Number(count ?? 0) >= this.max) {
      this.logger.warn({ limiter: 'login_per_account' }, 'Sign-in attempts blocked');
      throw new ApiError(
        'RATE_LIMITED',
        'Too many sign-in attempts. Try again in 15 minutes, or reset your password.',
        { retryable: true, nextOptions: ['RESET_PASSWORD'] },
      );
    }
  }

  async recordFailure(email: string): Promise<void> {
    const k = this.redisKey(email);
    await this.call((r) => r.multi().incr(k).expire(k, WINDOW_SECONDS, 'NX').exec());
  }

  async reset(email: string): Promise<void> {
    await this.call((r) => r.del(this.redisKey(email)));
  }

  private redisKey(email: string): string {
    const id = createHmac('sha256', this.key)
      .update(`login:${email.trim().toLowerCase()}`)
      .digest('hex');
    return `karen:loginfail:${id.slice(0, 40)}`;
  }

  private async call<T>(fn: (r: RedisService['client']) => Promise<T>): Promise<T> {
    try {
      return await fn(this.redis.client);
    } catch (error) {
      this.logger.warn({ err: error }, 'Login throttle unavailable; refusing sign-in');
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Sign-in is temporarily unavailable.', {
        retryable: true,
        cause: error,
      });
    }
  }
}
