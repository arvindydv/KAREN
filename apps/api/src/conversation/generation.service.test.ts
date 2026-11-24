import type { MemoryRetrievalService } from '../memory/memory-retrieval.service.js';
import type { MemoryTurnService } from '../memory/memory-turn.service.js';
import { describe, expect, it, vi } from 'vitest';
import { loadApiEnv } from '../config/env.js';
import type { AiServiceClient } from '../infrastructure/ai/ai-service.client.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import { GenerationService } from './generation.service.js';
import type { StreamHub } from './stream-hub.js';
import type { UsageLimitsService } from '../usage/usage-limits.service.js';

const env = loadApiEnv({
  DATABASE_URL: 'postgresql://x',
  REDIS_URL: 'redis://x',
  AUTH_MODE: 'local-dev',
});

const job = {
  userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  userRef: 'usr_ref_test01',
  messageId: '0b7f4f8e-2f7d-4c4e-9a43-2d8c7f1c9a10',
  reservationKey: 'send:user:key-0001',
};

const settledRun = async (service: GenerationService) => {
  for (let i = 0; i < 100 && service.activeCount > 0; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(service.activeCount).toBe(0);
};

describe('GenerationService runner', () => {
  it('gives the usage reservation back when loading the context fails (no AI call made)', async () => {
    const settleCounters = vi.fn().mockResolvedValue(undefined);
    const stream = vi.fn();
    const service = new GenerationService(
      {
        withUserScope: vi.fn().mockRejectedValue(new Error('connection terminated')),
      } as unknown as PrismaService,
      { stream } as unknown as AiServiceClient,
      {} as StreamHub,
      { settleCounters } as unknown as UsageLimitsService,
      {} as MemoryRetrievalService,
      {} as MemoryTurnService,
      env,
    );
    service.start(job);
    await settledRun(service);
    expect(stream).not.toHaveBeenCalled();
    expect(settleCounters).toHaveBeenCalledWith(job.userId, job.reservationKey, 0);
  });

  it('releases the reservation when the message is no longer active', async () => {
    const settleCounters = vi.fn().mockResolvedValue(undefined);
    const service = new GenerationService(
      { withUserScope: vi.fn().mockResolvedValue(null) } as unknown as PrismaService,
      { stream: vi.fn() } as unknown as AiServiceClient,
      {} as StreamHub,
      { settleCounters } as unknown as UsageLimitsService,
      {} as MemoryRetrievalService,
      {} as MemoryTurnService,
      env,
    );
    service.start(job);
    await settledRun(service);
    expect(settleCounters).toHaveBeenCalledWith(job.userId, job.reservationKey, 0);
  });
});
