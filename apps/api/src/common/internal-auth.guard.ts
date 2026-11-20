import { createHash } from 'node:crypto';
import { INTERNAL_SIGNATURE_HEADER } from '@karen/ai-model-contracts';
import { internalRequestSigningString, verifyTimestamped } from '@karen/domain/node';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';
import { ApiError } from './api-error.js';

const TOLERANCE_SECONDS = 300;

/**
 * Authenticates service-to-service calls to /internal/* (ADR-0007): timestamped HMAC over
 * `METHOD\npath?query\nsha256(body)` with INTERNAL_SERVICE_HMAC_SECRET, ±5 min tolerance, and
 * replay rejection inside the window (Redis SET NX; Redis down ⇒ deny). Internal routes are
 * also blocked at the edge (ALB path rules); this guard is the authoritative check.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly logger = new Logger(InternalAuthGuard.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const secret = this.env.INTERNAL_SERVICE_HMAC_SECRET;
    const deny = (reason: string) => {
      this.logger.warn({ reason }, 'Rejected internal request');
      return new ApiError('UNAUTHENTICATED', 'Authentication is required.');
    };
    if (!secret) throw deny('not_configured');
    const header = request.headers[INTERNAL_SIGNATURE_HEADER];
    const body =
      typeof request.body === 'string'
        ? request.body
        : request.body
          ? JSON.stringify(request.body)
          : '';
    const result = verifyTimestamped({
      secret,
      payload: internalRequestSigningString(request.method, request.url, body),
      header: Array.isArray(header) ? header[0] : header,
      nowUnixSeconds: Math.floor(Date.now() / 1000),
      toleranceSeconds: TOLERANCE_SECONDS,
    });
    if (!result.ok) throw deny(result.reason);
    const key = `karen:internal-replay:${createHash('sha256').update(String(header)).digest('hex').slice(0, 40)}`;
    let fresh: string | null;
    try {
      fresh = await this.redis.client.set(key, '1', 'EX', TOLERANCE_SECONDS * 2, 'NX');
    } catch (error) {
      this.logger.warn({ err: error }, 'Replay store unavailable; denying internal request');
      throw new ApiError('DEPENDENCY_UNAVAILABLE', 'Temporarily unavailable.', { retryable: true });
    }
    if (fresh !== 'OK') throw deny('replayed');
    return true;
  }
}
