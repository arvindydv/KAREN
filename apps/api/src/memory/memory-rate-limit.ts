import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';

export type MemorySensitiveAction = 'clear' | 'restore' | 'export';

/**
 * Per-USER limit on the expensive / destructive memory routes (03C-09): clear, restore, export,
 * on top of the global per-IP throttler. Fixed hourly window per action. Fails CLOSED when Redis
 * is unavailable (same rule as the chat limiter), so an outage cannot become unlimited bulk work.
 * Keys hold only the user id and a counter (no content).
 */
@Injectable()
export class MemoryRateLimiter {
  constructor(
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async hit(userId: string, action: MemorySensitiveAction): Promise<void> {
    const key = `karen:memory:limit:${action}:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
    let count: number;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, 7_200);
    } catch (error) {
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Please try again shortly.', {
        retryable: true,
        cause: error,
      });
    }
    if (count > this.env.MEMORY_SENSITIVE_ACTIONS_PER_HOUR) {
      throw new ApiError('RATE_LIMITED', 'Too many requests. Please try again later.', {
        retryable: true,
      });
    }
  }
}
