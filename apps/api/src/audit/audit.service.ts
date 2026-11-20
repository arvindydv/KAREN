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
  /** Policy that decided, with version (e.g. `rbac:v1`). Required for DENIED outcomes. */
  policyDecision?: string;
  /** Machine-readable reason code (`[a-z0-9_.:-]`, ≤ 64 chars) — never free text or PII. */
  reasonCode?: string;
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
    assertAuditSemantics(entry);
    const correlation = currentCorrelation();
    const metadata = Object.fromEntries(
      Object.entries(entry.metadata ?? {}).map(([k, v]) => [
        k,
        typeof v === 'string' ? redactText(v) : v,
      ]),
    );
    // createMany issues a plain INSERT (no RETURNING): the runtime role is INSERT-only on
    // audit.audit_events and must not be able to read the trail back.
    await (tx ?? this.prisma).auditEvent.createMany({
      data: {
        actorType: entry.actorType,
        actorRef: entry.actorRef ?? null,
        action: entry.action,
        subjectType: entry.subjectType ?? null,
        subjectId: entry.subjectId ?? null,
        outcome: entry.outcome,
        policyDecision: entry.policyDecision ?? null,
        reasonCode: entry.reasonCode ?? null,
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

const REASON_CODE_RE = /^[a-z0-9_.:-]{1,64}$/;

/** Rejects audit entries that would make the trail ambiguous or leak free text. */
export function assertAuditSemantics(entry: AuditEntry): void {
  if (entry.reasonCode !== undefined && !REASON_CODE_RE.test(entry.reasonCode)) {
    throw new TypeError('audit reasonCode must be a short machine-readable code');
  }
  if (entry.outcome === 'DENIED' && (!entry.policyDecision || !entry.reasonCode)) {
    throw new TypeError('DENIED audit events must name the policyDecision and reasonCode');
  }
}
