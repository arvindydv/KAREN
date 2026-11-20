import { describe, expect, it, vi } from 'vitest';
import { MemoryMailTransport, PermanentMailError } from './mail-transport.js';
import { MailService } from './mail.service.js';

const msg = {
  to: 'a@example.com',
  subject: 's',
  text: 'code 123456',
  html: '<p>123456</p>',
  template: 't',
};

describe('MailService', () => {
  it('delivers asynchronously and drain() waits for it', async () => {
    const transport = new MemoryMailTransport();
    const svc = new MailService(transport);
    svc.dispatch(msg);
    expect(transport.messages).toHaveLength(0); // not synchronous
    await svc.drain();
    expect(transport.messages).toEqual([msg]);
  });

  it('retries transient failures with backoff', async () => {
    vi.useFakeTimers();
    try {
      const transport = new MemoryMailTransport();
      transport.failNext = 2;
      const svc = new MailService(transport);
      svc.dispatch(msg);
      await vi.runAllTimersAsync();
      await svc.drain();
      expect(transport.messages).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry permanent rejections and never throws to the caller', async () => {
    const send = vi.fn().mockRejectedValue(new PermanentMailError(550));
    const svc = new MailService({ kind: 'memory', send });
    svc.dispatch(msg);
    await svc.drain();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
