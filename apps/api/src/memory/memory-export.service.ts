import type { MemoryExport } from '@karen/api-contracts';
import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { toMemorySuggestion } from './memory.mappers.js';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * The `memory` section of a data export (arch §10.2): every memory row of the user with
 * provenance and unexpired revisions, pending suggestions, extraction job outcomes (no content)
 * and access events (ids only). Shared by `GET /v1/memory/export` and the account export
 * (`DataRightsService.collect()`), so both are complete by construction (T-DR-01).
 * Suspended and expired-but-not-yet-purged rows are included: export shows what is stored.
 */
@Injectable()
export class MemoryExportService {
  constructor(private readonly prisma: PrismaService) {}

  build(userId: string): Promise<MemoryExport> {
    return this.prisma.withUserScope(userId, (tx) => this.buildInTx(tx, userId));
  }

  async buildInTx(tx: TransactionClient, userId: string): Promise<MemoryExport> {
    const [settings, items, revisions, suggestions, jobs, events] = await Promise.all([
      tx.memoryUserSettings.findUnique({ where: { userId } }),
      tx.memoryItem.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      tx.memoryItemRevision.findMany({
        where: { userId },
        orderBy: [{ itemId: 'asc' }, { itemVersion: 'asc' }],
      }),
      tx.memorySuggestion.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      tx.memoryExtractionJob.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      tx.memoryAccessEvent.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      settings: { ask_before_saving: settings?.askBeforeSaving ?? false },
      items: items.map((i) => ({
        id: i.id,
        kind: i.kind as MemoryExport['items'][number]['kind'],
        slot: i.slot,
        subject: i.subject as MemoryExport['items'][number]['subject'],
        subject_label: i.subjectLabel,
        text: i.valueText,
        status: i.status as MemoryExport['items'][number]['status'],
        pinned: i.pinned,
        origin: i.origin as MemoryExport['items'][number]['origin'],
        provenance: {
          source_conversation_id: i.sourceThreadId,
          source_message_id: i.sourceMessageId,
          source_excerpt: i.sourceExcerpt,
          said_at: i.sourceRecordedAt.toISOString(),
          confirmed_at: i.confirmedAt.toISOString(),
          edited_at: iso(i.editedAt),
        },
        expires_at: iso(i.expiresAt),
        last_used_at: iso(i.lastUsedAt),
        created_at: i.createdAt.toISOString(),
        updated_at: i.updatedAt.toISOString(),
        version: i.version,
        revisions: revisions
          .filter((r) => r.itemId === i.id)
          .map((r) => ({
            version: r.itemVersion,
            kind: r.kind as MemoryExport['items'][number]['kind'],
            slot: r.slot,
            text: r.valueText,
            changed_by: r.changedBy as 'user_edit' | 'explicit_supersede',
            at: r.createdAt.toISOString(),
          })),
      })),
      suggestions: suggestions.map(toMemorySuggestion),
      extraction_jobs: jobs.map((j) => ({
        id: j.id,
        source_message_id: j.sourceMessageId,
        status: j.status as MemoryExport['extraction_jobs'][number]['status'],
        outcome_code: j.outcomeCode,
        created_at: j.createdAt.toISOString(),
      })),
      access_events: events.map((e) => ({
        item_id: e.itemId,
        reply_message_id: e.replyMessageId,
        reason: e.reason as MemoryExport['access_events'][number]['reason'],
        at: e.createdAt.toISOString(),
      })),
    };
  }
}
