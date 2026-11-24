import type { AiUsage } from '@karen/api-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { AiServiceClient } from '../infrastructure/ai/ai-service.client.js';
import {
  PrismaService,
  type TransactionClient,
} from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';
import { usagePeriods, usdToMicro } from './usage-periods.js';

/**
 * Atomic reserve: both counters must stay within their limits after adding `amount`, or
 * nothing changes. KEYS: day, month, reservation. ARGV: amount, dayLimit, monthLimit,
 * dayTtl, monthTtl, resvTtl, reservationValue. Returns 1 reserved, 0 refused, 2 already held.
 */
const RESERVE_LUA = `
if redis.call('EXISTS', KEYS[3]) == 1 then return 2 end
local d = tonumber(redis.call('GET', KEYS[1]) or '0')
local m = tonumber(redis.call('GET', KEYS[2]) or '0')
local a = tonumber(ARGV[1])
if d + a > tonumber(ARGV[2]) or m + a > tonumber(ARGV[3]) then return 0 end
redis.call('INCRBY', KEYS[1], a)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('INCRBY', KEYS[2], a)
redis.call('EXPIRE', KEYS[2], ARGV[5])
redis.call('SET', KEYS[3], ARGV[7], 'EX', ARGV[6])
return 1`;

/**
 * Settle: replace the reserved amount with the actual cost on the SAME day/month counters the
 * reservation used. KEYS: reservation. ARGV: actual, prefix. Returns the delta applied, or -1
 * when no reservation exists (already settled or expired — then nothing is changed here and the
 * ledger stays authoritative).
 */
const SETTLE_LUA = `
local v = redis.call('GET', KEYS[1])
if not v then return -1 end
local amt, day, month = string.match(v, '^(%d+)|(%d+)|(%d+)$')
local delta = tonumber(ARGV[1]) - tonumber(amt)
redis.call('INCRBY', ARGV[2] .. 'd:' .. ARGV[3] .. ':' .. day, delta)
redis.call('INCRBY', ARGV[2] .. 'm:' .. ARGV[3] .. ':' .. month, delta)
redis.call('DEL', KEYS[1])
return delta`;

const PREFIX = 'karen:ai:usage:';
const DAY_TTL = 2 * 86_400;
const MONTH_TTL = 33 * 86_400;
const RESERVATION_TTL = 3_600;

export interface SettleInput {
  userId: string;
  reservationKey: string;
  costMicroUsd: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Per-user daily/monthly AI spend limits (ADR-0023).
 *
 * - Redis holds fast counters (micro-USD) and per-generation reservations. A generation
 *   reserves `CHAT_REQUEST_RESERVE_USD` BEFORE any AI call and settles to the actual cost.
 * - Postgres `platform.usage_ledger` is authoritative. Missing Redis counters (eviction,
 *   failover) are re-seeded from the ledger before any decision, so a Redis restart cannot
 *   reset anyone's limits.
 * - Fail closed (ADR-0013): if Redis is unavailable, no generation starts.
 * The AI service's service-wide daily budget and the gateway's own hard budget remain as
 * second and third layers.
 */
@Injectable()
export class UsageLimitsService {
  private readonly logger = new Logger(UsageLimitsService.name);
  readonly dailyLimitMicro: number;
  readonly monthlyLimitMicro: number;
  readonly reserveMicro: number;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.dailyLimitMicro = usdToMicro(env.CHAT_DAILY_LIMIT_USD);
    this.monthlyLimitMicro = usdToMicro(env.CHAT_MONTHLY_LIMIT_USD);
    this.reserveMicro = usdToMicro(env.CHAT_REQUEST_RESERVE_USD);
  }

  private keys(userId: string, now: Date) {
    const p = usagePeriods(now);
    return {
      ...p,
      dayKey: `${PREFIX}d:${userId}:${p.day}`,
      monthKey: `${PREFIX}m:${userId}:${p.month}`,
    };
  }

  private reservationKey = (key: string) => `${PREFIX}r:${key}`;

  /** Seeds missing counters from the authoritative ledger (SET NX: never clobbers live ones). */
  private async seed(userId: string, now: Date) {
    const k = this.keys(userId, now);
    const [dayExists, monthExists] = await Promise.all([
      this.redis.client.exists(k.dayKey),
      this.redis.client.exists(k.monthKey),
    ]);
    if (dayExists && monthExists) return k;
    const rows = await this.prisma.withUserScope(userId, (tx) =>
      tx.usageLedgerEntry.findMany({
        where: { userId, periodStart: { gte: k.monthStart } },
        select: { periodStart: true, costMicroUsd: true },
      }),
    );
    const month = rows.reduce((sum, r) => sum + r.costMicroUsd, 0n);
    const day = rows
      .filter((r) => r.periodStart.getTime() === k.dayStart.getTime())
      .reduce((sum, r) => sum + r.costMicroUsd, 0n);
    await Promise.all([
      this.redis.client.set(k.dayKey, day.toString(), 'EX', DAY_TTL, 'NX'),
      this.redis.client.set(k.monthKey, month.toString(), 'EX', MONTH_TTL, 'NX'),
    ]);
    return k;
  }

  private unavailable(error: unknown): never {
    this.logger.error({ err: error }, 'Usage limiter unavailable; refusing (fail closed)');
    throw new ApiError(
      'DEPENDENCY_UNAVAILABLE',
      'KAREN can’t check your usage right now, so it won’t start an answer. Please try again shortly.',
      { retryable: true, cause: error },
    );
  }

