import { Global, Module } from '@nestjs/common';
import { MyConsentController, NoticesController } from './consent.controller.js';
import { ConsentGuard } from './consent.guard.js';
import { ConsentService } from './consent.service.js';

@Global()
@Module({
  controllers: [NoticesController, MyConsentController],
  providers: [ConsentService, ConsentGuard],
  exports: [ConsentService, ConsentGuard],
})
export class ConsentModule {}
