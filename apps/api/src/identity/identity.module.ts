import { Global, Module } from '@nestjs/common';
import { AccountService } from './account.service.js';
import { IdentityService } from './identity.service.js';
import { MeController } from './me.controller.js';

@Global()
@Module({
  controllers: [MeController],
  providers: [IdentityService, AccountService],
  exports: [IdentityService, AccountService],
})
export class IdentityModule {}
