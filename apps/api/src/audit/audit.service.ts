import { currentCorrelation, redactText } from '@karen/observability';
import { Injectable, Logger } from '@nestjs/common';
import type { ActorType, AuditOutcome } from '../generated/prisma/client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';

export interface AuditEntry {
  actorType: ActorType;
  actorRef?: string | undefined;
  action: string;
  subjectType?: string;
  subjectId?: string;
  outcome: AuditOutcome;
  /** Flat, non-sensitive metadata. Strings are scrubbed defensively before storage. */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Append-only audit trail (audit.audit_events). The table rejects UPDATE/DELETE at the
 * database level. Pass `tx` to record inside the same transaction as the audited change.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: TransactionClient): Promise<void> {
    const correlation = currentCorrelation();
    const metadata = Object.fromEntries(
      Object.entries(entry.metadata ?? {}).map(([k, v]) => [
        k,
        typeof v === 'string' ? redactText(v) : v,
      ]),
    );
    await (tx ?? this.prisma).auditEvent.create({
      data: {
        actorType: entry.actorType,
        actorRef: entry.actorRef ?? null,
        action: entry.action,
        subjectType: entry.subjectType ?? null,
        subjectId: entry.subjectId ?? null,
        outcome: entry.outcome,
        requestId: correlation?.request_id ?? null,
        traceId: correlation?.trace_id ?? null,
        metadata,
      },
    });
  }

  /**
   * For security events on paths that must not fail the request because auditing failed
   * (e.g. recording a DENIED decision). Failure is logged loudly, never swallowed silently.
   */
  async recordBestEffort(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'Failed to write audit event');
    }
  }
}
