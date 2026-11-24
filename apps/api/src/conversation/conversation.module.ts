import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { AiUsageController, ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';
import { GenerationService } from './generation.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { StreamHub } from './stream-hub.js';
import { StreamReaderService } from './stream-reader.service.js';

/**
 * Conversation domain (Phase 02, ADR-0021…0023). Owns the `conversation` schema and the
 * `platform.ai_invocations` / `platform.usage_ledger` tables. Reaches the model only through
 * AiServiceClient (signed internal calls); never the gateway.
 */
@Module({
  imports: [MemoryModule, UsageModule],
  controllers: [ConversationController, AiUsageController],
  providers: [
    ConversationService,
    GenerationService,
    MaintenanceService,
    StreamHub,
    StreamReaderService,
  ],
  exports: [MaintenanceService],
})
export class ConversationModule {}
