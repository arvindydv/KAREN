import { SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

export const SENSITIVE_RATE_LIMIT = 'karen:sensitiveRateLimit';

/**
 * Applies the strict `sensitive` throttler (in addition to the default one) to a route or
 * controller. Use for authentication, OTP, account recovery, approval decisions and any other
 * abuse-critical endpoint. The `sensitive` limiter FAILS CLOSED when Redis is unavailable
 * (ADR-0013) — the request gets a retryable 503 instead of unlimited attempts.
 */
export const SensitiveRateLimit = () => SetMetadata(SENSITIVE_RATE_LIMIT, true);

/** `skipIf` predicate for the `sensitive` throttler: only routes opted in above are counted. */
export const isNotSensitiveRoute = (context: ExecutionContext): boolean => {
  const onHandler: unknown = Reflect.getMetadata(SENSITIVE_RATE_LIMIT, context.getHandler());
  const onClass: unknown = Reflect.getMetadata(SENSITIVE_RATE_LIMIT, context.getClass());
  return onHandler !== true && onClass !== true;
};
