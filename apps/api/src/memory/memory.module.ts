import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module.js';
import { MemoryExtractionService } from './memory-extraction.service.js';
import { InternalMemoryController } from './memory-internal.controller.js';
import { MemoryMaintenanceService } from './memory-maintenance.service.js';
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
  imports: [UsageModule],
  controllers: [MemoryController, InternalMemoryController],
  providers: [
    MemoryService,
    MemoryConsentService,
    MemoryDeletionService,
    MemoryExportService,
    MemoryRateLimiter,
    MemoryRetrievalService,
    MemoryTurnService,
    MemoryExtractionService,
    MemoryMaintenanceService,
  ],
  exports: [
    MemoryConsentService,
    MemoryDeletionService,
    MemoryExportService,
    MemoryRetrievalService,
    MemoryTurnService,
    MemoryMaintenanceService,
  ],
})
export class MemoryModule {}
