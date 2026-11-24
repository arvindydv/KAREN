import { MEMORY_WORKFLOWS, TASK_QUEUES, memoryExtractionWorkflowId } from '@karen/domain';
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
import {
  WORKFLOW_STARTER,
  type WorkflowStarter,
} from '../infrastructure/temporal/workflow-starter.js';
import { memoryCount } from './memory-metrics.js';

const LOCK_KEY = 'karen:memory:maintenance:lock';
const PURGE_BATCH = 200;

export interface SweepReport {
  rekicked: number;
  rekickFailed: number;
  staleTerminated: number;
  purged: Record<string, number>;
  usersVisited: number;
}

/**
 * Memory maintenance sweep (arch §8.5), in-process on an interval behind a short Redis lock (the
 * lock only avoids duplicate work; every step is idempotent). Calls the M2b per-user-scoped
 * definer functions as the RUNTIME role:
 *  1. re-kick: start workflows for due pending jobs (deterministic id + REJECT_DUPLICATE, so an
 *     existing execution is never duplicated; recorded as `start_called`, never as "recovered");
 *  2. stale termination: non-terminal jobs older than the DB max age → failed/abandoned_stale;
 *  3. retention purge, batch by batch until the user cursor is exhausted.
 * Counts only (no ids, no content) go to logs and metrics.
 */
@Injectable()
export class MemoryMaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MemoryMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(WORKFLOW_STARTER) private readonly workflows: WorkflowStarter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.MEMORY_MAINTENANCE_INTERVAL_SECONDS;
    if (seconds <= 0 || !this.env.MEMORY_FEATURE_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const ttl = Math.max(30, this.env.MEMORY_MAINTENANCE_INTERVAL_SECONDS - 1);
      const got = await this.redis.client.set(LOCK_KEY, String(process.pid), 'EX', ttl, 'NX');
      if (got !== 'OK') return;
      await this.sweep();
    } catch (error) {
      this.logger.warn(
        { err_class: error instanceof Error ? error.constructor.name : typeof error },
        'Memory maintenance sweep failed; will retry next interval',
      );
    }
  }

  async sweep(): Promise<SweepReport> {
    const report: SweepReport = {
      rekicked: 0,
      rekickFailed: 0,
      staleTerminated: 0,
      purged: {},
      usersVisited: 0,
    };
    const due = await this.prisma.$queryRaw<{ job_id: string }[]>`
      SELECT job_id FROM memory.due_extraction_jobs(100)`;
    for (const { job_id: jobId } of due) {
      // The workflow id needs the source message id; resolve it in the owner's scope.
      const located = await this.prisma.$queryRaw<{ user_id: string }[]>`
        SELECT user_id FROM memory.lookup_extraction_job(${jobId}::uuid)`;
      const userId = located[0]?.user_id;
      if (!userId) continue;
      const job = await this.prisma.withUserScope(userId, (tx) =>
        tx.memoryExtractionJob.findFirst({
          where: { id: jobId, userId, status: 'pending' },
          select: { sourceMessageId: true },
        }),
      );
      if (!job) continue;
      try {
        await this.workflows.start(
          MEMORY_WORKFLOWS.EXTRACTION,
          memoryExtractionWorkflowId(job.sourceMessageId),
          TASK_QUEUES.TASKS,
          { jobId },
        );
        report.rekicked += 1;
        memoryCount('karen_memory_rekick_total', { result: 'start_called' });
      } catch {
        report.rekickFailed += 1;
        memoryCount('karen_memory_rekick_total', { result: 'start_failed' });
      }
    }
    const [stale] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT memory.terminate_stale_jobs(500) AS n`;
    report.staleTerminated = stale?.n ?? 0;
    memoryCount('karen_memory_jobs_stale_terminated_total', {}, report.staleTerminated);

    let cursor: string | null = null;
    do {
      const rows: {
        next_cursor: string | null;
        users_visited: number;
        items_expired: number;
        items_suspended_purged: number;
        revisions_deleted: number;
        suggestions_deleted: number;
        access_events_deleted: number;
        jobs_deleted: number;
      }[] = await this.prisma.$queryRaw`
        SELECT * FROM memory.purge_expired(${cursor}::uuid, ${PURGE_BATCH}::int)`;
      const r = rows[0];
      if (!r) break;
      report.usersVisited += r.users_visited;
      for (const [category, n] of [
        ['items_expired', r.items_expired],
        ['items_suspended', r.items_suspended_purged],
        ['revisions', r.revisions_deleted],
        ['suggestions', r.suggestions_deleted],
        ['access_events', r.access_events_deleted],
        ['jobs', r.jobs_deleted],
      ] as const) {
        report.purged[category] = (report.purged[category] ?? 0) + n;
        memoryCount('karen_memory_purge_deleted_total', { category }, n);
      }
      cursor = r.next_cursor;
    } while (cursor !== null);
    if (report.staleTerminated > 0 || report.rekickFailed > 0) {
      this.logger.warn({ ...report, purged: undefined }, 'Memory maintenance found stuck jobs');
    }
    return report;
  }
}
