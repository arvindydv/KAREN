import type { ChatStreamEvent, MessageStatus } from '@karen/api-contracts';
import { isTerminalMessageStatus } from '@karen/api-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { terminalEventFor } from './mappers.js';
import { MaintenanceService } from './maintenance.service.js';
import { StreamHub } from './stream-hub.js';

const POLL_MS = 1_000;
export const HEARTBEAT = Symbol('heartbeat');
export type StreamItem = ChatStreamEvent | typeof HEARTBEAT;

const isTerminalEvent = (e: ChatStreamEvent) => e.type === 'complete' || e.type === 'error';

/**
 * Reads one assistant message's public event stream (ADR-0022): replays persisted events after
 * `afterSeq`, then follows live events (pub/sub) with a database poll as the safety net. Events
 * are yielded strictly in `seq` order without duplicates or gaps, and the stream ends after the
 * terminal event. A generation whose runner died (expired lease) is closed by the reaper here,
 * so a reader never waits forever.
 */
@Injectable()
export class StreamReaderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: StreamHub,
    private readonly maintenance: MaintenanceService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Ownership check BEFORE the response is committed to SSE (so 404 stays a JSON error). */
  async assertReadable(userId: string, threadId: string, messageId: string): Promise<void> {
    const row = await this.prisma.withUserScope(userId, (tx) =>
      tx.conversationMessage.findFirst({
        where: { id: messageId, threadId, userId, role: 'assistant' },
        select: { id: true, thread: { select: { expiresAt: true } } },
      }),
    );
    if (!row || (row.thread.expiresAt && row.thread.expiresAt.getTime() <= Date.now())) {
      throw new ApiError('NOT_FOUND', 'Message not found.');
    }
  }

  private async persistedAfter(userId: string, messageId: string, after: number) {
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.messageEvent.findMany({
        where: { userId, messageId, seq: { gt: after } },
        orderBy: { seq: 'asc' },
        take: 500,
        select: { payload: true },
      }),
    );
    return rows.map((r) => r.payload as unknown as ChatStreamEvent);
  }

  private async messageState(userId: string, messageId: string) {
    return this.prisma.withUserScope(userId, (tx) =>
      tx.conversationMessage.findFirst({ where: { id: messageId, userId } }),
    );
  }

  async *events(
    userId: string,
    messageId: string,
    afterSeq: number,
    signal: AbortSignal,
  ): AsyncGenerator<StreamItem> {
    let last = afterSeq;
    const live: ChatStreamEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = await this.hub.subscribe(messageId, (event) => {
      live.push(event);
      wake?.();
    });
    const onAbort = () => wake?.();
    signal.addEventListener('abort', onAbort);
    const heartbeatMs = this.env.CHAT_STREAM_HEARTBEAT_SECONDS * 1000;
    let lastSent = Date.now();
    let needDb = true;
    try {
      while (!signal.aborted) {
        if (needDb) {
          for (const event of await this.persistedAfter(userId, messageId, last)) {
            if (event.seq !== last + 1) break; // never skip: a gap is re-read next round
            last = event.seq;
            lastSent = Date.now();
            yield event;
            if (isTerminalEvent(event)) return;
          }
          needDb = false;
        }
        live.sort((a, b) => a.seq - b.seq);
        while (live.length > 0) {
          const event = live[0]!;
          if (event.seq <= last) {
            live.shift();
            continue;
          }
          if (event.seq !== last + 1) {
            needDb = true; // missed something on pub/sub: fill the gap from the database
            break;
          }
          live.shift();
          last = event.seq;
          lastSent = Date.now();
          yield event;
          if (isTerminalEvent(event)) return;
        }
        if (needDb) continue;

        const woke = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            wake = null;
            resolve(false);
          }, POLL_MS);
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve(true);
          };
          if (live.length > 0 || signal.aborted) wake();
        });
        if (woke) continue;

        // Idle: poll the database and check the message is still alive.
        needDb = true;
        const state = await this.messageState(userId, messageId);
        if (!state) return; // deleted
        if (isTerminalMessageStatus(state.status as MessageStatus)) {
          const rest = await this.persistedAfter(userId, messageId, last);
          if (rest.length === 0) {
            // Events purged by retention: describe the outcome once.
            const terminal = terminalEventFor(state);
            if (terminal && terminal.seq > last) yield terminal;
            return;
          }
        } else if (state.leaseExpiresAt && state.leaseExpiresAt.getTime() < Date.now()) {
          await this.maintenance.reapStale();
        }
        if (Date.now() - lastSent >= heartbeatMs) {
          lastSent = Date.now();
          yield HEARTBEAT;
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
    }
  }
}
