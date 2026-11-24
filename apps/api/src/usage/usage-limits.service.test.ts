import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../common/api-error.js';
import { loadApiEnv } from '../config/env.js';
import type { AiServiceClient } from '../infrastructure/ai/ai-service.client.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import type { RedisService } from '../infrastructure/redis/redis.service.js';
import { UsageLimitsService } from './usage-limits.service.js';

const env = loadApiEnv({
  DATABASE_URL: 'postgresql://x',
  REDIS_URL: 'redis://x',
  AUTH_MODE: 'local-dev',
});
const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('UsageLimitsService (fail closed, ADR-0013)', () => {
  it('refuses to start a generation when Redis is unavailable', async () => {
    const down = new Error('connection refused');
    const redis = {
      client: {
        exists: vi.fn().mockRejectedValue(down),
        eval: vi.fn().mockRejectedValue(down),
      },
    } as unknown as RedisService;
    const service = new UsageLimitsService(
      redis,
      {} as PrismaService,
      { gatewayMode: async () => 'mock' } as unknown as AiServiceClient,
      env,
    );
    const err = await service.reserve(USER, 'k').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('DEPENDENCY_UNAVAILABLE');
    await expect(service.usage(USER)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('settling never throws (the ledger is authoritative)', async () => {
    const redis = {
      client: { eval: vi.fn().mockRejectedValue(new Error('down')) },
    } as unknown as RedisService;
    const service = new UsageLimitsService(redis, {} as PrismaService, {} as AiServiceClient, env);
    await expect(service.settleCounters(USER, 'k', 123)).resolves.toBeUndefined();
  });

  it('converts configured USD limits to micro-units', () => {
    const service = new UsageLimitsService(
      {} as RedisService,
      {} as PrismaService,
      {} as AiServiceClient,
      env,
    );
    expect(service.dailyLimitMicro).toBe(500_000);
    expect(service.monthlyLimitMicro).toBe(5_000_000);
    expect(service.reserveMicro).toBe(100_000);
  });
});

describe('ledger request kind (M5a, L-10)', () => {
  const capture = () => {
    const calls: { create: Record<string, unknown>; update: Record<string, unknown> }[] = [];
    const tx = {
      usageLedgerEntry: {
        upsert: vi.fn(
          async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
            calls.push(args);
            return {};
          },
        ),
      },
    };
    return { calls, tx: tx as unknown as Parameters<UsageLimitsService['recordInLedger']>[0] };
  };
  const service = new UsageLimitsService(
    {} as RedisService,
    {} as PrismaService,
    {} as AiServiceClient,
    env,
  );
  const base = { userId: USER, costMicroUsd: 10, inputTokens: null, outputTokens: null };

  it('chat (default) increments `requests` only', async () => {
    const { calls, tx } = capture();
    await service.recordInLedger(tx, base);
    expect(calls[0]!.create).toMatchObject({ requests: 1, memoryExtractionRequests: 0 });
    expect(calls[0]!.update).toHaveProperty('requests');
    expect(calls[0]!.update).not.toHaveProperty('memoryExtractionRequests');
  });

  it('memory_extraction increments its own counter; cost still combined', async () => {
    const { calls, tx } = capture();
    await service.recordInLedger(tx, { ...base, kind: 'memory_extraction' });
    expect(calls[0]!.create).toMatchObject({
      requests: 0,
      memoryExtractionRequests: 1,
      costMicroUsd: 10n,
    });
    expect(calls[0]!.update).toHaveProperty('memoryExtractionRequests');
    expect(calls[0]!.update).not.toHaveProperty('requests');
    expect(calls[0]!.update).toHaveProperty('costMicroUsd');
  });
});
