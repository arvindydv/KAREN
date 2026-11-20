import { describe, expect, it } from 'vitest';
import { ConcurrencyGate, GateSaturatedError } from './concurrency-gate.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('ConcurrencyGate', () => {
  it('never runs more than maxConcurrent tasks at once', async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 2, maxQueue: 10, queueTimeoutMs: 1000 });
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        gate.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(gate.stats).toEqual({ active: 0, queued: 0 });
  });

  it('rejects immediately when the queue is full (no unbounded backlog)', async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 1000 });
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const second = gate.run(() => Promise.resolve('queued'));
    await expect(gate.run(() => Promise.resolve('x'))).rejects.toEqual(
      new GateSaturatedError('QUEUE_FULL'),
    );
    hold.resolve();
    await first;
    await expect(second).resolves.toBe('queued');
  });

  it('times out queued work instead of waiting forever, and frees the queue slot', async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 20 });
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    await expect(gate.run(() => Promise.resolve())).rejects.toMatchObject({
      reason: 'QUEUE_TIMEOUT',
    });
    expect(gate.stats.queued).toBe(0);
    hold.resolve();
    await first;
  });

  it('releases the slot when the task throws', async () => {
    const gate = new ConcurrencyGate({ maxConcurrent: 1, maxQueue: 0, queueTimeoutMs: 10 });
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gate.run(() => Promise.resolve(1))).resolves.toBe(1);
  });

  it('refuses nonsensical configuration', () => {
    expect(
      () => new ConcurrencyGate({ maxConcurrent: 0, maxQueue: 1, queueTimeoutMs: 1 }),
    ).toThrow();
  });
});
