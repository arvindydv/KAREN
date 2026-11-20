import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { registerDbPoolMetrics } from '@karen/observability';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { API_ENV } from '../../config/config.module.js';
import type { ApiEnv } from '../../config/env.js';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export type TransactionClient = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Single Prisma client per process (pooled via node-postgres). Connection lifecycle is tied to
 * the Nest module lifecycle so graceful shutdown drains the pool.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(API_ENV) env: ApiEnv) {
    // The pool is created here (not inside the adapter) so its live counters can be exported
    // as db.client.connection.* metrics. The adapter ends it on $disconnect.
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Bound every statement so a stuck query cannot pin a request forever.
      statement_timeout: 15_000,
      application_name: 'karen-api',
    });
    super({
      adapter: new PrismaPg(pool),
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
    registerDbPoolMetrics('karen-api', 'api', pool, env.DATABASE_POOL_MAX);
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

  /**
   * Run `fn` in a transaction bound to one user for PostgreSQL row-level security.
   *
   * Sets `karen.user_id` with `set_config(..., true)` — transaction-local, so it can never
   * leak to another request through the connection pool. Every read/write of a user-owned
   * table MUST go through this; without it RLS returns no rows and rejects writes (deny by
   * default). The `userId` must come from the verified principal, never from request input.
   */
  withUserScope<T>(
    userId: string,
    fn: (tx: TransactionClient) => Promise<T>,
    options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeoutMs?: number } = {},
  ): Promise<T> {
    if (!UUID_RE.test(userId)) {
      // Programming error, not user input: fail loudly instead of running unscoped.
      throw new TypeError('withUserScope requires an internal user UUID');
    }
    return this.withTransaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('karen.user_id', ${userId}, true)`;
      return fn(tx);
    }, options);
  }
}
