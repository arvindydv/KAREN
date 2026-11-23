import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';

const LOCK_KEY = 'karen:chat:maintenance:lock';

/**
 * Conversation maintenance (ADR-0021/0022), run in-process on an interval by whichever API
 * instance holds a short Redis lock:
 *  - reaper: generations whose runner stopped renewing its lease are closed as
 *    incomplete/failed with a terminal event (never re-run);
 *  - retention: expired ephemeral conversations are deleted; stream events of finished
 *    messages are purged after CHAT_EVENT_RETENTION_HOURS.
 * Both are narrow SECURITY DEFINER functions (the request role cannot read across users).
 * The lock only avoids duplicate work; both functions are idempotent and safe to run anywhere.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.CHAT_MAINTENANCE_INTERVAL_SECONDS;
    if (seconds <= 0) return;
    this.timer = setInterval(() => void this.sweep(), seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const ttl = Math.max(5, this.env.CHAT_MAINTENANCE_INTERVAL_SECONDS - 1);
      const got = await this.redis.client.set(LOCK_KEY, String(process.pid), 'EX', ttl, 'NX');
      if (got !== 'OK') return;
      await this.reapStale();
      await this.purge();
    } catch (error) {
      this.logger.warn({ err: error }, 'Conversation maintenance sweep failed; will retry');
    }
  }

  /** Closes generations whose lease expired. Returns how many were closed. */
  async reapStale(now = new Date()): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ message_id: string; status: string }[]>`
      SELECT message_id, status FROM conversation.reap_stale_generations(${now}::timestamptz)`;
    if (rows.length > 0) {
      this.logger.warn({ count: rows.length }, 'Closed generations whose runner stopped');
    }
    return rows.length;
  }

  async purge(now = new Date()): Promise<{ threads: number; events: number }> {
    const hours = this.env.CHAT_EVENT_RETENTION_HOURS;
    const [row] = await this.prisma.$queryRaw<
      { threads_deleted: number; events_deleted: number }[]
    >`
      SELECT threads_deleted, events_deleted
        FROM conversation.purge_expired(${now}::timestamptz, make_interval(hours => ${hours}::int))`;
    return { threads: row?.threads_deleted ?? 0, events: row?.events_deleted ?? 0 };
  }
}
