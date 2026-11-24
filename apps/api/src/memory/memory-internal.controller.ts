import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { InternalAuthGuard } from '../common/internal-auth.guard.js';
import { MemoryExtractionService, type StepResult } from './memory-extraction.service.js';

const uuid = () => new ParseUUIDPipe({ version: '4' });

/**
 * Worker → API steps of `memoryExtractionWorkflow` (arch §8.3). Signed internal calls only
 * (`InternalAuthGuard`: HMAC, ±300 s, replay nonce, fail closed); never part of the public API and
 * blocked at the edge. The path carries the job id only; the user is re-derived from the job row.
 */
@ApiExcludeController()
@Public()
@UseGuards(InternalAuthGuard)
@Controller({ path: 'internal/v1/memory/extraction-jobs', version: VERSION_NEUTRAL })
export class InternalMemoryController {
  constructor(private readonly extraction: MemoryExtractionService) {}

  @Post(':id/run')
  @HttpCode(200)
  run(@Param('id', uuid()) id: string): Promise<StepResult> {
    return this.extraction.run(id);
  }

  @Post(':id/abandon')
  @HttpCode(200)
  abandon(@Param('id', uuid()) id: string): Promise<StepResult> {
    return this.extraction.abandon(id);
  }
}
