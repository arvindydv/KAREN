import { Module } from '@nestjs/common';
import { InternalAuthGuard } from '../common/internal-auth.guard.js';
import { DataRightsController, InternalDataRightsController } from './data-rights.controller.js';
import { DataRightsService } from './data-rights.service.js';

@Module({
  controllers: [DataRightsController, InternalDataRightsController],
  providers: [DataRightsService, InternalAuthGuard],
})
export class DataRightsModule {}
