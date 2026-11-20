import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createApp } from '../src/bootstrap.js';
import type { MemoryMailTransport } from '../src/infrastructure/mail/mail-transport.js';
import { MAIL_TRANSPORT, MailService } from '../src/infrastructure/mail/mail.service.js';
import { testEnv } from './env.js';

/** Shared helpers for HTTP-level integration tests (Phase 01 M4+). */
export const PW = 'mango monsoon bicycle lantern';

export const uniqueEmail = (tag: string) =>
  `it.${tag}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@example.test`;

export async function startApp(overrides: Record<string, string> = {}) {
  const app = await createApp(testEnv({ EMAIL_SEND_LIMIT_PER_HOUR: '100', ...overrides }), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  // Like the load balancer: traffic only once Redis (fail-closed limiters) is ready.
  await request(app.getHttpServer()).get('/health/ready').expect(200);
  return app;
}

export function harness(getApp: () => NestFastifyApplication) {
  const http = () => request(getApp().getHttpServer());
  const mailbox = () => getApp().get<MemoryMailTransport>(MAIL_TRANSPORT);
  const drain = () => getApp().get(MailService).drain();

  const lastCode = async (to: string, template: string): Promise<string> => {
    await drain();
    const mail = mailbox()
      .to(to)
      .filter((m) => m.template === template)
      .at(-1);
    const code = mail ? /\b(\d{6})\b/.exec(mail.text)?.[1] : undefined;
    if (!code) throw new Error(`no ${template} code for ${to}`);
    return code;
  };

  const activeAccount = async (tag: string, password = PW): Promise<string> => {
    const email = uniqueEmail(tag);
    const res = await http().post('/v1/auth/register').send({ email, password }).expect(202);
    const code = await lastCode(email, 'auth.email_verification');
    await http()
      .post('/v1/auth/verify-email')
      .send({ challenge_handle: res.body.challenge_handle, code })
      .expect(200);
    return email;
  };

  /** Signs in as a mobile client; returns the bearer header value and ids. */
  const signIn = async (email: string, password = PW, client: 'android' | 'web' = 'android') => {
    const res = await http()
      .post('/v1/auth/login')
      .send({ email, password, client, device: { installation_id: randomUUID() } })
      .expect(200);
    const token = (res.body.access_token ?? res.body.session_token) as string;
    return {
      auth: `Bearer ${token}`,
      userId: res.body.user_id as string,
      sessionId: res.body.session_id as string,
    };
  };

  return { http, mailbox, drain, lastCode, activeAccount, signIn };
}
