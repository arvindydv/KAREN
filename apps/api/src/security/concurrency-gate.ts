/**
 * Bounded concurrency with a bounded, time-limited wait queue.
 *
 * Password hashing is deliberately expensive (Argon2id: ~64 MiB and tens of ms per call). An
 * unauthenticated flood of login/registration requests must not be able to queue unbounded
 * work, exhaust memory or starve the libuv thread pool that DNS and file I/O share. Excess
 * work is REJECTED fast with a typed error (→ retryable 503), never queued indefinitely and
 * never executed with weakened parameters.
 */
export class GateSaturatedError extends Error {
  constructor(readonly reason: 'QUEUE_FULL' | 'QUEUE_TIMEOUT') {
    super(`Concurrency gate saturated: ${reason}`);
    this.name = 'GateSaturatedError';
  }
}

export interface ConcurrencyGateOptions {
  maxConcurrent: number;
  maxQueue: number;
  queueTimeoutMs: number;
}

interface Waiter {
  resolve: () => void;
  timer: NodeJS.Timeout;
}

export class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly options: ConcurrencyGateOptions) {
    if (options.maxConcurrent < 1 || options.maxQueue < 0 || options.queueTimeoutMs < 1) {
      throw new RangeError('ConcurrencyGate: invalid options');
    }
  }

  get stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiters.length };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.options.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.options.maxQueue) {
      return Promise.reject(new GateSaturatedError('QUEUE_FULL'));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new GateSaturatedError('QUEUE_TIMEOUT'));
        }, this.options.queueTimeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot directly to the next waiter: `active` is unchanged.
      clearTimeout(next.timer);
      next.resolve();
      return;
    }
    this.active -= 1;
  }
}
