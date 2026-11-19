import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { API_ENV } from '../../config/config.module.js';
import type { ApiEnv } from '../../config/env.js';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export type TransactionClient = Prisma.TransactionClient;

/**
 * Single Prisma client per process (pooled via node-postgres). Connection lifecycle is tied to
 * the Nest module lifecycle so graceful shutdown drains the pool.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(API_ENV) env: ApiEnv) {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: env.DATABASE_POOL_MAX,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        // Bound every statement so a stuck query cannot pin a request forever.
        statement_timeout: 15_000,
        application_name: 'karen-api',
      }),
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    // Lazy connect: a temporarily unavailable DB must not crash boot; readiness reports it.
    await this.$connect().catch((error: unknown) => {
      this.logger.warn(
        { err: error },
        'Database not reachable at startup; readiness will report it',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap connectivity probe for readiness. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  /**
   * Run `fn` in one database transaction. Use for every multi-row state change, and write
   * outbox events inside the same transaction so state and events cannot diverge.
   */
  withTransaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeoutMs?: number } = {},
  ): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: options.timeoutMs ?? 10_000,
      maxWait: 5_000,
    });
  }
}
