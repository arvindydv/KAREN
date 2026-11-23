import { Module } from '@nestjs/common';
import { AiUsageController, ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';
import { GenerationService } from './generation.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { StreamHub } from './stream-hub.js';
import { StreamReaderService } from './stream-reader.service.js';
import { UsageLimitsService } from './usage-limits.service.js';
import { VoiceController } from './voice.controller.js';
import { VoiceLiveService } from './voice-live.service.js';
import { VoiceService } from './voice.service.js';

/**
 * Conversation domain (Phase 02, ADR-0021…0023). Owns the `conversation` schema and the
 * `platform.ai_invocations` / `platform.usage_ledger` tables. Reaches the model only through
 * AiServiceClient (signed internal calls); never the gateway. Voice (ADR-0026) lives here too:
 * it shares consent, per-user limits and the ledger with chat, and stores no audio.
 */
@Module({
  controllers: [ConversationController, AiUsageController, VoiceController],
  providers: [
    ConversationService,
    GenerationService,
    MaintenanceService,
    StreamHub,
    StreamReaderService,
    UsageLimitsService,
    VoiceService,
    VoiceLiveService,
  ],
  exports: [MaintenanceService],
})
export class ConversationModule {}