  /**
   * Reserves the worst-case cost of one generation. Idempotent per `reservationKey`.
   * Returns true when THIS call created the reservation and false when a concurrent request
   * with the same key already holds it — only the creator may `release` it on failure, or a
   * losing duplicate would free the winner's in-flight reservation.
   * Throws USAGE_LIMIT_REACHED (with reset times) or DEPENDENCY_UNAVAILABLE.
   */
  async reserve(
    userId: string,
    reservationKey: string,
    now = new Date(),
    amountMicro: number = this.reserveMicro,
  ): Promise<boolean> {
    let result: unknown;
    let k: ReturnType<UsageLimitsService['keys']>;
    try {
      k = await this.seed(userId, now);
      result = await this.redis.client.eval(
        RESERVE_LUA,
        3,
        k.dayKey,
        k.monthKey,
        this.reservationKey(reservationKey),
        amountMicro,
        this.dailyLimitMicro,
        this.monthlyLimitMicro,
        DAY_TTL,
        MONTH_TTL,
        RESERVATION_TTL,
        `${amountMicro}|${k.day}|${k.month}`,
      );
    } catch (error) {
      this.unavailable(error);
    }
    if (result === 0) {
      const usage = await this.usage(userId, now).catch(() => null);
      const resetsAt = usage?.daily.limit_reached === false ? usage.monthly.resets_at : k.dayReset;
      throw new ApiError(
        'USAGE_LIMIT_REACHED',
        'You’ve reached your chat limit for now. It resets automatically.',
        {
          retryable: false,
          nextOptions: [`RESETS_AT:${new Date(resetsAt).toISOString()}`],
        },
      );
    }
    return result === 1;
  }

  /** Releases a reservation that never led to an AI call (e.g. the transaction failed). */
  async release(userId: string, reservationKey: string): Promise<void> {
    await this.settleCounters(userId, reservationKey, 0);
  }

  /**
   * Adds a finished generation to the authoritative ledger. Called INSIDE the transaction that
   * writes the message's terminal state (exactly-once with the answer).
   */
  async recordInLedger(
    tx: TransactionClient,
    input: Omit<SettleInput, 'reservationKey'> & {
      /** L-10: which counter this call increments (cost is always combined). Default chat. */
      kind?: 'chat' | 'memory_extraction';
    },
    now = new Date(),
  ): Promise<void> {
    const { dayStart } = usagePeriods(now);
    const extraction = input.kind === 'memory_extraction';
    await tx.usageLedgerEntry.upsert({
      where: { userId_periodStart: { userId: input.userId, periodStart: dayStart } },
      create: {
        userId: input.userId,
        periodStart: dayStart,
        costMicroUsd: BigInt(input.costMicroUsd),
        inputTokens: BigInt(input.inputTokens ?? 0),
        outputTokens: BigInt(input.outputTokens ?? 0),
        requests: extraction ? 0 : 1,
        memoryExtractionRequests: extraction ? 1 : 0,
      },
      update: {
        costMicroUsd: { increment: BigInt(input.costMicroUsd) },
        inputTokens: { increment: BigInt(input.inputTokens ?? 0) },
        outputTokens: { increment: BigInt(input.outputTokens ?? 0) },
        ...(extraction
          ? { memoryExtractionRequests: { increment: 1 } }
          : { requests: { increment: 1 } }),
      },
    });
  }

  /**
   * Replaces the reservation with the actual cost on the fast counters. Never throws: a Redis
   * failure here is logged, and the next `seed` after counter expiry reconciles from the ledger.
   */
  async settleCounters(
    userId: string,
    reservationKey: string,
    costMicroUsd: number,
    now = new Date(),
  ): Promise<void> {
    try {
      const applied = await this.redis.client.eval(
        SETTLE_LUA,
        1,
        this.reservationKey(reservationKey),
        costMicroUsd,
        PREFIX,
        userId,
      );
      if (applied === -1 && costMicroUsd > 0) {
        // Reservation already gone: count the actual cost directly.
        const k = this.keys(userId, now);
        await this.redis.client
          .multi()
          .incrby(k.dayKey, costMicroUsd)
          .incrby(k.monthKey, costMicroUsd)
          .exec();
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Usage counter settle failed; ledger is authoritative');
    }
  }

  /** Current usage as ratios (money is not exposed to clients). */
  async usage(userId: string, now = new Date()): Promise<AiUsage> {
    let day = 0;
    let month = 0;
    let k: ReturnType<UsageLimitsService['keys']>;
    try {
      k = await this.seed(userId, now);
      const [d, m] = await this.redis.client.mget(k.dayKey, k.monthKey);
      day = Number(d ?? 0);
      month = Number(m ?? 0);
    } catch (error) {
      this.unavailable(error);
    }
    const window = (used: number, limit: number, resets: Date) => ({
      used_ratio: Math.round(Math.min(used / limit, 1) * 1000) / 1000,
      limit_reached: used + this.reserveMicro > limit,
      resets_at: resets.toISOString(),
    });
    return {
      daily: window(day, this.dailyLimitMicro, k.dayReset),
      monthly: window(month, this.monthlyLimitMicro, k.monthReset),
      gateway_mode: await this.ai.gatewayMode(),
    };
  }
}
