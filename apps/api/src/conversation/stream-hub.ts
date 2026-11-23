import type { ChatStreamEvent } from '@karen/api-contracts';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../infrastructure/redis/redis.service.js';

const EVENTS_PREFIX = 'karen:chat:events:';
const CANCEL_CHANNEL = 'karen:chat:cancel';

type Listener = (event: ChatStreamEvent) => void;

/**
 * Live fan-out of persisted chat events between API instances (Redis pub/sub).
 *
 * Pub/sub is a latency optimisation only: every event is committed to
 * `conversation.message_events` BEFORE it is published, and stream readers replay from the
 * database and poll it when idle. A lost publish therefore delays an event, never loses it.
 * Also carries cancel signals so the instance running a generation can abort it promptly.
 */
@Injectable()
export class StreamHub implements OnModuleDestroy {
  private readonly logger = new Logger(StreamHub.name);
  private subscriber: Redis | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly cancelListeners = new Set<(messageId: string) => void>();
  private ready: Promise<void> | null = null;

  constructor(private readonly redis: RedisService) {}

  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    const sub = this.redis.client.duplicate({
      commandTimeout: undefined,
      enableOfflineQueue: true,
    });
    this.subscriber = sub;
    sub.on('message', (channel: string, raw: string) => this.dispatch(channel, raw));
    sub.on('error', (err: Error) => this.logger.warn(`Stream hub Redis error: ${err.message}`));
    this.ready = sub.subscribe(CANCEL_CHANNEL).then(
      () => undefined,
      (error: unknown) => {
        this.logger.warn(
          { err: error },
          'Stream hub subscribe failed; readers fall back to polling',
        );
        this.ready = null;
      },
    );
    return this.ready;
  }

  private dispatch(channel: string, raw: string): void {
    if (channel === CANCEL_CHANNEL) {
      for (const fn of this.cancelListeners) fn(raw);
      return;
    }
    const messageId = channel.slice(EVENTS_PREFIX.length);
    const set = this.listeners.get(messageId);
    if (!set) return;
    let event: ChatStreamEvent;
    try {
      event = JSON.parse(raw) as ChatStreamEvent;
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Unparseable stream hub event dropped (DB replay covers it)',
      );
      return;
    }
    for (const fn of set) fn(event);
  }

  /** Subscribes to live events of one message. Returns an unsubscribe function. */
  async subscribe(messageId: string, fn: Listener): Promise<() => void> {
    await this.connect();
    let set = this.listeners.get(messageId);
    if (!set) {
      set = new Set();
      this.listeners.set(messageId, set);
      await this.subscriber
        ?.subscribe(EVENTS_PREFIX + messageId)
        .catch((error: unknown) =>
          this.logger.warn({ err: error }, 'Event subscribe failed; reader polls the database'),
        );
    }
    set.add(fn);
    return () => {
      const current = this.listeners.get(messageId);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) {
        this.listeners.delete(messageId);
        void this.subscriber?.unsubscribe(EVENTS_PREFIX + messageId).catch(() => undefined);
      }
    };
  }

  /** Publishes already-persisted events (best effort). */
  async publish(messageId: string, events: readonly ChatStreamEvent[]): Promise<void> {
    for (const event of events) {
      await this.redis.client
        .publish(EVENTS_PREFIX + messageId, JSON.stringify(event))
        .catch((error: unknown) =>
          this.logger.debug?.({ err: error }, 'Publish failed; readers poll the database'),
        );
    }
  }

  async onCancel(fn: (messageId: string) => void): Promise<void> {
    this.cancelListeners.add(fn);
    await this.connect();
  }

  async publishCancel(messageId: string): Promise<void> {
    await this.redis.client
      .publish(CANCEL_CHANNEL, messageId)
      .catch((error: unknown) =>
        this.logger.warn({ err: error }, 'Cancel publish failed; runner sees the DB flag'),
      );
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    this.cancelListeners.clear();
    await this.subscriber?.quit().catch(() => this.subscriber?.disconnect());
  }
}
