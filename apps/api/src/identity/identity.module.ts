import { Global, Module } from '@nestjs/common';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthFlowsService } from './auth-flows.service.js';
import { ChallengeService } from './challenge.service.js';
import { EmailSendBudget } from './email-send-budget.js';
import { IdentityService } from './identity.service.js';
import { MeController } from './me.controller.js';

@Global()
@Module({
  controllers: [MeController, AuthController],
  providers: [IdentityService, AccountService, ChallengeService, EmailSendBudget, AuthFlowsService],
  exports: [IdentityService, AccountService],
})
export class IdentityModule {}
