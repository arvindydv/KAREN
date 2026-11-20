/**
 * Temporal worker bootstrap (task queue karen-tasks). Graceful shutdown: the Temporal
 * runtime traps SIGINT/SIGTERM, stops polling, lets in-flight tasks finish, then exits.
 */
import { createRequire } from 'node:module';
import { TASK_QUEUES } from '@karen/domain';
import { createLogger } from '@karen/observability';
import { initTelemetry } from '@karen/observability/tracing';
import { NativeConnection, Worker } from '@temporalio/worker';
import { createDataRightsActivities } from './activities/data-rights-activities.js';
import { createTaskActivities } from './activities/task-activities.js';
import { loadWorkerEnv } from './env.js';
import { startHealthServer } from './health.js';

const env = loadWorkerEnv();
const log = createLogger({
  service: 'karen-temporal-worker',
  environment: env.APP_ENV,
  level: env.LOG_LEVEL,
});
const telemetry = initTelemetry({
  serviceName: 'karen-temporal-worker',
  environment: env.APP_ENV,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  sentryDsn: env.SENTRY_DSN,
});

const connection = await NativeConnection.connect({
  address: env.TEMPORAL_ADDRESS,
  tls: env.TEMPORAL_TLS_ENABLED,
  ...(env.TEMPORAL_API_KEY ? { apiKey: env.TEMPORAL_API_KEY } : {}),
});

const worker = await Worker.create({
  connection,
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: TASK_QUEUES.TASKS,
  workflowsPath: createRequire(import.meta.url).resolve('./workflows/index.js'),
  activities: {
    ...createTaskActivities(),
    ...createDataRightsActivities({
      apiBaseUrl: env.API_INTERNAL_URL,
      secret: env.INTERNAL_SERVICE_HMAC_SECRET,
    }),
  },
  maxConcurrentActivityTaskExecutions: env.TEMPORAL_MAX_CONCURRENT_ACTIVITIES,
  maxConcurrentWorkflowTaskExecutions: env.TEMPORAL_MAX_CONCURRENT_WORKFLOW_TASKS,
  shutdownGraceTime: '30 seconds',
});

const health = startHealthServer(
  env.TEMPORAL_WORKER_HEALTH_PORT,
  () => worker.getState() === 'RUNNING',
);
log.info(
  { task_queue: TASK_QUEUES.TASKS, namespace: env.TEMPORAL_NAMESPACE },
  'temporal worker starting',
);

try {
  await worker.run();
} finally {
  health.close();
  await connection.close();
  await telemetry.shutdown();
  log.info('temporal worker stopped');
}
