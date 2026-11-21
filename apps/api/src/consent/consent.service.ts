import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ConsentDecisionRequest,
  ConsentDecisionResult,
  ConsentHistory,
  ConsentReceipt as ReceiptDto,
  ConsentState,
  ConsentStateList,
  LegalStatus,
  Notice as NoticeDto,
  NoticeKind,
  NoticeList,
  PurposeCatalog,
  ReceiptVerification,
} from '@karen/api-contracts';
import {
  CONSENT_CATALOG,
  CONSENT_PURPOSES,
  type ConsentPurpose,
  consentDefinition,
  consentDependents,
} from '@karen/domain';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { securityEvent } from '../common/security-metrics.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import type { ConsentReceipt, ConsentStatus, Notice } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';

const LOCAL_RECEIPT_KEY = 'local-only-consent-receipt-key-not-a-secret';
const DECISION_FROM_STATUS: Record<ConsentStatus, ConsentState['decision']> = {
  ACTIVE: 'granted',
  DENIED: 'denied',
  REVOKED: 'revoked',
  EXPIRED: 'revoked',
};
type Decision = 'granted' | 'denied' | 'revoked';

/**
 * Purpose-specific consent (Phase 01 M6, ADR-0019).
 *
 * - The current decision per (user, purpose) lives in consent.consent_grants with a version
 *   (If-Match); every change appends a receipt to a per-user hash chain in the SAME transaction
 *   (consent.consent_receipts, append-only by trigger). Receipts carry the notice version AND the
 *   hash of the exact notice text, the source and method, and a server-keyed MAC.
 * - Per-user serialization (row lock on identity.users) gives receipts a gap-free sequence.
 * - Revoking a purpose revokes everything that depends on it (with its own receipt).
 * - Enforcement is server-side: `hasActiveConsent` / `requireConsent` and @RequireConsent().
 */
