import { Global, Module } from '@nestjs/common';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthFlowsService } from './auth-flows.service.js';
import { ChallengeService } from './challenge.service.js';
import { EmailSendBudget } from './email-send-budget.js';
import { LoginThrottle } from './login-throttle.js';
import { LoginService } from './login.service.js';
import { SessionService } from './session.service.js';
import { SessionsController } from './sessions.controller.js';
import { IdentityService } from './identity.service.js';
import { MeController } from './me.controller.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Global()
@Module({
  controllers: [MeController, AuthController, SessionsController, ProfileController],
  providers: [
    IdentityService,
    AccountService,
    ChallengeService,
    EmailSendBudget,
    AuthFlowsService,
    SessionService,
    LoginService,
    LoginThrottle,
    ProfileService,
  ],
  exports: [IdentityService, AccountService, SessionService],
})
export class IdentityModule {}
