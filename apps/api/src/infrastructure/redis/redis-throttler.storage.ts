import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { ApiError } from '../../common/api-error.js';
import { RedisService } from './redis.service.js';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/** Throttlers whose limits must hold even when Redis is down (authentication, OTP, approvals…). */
export const FAIL_CLOSED_THROTTLERS: ReadonlySet<string> = new Set(['sensitive']);

/** Upper bound on keys held by the in-process fallback so an outage cannot exhaust memory. */
const FALLBACK_MAX_KEYS = 50_000;

/**
 * Rate-limit storage. Primary: a fixed window in Redis so limits hold across API replicas.
 * The window key is created with its TTL atomically (`SET NX PX` inside MULTI), so a crash can
 * never leave a key without expiry (which would block a client forever).
 *
 * Redis failure behaviour (ADR-0013):
 * - `sensitive` throttler (auth and other abuse-critical routes): FAIL CLOSED — the request is
 *   rejected with a retryable DEPENDENCY_UNAVAILABLE (503). An attacker must never gain
 *   unlimited attempts by degrading Redis.
 * - every other throttler: DEGRADES to a bounded per-process fixed window. Limits then hold per
 *   replica (N replicas ⇒ up to N × limit) instead of disappearing entirely.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new Map<string, { hits: number; expiresAt: number }>();
  /** Clock for the in-process fallback window (overridable in tests). */
  now: () => number = Date.now;

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `karen:ratelimit:${throttlerName}:${key}`;
    let hits: number;
    let ttlMs: number;
    try {
      const results = await this.redis.client
        .multi()
        .set(redisKey, '0', 'PX', ttl, 'NX')
        .incr(redisKey)
        .pttl(redisKey)
        .exec();
      if (!results || results.some(([err]) => err !== null)) {
        throw new Error('rate-limit transaction failed');
      }
      hits = Number(results[1]?.[1]);
      ttlMs = Number(results[2]?.[1]);
      if (!Number.isFinite(hits) || !Number.isFinite(ttlMs)) {
        throw new Error('unexpected rate-limit reply');
      }
      if (ttlMs < 0) ttlMs = ttl; // defensive: SET NX PX guarantees a TTL on creation
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      if (FAIL_CLOSED_THROTTLERS.has(throttlerName)) {
        this.logger.error(
          { throttler: throttlerName, reason },
          'Rate-limit store unavailable; failing closed',
        );
        throw new ApiError(
          'DEPENDENCY_UNAVAILABLE',
          'This action is temporarily unavailable. Please try again shortly.',
          { retryable: true, cause: error },
        );
      }
      this.logger.warn(
        { throttler: throttlerName, reason },
        'Rate-limit store unavailable; using per-process fallback',
      );
      ({ hits, ttlMs } = this.incrementFallback(redisKey, ttl));
    }
    const isBlocked = hits > limit;
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(ttlMs / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(Math.max(ttlMs, blockDuration) / 1000) : 0,
    };
  }

  private incrementFallback(key: string, ttl: number): { hits: number; ttlMs: number } {
    const now = this.now();
    let entry = this.fallback.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (this.fallback.size >= FALLBACK_MAX_KEYS) this.evictExpired(now);
      entry = { hits: 0, expiresAt: now + ttl };
      this.fallback.set(key, entry);
    }
    entry.hits += 1;
    return { hits: entry.hits, ttlMs: entry.expiresAt - now };
  }

  private evictExpired(now: number): void {
    for (const [k, v] of this.fallback) if (v.expiresAt <= now) this.fallback.delete(k);
    // Still full of live windows: drop the oldest insertion (Map preserves insertion order).
    while (this.fallback.size >= FALLBACK_MAX_KEYS) {
      const oldest = this.fallback.keys().next().value;
      if (oldest === undefined) break;
      this.fallback.delete(oldest);
    }
  }
}
