import type { Redis } from 'ioredis';

/**
 * Replay protection for inbound webhooks: the first delivery of (provider, eventId) wins;
 * duplicates inside the retention window are acknowledged but not processed again.
 * The signature timestamp tolerance bounds the window an attacker could replay in.
 */
export interface ReplayGuard {
  /** Returns true if this is the first time the event is seen. */
  claim(providerId: string, eventId: string): Promise<boolean>;
}

export class RedisReplayGuard implements ReplayGuard {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 7 * 24 * 3600,
  ) {}

  async claim(providerId: string, eventId: string): Promise<boolean> {
    const result = await this.redis.set(
      `karen:webhook:seen:${providerId}:${eventId}`,
      '1',
      'EX',
      this.ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }
}

export class InMemoryReplayGuard implements ReplayGuard {
  private readonly seen = new Set<string>();
  claim(providerId: string, eventId: string): Promise<boolean> {
    const key = `${providerId}:${eventId}`;
    if (this.seen.has(key)) return Promise.resolve(false);
    this.seen.add(key);
    return Promise.resolve(true);
  }
}
