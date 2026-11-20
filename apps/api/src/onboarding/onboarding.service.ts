import { ONBOARDING_STEPS, type OnboardingState, type OnboardingStep } from '@karen/api-contracts';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';

interface Row {
  status: string;
  completedSteps: string[];
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * Onboarding progress (Phase 01 M5). Every transition is a single atomic upsert:
 *  - completing a step unions it into the stored set (idempotent, commutative — retries and
 *    several devices converge; no read-modify-write race);
 *  - completing a step after skipping resumes onboarding;
 *  - skip / resume / complete are idempotent; `completed` is final (later steps still recorded).
 * Onboarding never gates product access; it only drives the first-run experience.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<OnboardingState> {
    const row = await this.prisma.withUserScope(userId, (tx) =>
      tx.onboardingProgress.findUnique({ where: { userId } }),
    );
    return toState(row);
  }

  async completeStep(userId: string, step: OnboardingStep): Promise<OnboardingState> {
    return this.mutate(userId, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO identity.onboarding_progress (user_id, status, completed_steps, updated_at)
        VALUES (${userId}::uuid, 'in_progress', ARRAY[${step}]::varchar(32)[], now())
        ON CONFLICT (user_id) DO UPDATE SET
          completed_steps = (
            SELECT array_agg(DISTINCT s ORDER BY s)
            FROM unnest(onboarding_progress.completed_steps || EXCLUDED.completed_steps) AS s),
          status = CASE WHEN onboarding_progress.status = 'skipped' THEN 'in_progress'
                        ELSE onboarding_progress.status END,
          skipped_at = CASE WHEN onboarding_progress.status = 'skipped' THEN NULL
                            ELSE onboarding_progress.skipped_at END,
          updated_at = now()`;
    });
  }

  async skip(userId: string): Promise<OnboardingState> {
    return this.mutate(
      userId,
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO identity.onboarding_progress (user_id, status, skipped_at, updated_at)
          VALUES (${userId}::uuid, 'skipped', now(), now())
          ON CONFLICT (user_id) DO UPDATE SET
            status = CASE WHEN onboarding_progress.status = 'completed' THEN 'completed' ELSE 'skipped' END,
            skipped_at = CASE WHEN onboarding_progress.status = 'completed' THEN NULL
                              ELSE COALESCE(onboarding_progress.skipped_at, now()) END,
            updated_at = now()`;
      },
      'identity.onboarding.skipped',
    );
  }

  async resume(userId: string): Promise<OnboardingState> {
    return this.mutate(userId, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO identity.onboarding_progress (user_id, status, updated_at)
        VALUES (${userId}::uuid, 'in_progress', now())
        ON CONFLICT (user_id) DO UPDATE SET
          status = CASE WHEN onboarding_progress.status = 'skipped' THEN 'in_progress'
                        ELSE onboarding_progress.status END,
          skipped_at = NULL,
          updated_at = now()`;
    });
  }

  async complete(userId: string): Promise<OnboardingState> {
    return this.mutate(
      userId,
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO identity.onboarding_progress (user_id, status, completed_at, updated_at)
          VALUES (${userId}::uuid, 'completed', now(), now())
          ON CONFLICT (user_id) DO UPDATE SET
            status = 'completed',
            completed_at = COALESCE(onboarding_progress.completed_at, now()),
            skipped_at = NULL,
            updated_at = now()`;
      },
      'identity.onboarding.completed',
    );
  }

  private async mutate(
    userId: string,
    write: (tx: TransactionClient) => Promise<void>,
    auditAction?: string,
  ): Promise<OnboardingState> {
    const row = await this.prisma.withUserScope(userId, async (tx) => {
      await write(tx);
      if (auditAction) {
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: userId,
            action: auditAction,
            subjectType: 'user',
            subjectId: userId,
            outcome: 'SUCCESS',
          },
          tx,
        );
      }
      return tx.onboardingProgress.findUniqueOrThrow({ where: { userId } });
    });
    return toState(row);
  }
}

function toState(row: Row | null): OnboardingState {
  const done = new Set(row?.completedSteps ?? []);
  const completed = ONBOARDING_STEPS.filter((s) => done.has(s));
  return {
    status: (row?.status ?? 'not_started') as OnboardingState['status'],
    current_step: ONBOARDING_STEPS.find((s) => !done.has(s)) ?? null,
    completed_steps: completed,
    steps: [...ONBOARDING_STEPS],
    started_at: row ? row.startedAt.toISOString() : null,
    completed_at: row?.completedAt ? row.completedAt.toISOString() : null,
  };
}
