import {
  liveResponseSchema,
  readyResponseSchema,
  type LiveResponse,
  type ReadyResponse,
} from '@karen/api-contracts';
import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators.js';
import { ApiZodResponse } from '../common/zod.js';
import { AiServiceClient } from '../infrastructure/ai/ai-service.client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';

const VERSION = process.env.KAREN_BUILD_VERSION ?? 'dev';
type Check = ReadyResponse['checks'][string];

async function probe(fn: () => Promise<unknown>, timeoutMs: number): Promise<Check> {
  const started = performance.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs).unref()),
    ]);
    return { status: 'up', latency_ms: Math.round(performance.now() - started) };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'timeout';
    return { status: 'down', latency_ms: null, error: timedOut ? 'timeout' : 'unreachable' };
  }
}

/**
 * Liveness: process is up and the event loop responsive — never depends on downstreams, so a
 * DB blip does not get healthy containers killed. Readiness: only dependencies REQUIRED to
 * serve requests (PostgreSQL, Redis) gate traffic. The AI service is reported for operators
 * but does not gate readiness: most API routes work without it, and AI routes return a typed
 * DEPENDENCY_UNAVAILABLE error instead.
 */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ai: AiServiceClient,
  ) {}

  @Get('live')
  @ApiZodResponse(200, liveResponseSchema)
  live(): LiveResponse {
    return { status: 'ok', service: 'karen-api', version: VERSION };
  }

  @Get('ready')
  @ApiZodResponse(200, readyResponseSchema, 'All required dependencies are reachable')
  @ApiZodResponse(503, readyResponseSchema, 'A required dependency is unavailable')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadyResponse> {
    const [database, redis, aiService] = await Promise.all([
      probe(() => this.prisma.ping(), 2_000),
      probe(() => this.redis.ping(), 1_000),
      probe(() => this.ai.checkReady(1_000), 1_500),
    ]);
    const required = [database, redis];
    const ready = required.every((c) => c.status === 'up');
    void reply.status(ready ? 200 : 503);
    return readyResponseSchema.parse({
      status: ready ? 'ready' : 'not_ready',
      checks: { database, redis, ai_service_non_critical: aiService },
    });
  }
}
