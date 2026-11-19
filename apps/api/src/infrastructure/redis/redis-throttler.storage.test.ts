import { describe, expect, it } from 'vitest';
import { ApiError } from '../../common/api-error.js';
import type { RedisService } from './redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

const failingRedis = {
  client: {
    multi: () => ({
      set() {
        return this;
      },
      incr() {
        return this;
      },
      pttl() {
        return this;
      },
      exec: () => Promise.reject(new Error('Connection is closed.')),
    }),
  },
} as unknown as RedisService;

describe('RedisThrottlerStorage when Redis is unavailable', () => {
  it('fails closed for the sensitive throttler', async () => {
    const storage = new RedisThrottlerStorage(failingRedis);
    await expect(storage.increment('ip', 60_000, 5, 0, 'sensitive')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.code === 'DEPENDENCY_UNAVAILABLE',
    );
  });

  it('keeps enforcing the default limit per process and resets after the window', async () => {
    const storage = new RedisThrottlerStorage(failingRedis);
    let now = 1_000_000;
    storage.now = () => now;
    const hit = () => storage.increment('ip', 60_000, 2, 0, 'default');
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(true);
    now += 60_001;
    expect((await hit()).isBlocked).toBe(false);
  });
});
