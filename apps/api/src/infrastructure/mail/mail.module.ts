import { Global, Module } from '@nestjs/common';
import { API_ENV } from '../../config/config.module.js';
import type { ApiEnv } from '../../config/env.js';
import { BrevoSmtpTransport, MemoryMailTransport, type MailTransport } from './mail-transport.js';
import { MAIL_TRANSPORT, MailService } from './mail.service.js';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): MailTransport =>
        env.EMAIL_TRANSPORT === 'brevo-smtp'
          ? new BrevoSmtpTransport({
              host: env.BREVO_SMTP_HOST,
              port: env.BREVO_SMTP_PORT,
              // Config validation guarantees these are present for brevo-smtp.
              login: env.BREVO_SMTP_LOGIN ?? '',
              key: env.BREVO_SMTP_KEY ?? '',
              from: env.EMAIL_FROM ?? '',
            })
          : new MemoryMailTransport(),
    },
    MailService,
  ],
  exports: [MailService, MAIL_TRANSPORT],
})
export class MailModule {}
