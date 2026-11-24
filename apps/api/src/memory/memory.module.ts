import { Module } from '@nestjs/common';
import { MemoryConsentService } from './memory-consent.js';
import { MemoryDeletionService } from './memory-deletion.service.js';
import { MemoryExportService } from './memory-export.service.js';
import { MemoryRateLimiter } from './memory-rate-limit.js';
import { MemoryRetrievalService } from './memory-retrieval.service.js';
import { MemoryTurnService } from './memory-turn.service.js';
import { MemoryController } from './memory.controller.js';
import { MemoryService } from './memory.service.js';

/**
 * Personal memory (Phase 03, ADR-0036). Owns the `memory` schema. Depends on consent data (read
 * on the caller's transaction), audit and infrastructure — never on `conversation`. Other
 * modules use only the narrow exports below (arch §5.4; enforced by dependency-cruiser).
 */
@Module({
  controllers: [MemoryController],
  providers: [
    MemoryService,
    MemoryConsentService,
    MemoryDeletionService,
    MemoryExportService,
    MemoryRateLimiter,
    MemoryRetrievalService,
    MemoryTurnService,
  ],
  exports: [
    MemoryConsentService,
    MemoryDeletionService,
    MemoryExportService,
    MemoryRetrievalService,
    MemoryTurnService,
  ],
})
export class MemoryModule {}
