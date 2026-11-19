import 'reflect-metadata';
import helmet from '@fastify/helmet';
import { enterCorrelation, normaliseRequestId } from '@karen/observability';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { ApiEnv } from './config/env.js';

export function buildOpenApiDocument(app: NestFastifyApplication) {
  const config = new DocumentBuilder()
    .setTitle('KAREN API')
    .setDescription(
      'KAREN public API (v1). Wire format: snake_case JSON. Errors use the standard envelope.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Creates a fully configured (not yet listening) application. Shared by main, tests and OpenAPI emit. */
export async function createApp(
  env: ApiEnv,
  options: { logger?: boolean } = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: env.API_BODY_LIMIT_BYTES,
    // Trust exactly the configured number of proxy hops; never the client-supplied left-most XFF.
    trustProxy: (_address: string, hop: number) => hop < env.API_TRUSTED_PROXY_HOPS,
    requestIdHeader: false,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
      normaliseRequestId(req.headers['x-request-id']),
    // We use our own structured logger.
    logger: false,
    return503OnClosing: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    bufferLogs: options.logger !== false,
    abortOnError: false,
    ...(options.logger === false ? { logger: false as const } : {}),
  });
  if (options.logger !== false) app.useLogger(app.get(Logger));

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    enterCorrelation({ request_id: String(request.id) });
    void reply.header('x-request-id', request.id);
    done();
  });

  await app.register(helmet, {
    // JSON API: strict CSP; docs UI (non-prod only) needs inline assets.
    contentSecurityPolicy: env.API_DOCS_ENABLED
      ? false
      : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts:
      env.APP_ENV === 'local' || env.APP_ENV === 'test'
        ? false
        : { maxAge: 31_536_000, includeSubDomains: true },
  });

  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || env.API_CORS_ALLOWED_ORIGINS.includes(origin)),
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id', 'idempotency-key'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (env.API_DOCS_ENABLED) {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
      jsonDocumentUrl: 'docs/openapi.json',
    });
  }
  return app;
}
