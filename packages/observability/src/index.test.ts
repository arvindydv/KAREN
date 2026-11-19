import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createLogger,
  normaliseRequestId,
  pseudonymizeUserId,
  redactText,
  runWithCorrelation,
} from './index.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, destination };
}

describe('logger', () => {
  it('redacts secrets and private content and adds correlation fields', () => {
    const { lines, destination } = capture();
    const log = createLogger({ service: 'test', environment: 'test', destination });
    runWithCorrelation({ request_id: 'req-12345678', task_id: 't1' }, () => {
      log.info(
        {
          req: { headers: { authorization: 'Bearer abc.def.ghi' } },
          body: { password: 'hunter2', prompt: 'my private health question', api_key: 'k' },
        },
        'hello',
      );
    });
    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('abc.def.ghi');
    expect(line).not.toContain('private health');
    expect(lines[0]).toMatchObject({
      request_id: 'req-12345678',
      task_id: 't1',
      service: 'test',
      level: 'info',
    });
  });
});

describe('redaction helpers', () => {
  it('scrubs bearer tokens, keys, emails, phones and long numbers', () => {
    const out = redactText(
      `Bearer abc123 ${'sk_'}live_abcdefghijklmnop asha@example.com +91 9876543210 4111111111111111`,
    );
    expect(out).not.toMatch(/abc123|sk_live|asha@|9876543210|4111111111111111/);
  });

  it('pseudonymises deterministically per key', () => {
    expect(pseudonymizeUserId('u1', 'k1')).toBe(pseudonymizeUserId('u1', 'k1'));
    expect(pseudonymizeUserId('u1', 'k1')).not.toBe(pseudonymizeUserId('u1', 'k2'));
    expect(pseudonymizeUserId('u1', 'k1')).not.toContain('u1');
  });

  it('only accepts well-formed request IDs', () => {
    expect(normaliseRequestId('req-12345678')).toBe('req-12345678');
    expect(normaliseRequestId('bad id\n')).not.toBe('bad id\n');
    expect(normaliseRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