@Injectable()
export class ConsentService {
  private readonly receiptKey: string;
  private readonly receiptKeyId: string;
  private readonly allowDrafts: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.receiptKey = env.CONSENT_RECEIPT_KEY ?? LOCAL_RECEIPT_KEY;
    this.receiptKeyId = createHash('sha256').update(this.receiptKey).digest('hex').slice(0, 8);
    this.allowDrafts = env.ALLOW_DRAFT_NOTICES;
  }

  // ── Enforcement ─────────────────────────────────────────────────────────────────────────

  /** Deny by default: no active, unexpired grant → false. */
  async hasActiveConsent(
    userId: string,
    purpose: ConsentPurpose,
    scope = '*',
    now = new Date(),
  ): Promise<boolean> {
    // RLS scope + explicit userId filter: two independent layers must agree.
    const grant = await this.prisma.withUserScope(userId, (tx) =>
      tx.consentGrant.findFirst({
        where: {
          userId,
          purpose,
          status: 'ACTIVE',
          scope: { in: scope === '*' ? ['*'] : ['*', scope] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      }),
    );
    return grant !== null;
  }

  /** Throws CONSENT_REQUIRED (403) unless the purpose is actively granted. */
  async requireConsent(userId: string, purpose: ConsentPurpose): Promise<void> {
    if (!(await this.hasActiveConsent(userId, purpose))) {
      throw new ApiError('CONSENT_REQUIRED', 'This needs your permission first.', {
        nextOptions: [`GRANT_CONSENT:${purpose}`],
      });
    }
  }

  // ── Notices & catalog (public) ──────────────────────────────────────────────────────────

  async listNotices(): Promise<NoticeList> {
    const rows = await this.prisma.notice.findMany({
      where: { state: { in: this.servableStates() } },
      orderBy: [{ kind: 'asc' }, { locale: 'asc' }, { createdAt: 'desc' }],
    });
    // Latest servable version per (kind, locale), approved preferred over draft.
    const latest = new Map<string, Notice>();
    for (const n of rows) {
      const key = `${n.kind}/${n.locale}`;
      const prev = latest.get(key);
      if (!prev || (prev.state === 'draft' && n.state === 'approved')) latest.set(key, n);
    }
    return { items: [...latest.values()].map(toNoticeSummary) };
  }

  async getNotice(kind: string, version: string, locale: string): Promise<NoticeDto> {
    const n = await this.prisma.notice.findFirst({
      where: { kind, version, locale, state: { in: [...this.servableStates(), 'retired'] } },
    });
    if (!n) throw new ApiError('NOT_FOUND', 'Notice not found.');
    return { ...toNoticeSummary(n), content: n.content };
  }

  catalog(): PurposeCatalog {
    return {
      items: CONSENT_CATALOG.map((d) => ({
        purpose: d.purpose,
        title: d.title,
        description: d.description,
        availability: d.availability,
        depends_on: [...d.dependsOn],
        legal_basis_status: d.legalBasisStatus,
      })),
    };
  }

  // ── Decisions ───────────────────────────────────────────────────────────────────────────

  async currentStates(userId: string): Promise<ConsentStateList> {
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.consentGrant.findMany({ where: { userId, scope: '*' } }),
    );
    const byPurpose = new Map(rows.map((r) => [r.purpose, r]));
    return {
      items: CONSENT_PURPOSES.map((purpose) => {
        const r = byPurpose.get(purpose);
        return r
          ? {
              purpose,
              decision: DECISION_FROM_STATUS[r.status],
              version: r.version,
              decided_at: (r.revokedAt ?? r.grantedAt).toISOString(),
              notice_version: r.policyVersion,
            }
          : { purpose, decision: 'not_asked', version: 0, decided_at: null, notice_version: null };
      }),
    };
  }

  async decide(
    userId: string,
    purpose: ConsentPurpose,
    expectedVersion: number,
    req: ConsentDecisionRequest,
    idempotencyKey?: string,
  ): Promise<ConsentDecisionResult> {
    const def = consentDefinition(purpose);
    if (req.decision === 'grant' && def.availability !== 'available') {
      throw new ApiError('VALIDATION_FAILED', 'This permission is not available yet.', {
        details: [{ path: 'purpose', message: 'purpose_not_available' }],
      });
    }
    const notice = await this.prisma.notice.findFirst({
      where: {
        kind: 'privacy_notice',
        version: req.notice_version,
        state: { in: this.servableStates() },
      },
      orderBy: { locale: 'asc' },
    });
    if (!notice) {
      throw new ApiError('VALIDATION_FAILED', 'Unknown privacy notice version.', {
        details: [{ path: 'notice_version', message: 'unknown_notice_version' }],
      });
    }

    try {
      return await this.prisma.withUserScope(userId, async (tx) => {
        // Serialize all consent changes of this user (gap-free receipt sequence).
        await tx.$queryRaw`SELECT id FROM identity.users WHERE id = ${userId}::uuid FOR UPDATE`;

        if (idempotencyKey) {
          const prior = await tx.consentReceipt.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey } },
          });
          if (prior) {
            if (prior.purpose !== purpose || prior.decision !== pastTense(req.decision)) {
              throw new ApiError(
                'CONFLICT',
                'This Idempotency-Key was used for a different request.',
              );
            }
            const state = (await this.currentStatesTx(tx, userId)).find(
              (s) => s.purpose === purpose,
            );
            return { state: state as ConsentState, receipts: [toReceiptDto(prior)] };
          }
        }

        const current = await tx.consentGrant.findUnique({
          where: { userId_purpose_scope: { userId, purpose, scope: '*' } },
        });
        if ((current?.version ?? 0) !== expectedVersion) {
          throw new ApiError(
            'PRECONDITION_FAILED',
            'This setting changed since you loaded it. Reload and try again.',
          );
        }
        const active = current?.status === 'ACTIVE';
        if (req.decision === 'revoke' && !active) {
          throw new ApiError('CONFLICT', 'There is no active permission to withdraw.');
        }
        if (req.decision === 'deny' && active) {
          throw new ApiError('CONFLICT', 'Use "revoke" to withdraw an active permission.');
        }
        if (req.decision === 'grant') {
          for (const dep of def.dependsOn) {
            const g = await tx.consentGrant.findUnique({
              where: { userId_purpose_scope: { userId, purpose: dep, scope: '*' } },
              select: { status: true },
            });
            if (g?.status !== 'ACTIVE') {
              throw new ApiError(
                'CONSENT_REQUIRED',
                `Turn on "${consentDefinition(dep).title}" first.`,
                {
                  nextOptions: [`GRANT_CONSENT:${dep}`],
                },
              );
            }
          }
        }

        const receipts: ConsentReceipt[] = [];
        const primary = await this.applyDecision(
          tx,
          userId,
          purpose,
          pastTense(req.decision),
          notice,
          {
            source: req.source,
            method: 'explicit',
            idempotencyKey: idempotencyKey ?? null,
          },
        );
        receipts.push(primary);
        if (req.decision === 'revoke') {
          for (const dependent of consentDependents(purpose)) {
            const g = await tx.consentGrant.findUnique({
              where: { userId_purpose_scope: { userId, purpose: dependent, scope: '*' } },
              select: { status: true },
            });
            if (g?.status === 'ACTIVE') {
              receipts.push(
                await this.applyDecision(tx, userId, dependent, 'revoked', notice, {
                  source: req.source,
                  method: `cascade:${purpose}`,
                  idempotencyKey: null,
                }),
              );
            }
          }
        }
        await this.audit.record(
          {
            actorType: 'USER',
            actorRef: userId,
            action: 'consent.decision',
            subjectType: 'consent_purpose',
            subjectId: purpose,
            outcome: 'SUCCESS',
            policyDecision: 'consent:v1',
            reasonCode: pastTense(req.decision),
            metadata: {
              notice_version: notice.version,
              source: req.source,
              cascaded: receipts.length - 1,
            },
          },
          tx,
        );
        for (const r of receipts) {
          securityEvent('karen.consent.decision', { purpose: r.purpose, decision: r.decision });
        }
        const state = (await this.currentStatesTx(tx, userId)).find((s) => s.purpose === purpose);
        return { state: state as ConsentState, receipts: receipts.map(toReceiptDto) };
      });
    } catch (error) {
      // Two first-time decisions for the same idempotency key raced: the other one won.
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiError(
          'CONFLICT',
          'A request with this Idempotency-Key is already processed.',
          {
            retryable: true,
          },
        );
      }
      throw error;
    }
  }

  async history(userId: string, cursor?: number, limit = 50): Promise<ConsentHistory> {
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.consentReceipt.findMany({
        where: { userId, ...(cursor ? { seq: { lt: cursor } } : {}) },
        orderBy: { seq: 'desc' },
        take: limit + 1,
      }),
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map(toReceiptDto),
      next_cursor: rows.length > limit ? String(page.at(-1)?.seq) : null,
    };
  }

  /** Recomputes the user's receipt chain: hashes, links and MACs. */
  async verifyReceipts(userId: string): Promise<ReceiptVerification> {
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.consentReceipt.findMany({ where: { userId }, orderBy: { seq: 'asc' } }),
    );
    let prev: string | null = null;
    for (const [i, r] of rows.entries()) {
      const expectedHash = receiptHash(r, prev);
      const sequenced = r.seq === i + 1;
      if (
        !sequenced ||
        r.prevHash !== prev ||
        r.receiptHash !== expectedHash ||
        !this.macValid(r)
      ) {
        return { valid: false, receipts_checked: i + 1, first_invalid_seq: r.seq };
      }
      prev = r.receiptHash;
    }
    return { valid: true, receipts_checked: rows.length, first_invalid_seq: null };
  }

  // ── Legal acknowledgement (separate from optional consent) ──────────────────────────────

  async legalStatus(userId: string): Promise<LegalStatus> {
    const [accepted, notices] = await Promise.all([
      this.prisma.withUserScope(userId, (tx) =>
        tx.legalAcceptance.findMany({ where: { userId }, orderBy: { acceptedAt: 'desc' } }),
      ),
      this.listNotices(),
    ]);
    return {
      items: (['privacy_notice', 'terms_of_service'] as const).map((kind) => {
        const current =
          notices.items.find((n) => n.kind === kind && n.locale === 'en-IN')?.version ?? null;
        const latest = accepted.find((a) => a.documentType === kind);
        return {
          kind,
          current_version: current,
          accepted_version: latest?.documentVersion ?? null,
          accepted_at: latest ? latest.acceptedAt.toISOString() : null,
          up_to_date:
            current !== null &&
            accepted.some((a) => a.documentType === kind && a.documentVersion === current),
        };
      }),
    };
  }

  async acceptLegal(
    userId: string,
    kind: 'privacy_notice' | 'terms_of_service',
    version: string,
    locale: 'en-IN' | 'hi-IN',
  ): Promise<LegalStatus> {
    const notice = await this.prisma.notice.findFirst({
      where: { kind, version, locale, state: { in: this.servableStates() } },
    });
    if (!notice) throw new ApiError('NOT_FOUND', 'Notice not found.');
    await this.prisma.withUserScope(userId, async (tx) => {
      const existing = await tx.legalAcceptance.findUnique({
        where: {
          userId_documentType_documentVersion: {
            userId,
            documentType: kind,
            documentVersion: version,
          },
        },
      });
      if (existing) return; // idempotent
      await tx.legalAcceptance.create({
        data: {
          userId,
          documentType: kind,
          documentVersion: version,
          locale,
          noticeSha256: notice.contentSha256,
        },
      });
      await this.audit.record(
        {
          actorType: 'USER',
          actorRef: userId,
          action: 'consent.legal_accepted',
          subjectType: 'notice',
          subjectId: `${kind}:${version}`,
          outcome: 'SUCCESS',
          metadata: { locale, notice_state: notice.state },
        },
        tx,
      );
    });
    return this.legalStatus(userId);
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────

  private servableStates(): string[] {
    return this.allowDrafts ? ['approved', 'draft'] : ['approved'];
  }

  private async currentStatesTx(tx: TransactionClient, userId: string): Promise<ConsentState[]> {
    const rows = await tx.consentGrant.findMany({ where: { userId, scope: '*' } });
    return rows.map((r) => ({
      purpose: r.purpose,
      decision: DECISION_FROM_STATUS[r.status],
      version: r.version,
      decided_at: (r.revokedAt ?? r.grantedAt).toISOString(),
      notice_version: r.policyVersion,
    }));
  }

  private async applyDecision(
    tx: TransactionClient,
    userId: string,
    purpose: ConsentPurpose,
    decision: Decision,
    notice: Notice,
    meta: { source: string; method: string; idempotencyKey: string | null },
  ): Promise<ConsentReceipt> {
    const last = await tx.consentReceipt.findFirst({
      where: { userId },
      orderBy: { seq: 'desc' },
      select: { seq: true, receiptHash: true },
    });
    const occurredAt = new Date();
    const draft = {
      userId,
      seq: (last?.seq ?? 0) + 1,
      purpose,
      scope: '*',
      decision,
      noticeKind: notice.kind,
      noticeVersion: notice.version,
      noticeSha256: notice.contentSha256,
      source: meta.source,
      method: meta.method,
      occurredAt,
    };
    const hash = receiptHash(draft, last?.receiptHash ?? null);
    const receipt = await tx.consentReceipt.create({
      data: {
        ...draft,
        idempotencyKey: meta.idempotencyKey,
        prevHash: last?.receiptHash ?? null,
        receiptHash: hash,
        receiptMac: this.mac(hash),
      },
    });
    const status: ConsentStatus =
      decision === 'granted' ? 'ACTIVE' : decision === 'denied' ? 'DENIED' : 'REVOKED';
    await tx.consentGrant.upsert({
      where: { userId_purpose_scope: { userId, purpose, scope: '*' } },
      create: {
        userId,
        purpose,
        scope: '*',
        status,
        policyVersion: notice.version,
        receiptHash: hash,
        grantedAt: occurredAt,
        revokedAt: status === 'ACTIVE' ? null : occurredAt,
        version: 1,
      },
      update: {
        status,
        policyVersion: notice.version,
        receiptHash: hash,
        ...(status === 'ACTIVE'
          ? { grantedAt: occurredAt, revokedAt: null }
          : { revokedAt: occurredAt }),
        version: { increment: 1 },
      },
    });
    return receipt;
  }

  private mac(hash: string): string {
    return `hmac-sha256:${this.receiptKeyId}:${createHmac('sha256', this.receiptKey).update(hash).digest('hex')}`;
  }

  private macValid(r: ConsentReceipt): boolean {
    const expected = Buffer.from(this.mac(r.receiptHash));
    const actual = Buffer.from(r.receiptMac);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

/** Canonical, versioned receipt serialization → sha256 (chained through prev_hash). */
export function receiptHash(
  r: {
    userId: string;
    seq: number;
    purpose: string;
    scope: string;
    decision: string;
    noticeKind: string;
    noticeVersion: string;
    noticeSha256: string;
    source: string;
    method: string;
    occurredAt: Date;
  },
  prevHash: string | null,
): string {
  const canonical = JSON.stringify([
    'karen.consent-receipt.v1',
    r.userId,
    r.seq,
    r.purpose,
    r.scope,
    r.decision,
    r.noticeKind,
    r.noticeVersion,
    r.noticeSha256,
    r.source,
    r.method,
    r.occurredAt.toISOString(),
    prevHash,
  ]);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

const pastTense = (d: ConsentDecisionRequest['decision']): Decision =>
  d === 'grant' ? 'granted' : d === 'deny' ? 'denied' : 'revoked';

function toNoticeSummary(n: Notice): NoticeList['items'][number] {
  return {
    kind: n.kind as NoticeKind,
    locale: n.locale as 'en-IN' | 'hi-IN',
    version: n.version,
    // Retired notices are only reachable by exact version and are shown as the approved text.
    state: n.state === 'draft' ? 'draft' : 'approved',
    effective_from: n.effectiveFrom ? n.effectiveFrom.toISOString() : null,
    content_sha256: n.contentSha256,
  };
}

function toReceiptDto(r: ConsentReceipt): ReceiptDto {
  return {
    id: r.id,
    seq: r.seq,
    purpose: r.purpose,
    decision: r.decision as ReceiptDto['decision'],
    notice_kind: r.noticeKind as NoticeKind,
    notice_version: r.noticeVersion,
    notice_sha256: r.noticeSha256,
    source: r.source,
    method: r.method,
    occurred_at: r.occurredAt.toISOString(),
    prev_hash: r.prevHash,
    receipt_hash: r.receiptHash,
  };
}
