import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { API_ENV } from '../../config/config.module.js';
import type { ApiEnv } from '../../config/env.js';

/**
 * Redis is used for ephemeral coordination only (rate limits, short-lived cache, idempotency
 * hints). It is never the authoritative record of anything (architecture §8).
 * All keys are namespaced `karen:<purpose>:...` and must carry a TTL.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      commandTimeout: 2_000,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
    // Errors are surfaced via readiness; log at warn without spamming stack traces.
    this.client.on('error', (err: Error) => this.logger.warn(`Redis error: ${err.message}`));
  }

  async ping(): Promise<void> {
    if (this.client.status === 'connecting' || this.client.status === 'connect') {
      // Startup: give an in-progress connection a moment instead of reporting a false outage.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('redis connect timeout')), 1_000);
        this.client.once('ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const reply = await this.client.ping();
    if (reply !== 'PONG') throw new Error('Unexpected Redis PING reply');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
