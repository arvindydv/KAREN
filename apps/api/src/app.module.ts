import { createLogger } from '@karen/observability';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClientIpThrottlerGuard } from './common/client-ip-throttler.guard.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { isNotSensitiveRoute } from './common/rate-limit.js';
import { ConfigModule } from './config/config.module.js';
import type { ApiEnv } from './config/env.js';
import { ConsentModule } from './consent/consent.module.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { AiModule } from './infrastructure/ai/ai.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { MailModule } from './infrastructure/mail/mail.module.js';
import { MemoryModule } from './memory/memory.module.js';
import { RedisThrottlerStorage } from './infrastructure/redis/redis-throttler.storage.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { DataRightsModule } from './data-rights/data-rights.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { TemporalModule } from './infrastructure/temporal/temporal.module.js';
import { PolicyModule } from './policy/policy.module.js';
import { SecurityModule } from './security/security.module.js';
import { StaffModule } from './staff/staff.module.js';

const stripQuery = (url: string | undefined): string => (url ?? '').split('?', 1)[0] ?? '';

/**
 * Root module. Domain modules (conversations, memory, goals, tasks, approvals, providers,
 * notifications, billing) are added with their features — see
 * docs/architecture/service-boundaries.md for ownership and allowed dependencies.
 */
@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRoot({
          pinoHttp: {
            logger: createLogger({
              service: 'karen-api',
              environment: env.APP_ENV,
              level: env.LOG_LEVEL,
            }),
            autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
            customProps: () => ({}),
            serializers: {
              // Path only: query strings can carry OAuth codes, tokens or personal data.
              req: (req: { id: unknown; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: stripQuery(req.url),
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
          },
        }),
        ThrottlerModule.forRootAsync({
          imports: [RedisModule],
          inject: [RedisThrottlerStorage],
          useFactory: (storage: RedisThrottlerStorage) => ({
            throttlers: [
              { name: 'default', ttl: 60_000, limit: env.API_RATE_LIMIT_PER_MINUTE },
              // Strict, fail-closed limiter for routes decorated with @SensitiveRateLimit().
              {
                name: 'sensitive',
                ttl: 60_000,
                limit: env.API_SENSITIVE_RATE_LIMIT_PER_MINUTE,
                skipIf: isNotSensitiveRoute,
              },
            ],
            storage,
          }),
        }),
        DatabaseModule,
        RedisModule,
        MailModule,
        AiModule,
        AuditModule,
        SecurityModule,
        IdentityModule,
        ConsentModule,
        OnboardingModule,
        TemporalModule,
        DataRightsModule,
        MemoryModule,
        ConversationModule,
        PolicyModule,
        AuthModule.forRoot(env),
        HealthModule,
        StaffModule.forRoot(env),
      ],
      providers: [
        // Guard order: rate limit first (cheap), then AuthGuard/PermissionsGuard from AuthModule.
        { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
