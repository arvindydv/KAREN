import { TASK_QUEUES } from '@karen/domain';
import { createLogger } from '@karen/observability';
import { initTelemetry } from '@karen/observability/tracing';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Redis } from 'ioredis';
import { createProviderActivities } from './activities.js';
import { MockSandboxAdapter } from './adapters/mock-sandbox.adapter.js';
import { ProviderRegistry } from './adapters/registry.js';
import { loadProviderWorkerEnv, sandboxAllowed } from './env.js';
import { buildServer } from './server.js';
import { LoggingInboundEventSink } from './webhooks/inbound-sink.js';
import { RedisReplayGuard } from './webhooks/replay-guard.js';

const env = loadProviderWorkerEnv();
const log = createLogger({
  service: 'karen-provider-worker',
  environment: env.APP_ENV,
  level: env.LOG_LEVEL,
});
const telemetry = initTelemetry({
  serviceName: 'karen-provider-worker',
  environment: env.APP_ENV,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  sentryDsn: env.SENTRY_DSN,
});

// Real adapters are added here only with approved credentials, contracts and documentation.
const adapters =
  sandboxAllowed(env) && env.MOCK_PROVIDER_WEBHOOK_SECRET
    ? [new MockSandboxAdapter({ webhookSecret: env.MOCK_PROVIDER_WEBHOOK_SECRET })]
    : [];
const registry = new ProviderRegistry({ allowSandbox: sandboxAllowed(env) }, adapters);

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
redis.on('error', (e: Error) => log.warn({ message: e.message }, 'redis error'));

const connection = await NativeConnection.connect({
  address: env.TEMPORAL_ADDRESS,
  tls: env.TEMPORAL_TLS_ENABLED,
  ...(env.TEMPORAL_API_KEY ? { apiKey: env.TEMPORAL_API_KEY } : {}),
});
const worker = await Worker.create({
  connection,
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: TASK_QUEUES.PROVIDER_OPERATIONS,
  activities: createProviderActivities(registry),
  // Bounded concurrency protects partner rate limits.
  maxConcurrentActivityTaskExecutions: 20,
  shutdownGraceTime: '30 seconds',
});

const server = buildServer({
  registry,
  replayGuard: new RedisReplayGuard(redis),
  sink: new LoggingInboundEventSink(log),
  log,
  isReady: () => worker.getState() === 'RUNNING' && redis.status === 'ready',
});
await server.listen({ port: env.PROVIDER_WORKER_PORT, host: '0.0.0.0' });
log.info(
  { providers: registry.list().map((p) => `${p.id}:${p.environment}`) },
  'provider worker started',
);

try {
  await worker.run();
} finally {
  await server.close();
  redis.disconnect();
  await connection.close();
  await telemetry.shutdown();
  log.info('provider worker stopped');
}
