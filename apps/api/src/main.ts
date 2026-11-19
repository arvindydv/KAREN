import { initTelemetry } from '@karen/observability/tracing';
import { loadApiEnv } from './config/env.js';

// Fail fast on invalid configuration before anything else starts.
const env = loadApiEnv();
// Telemetry first so instrumentation patches modules before they are loaded.
const telemetry = initTelemetry({
  serviceName: 'karen-api',
  environment: env.APP_ENV,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  sentryDsn: env.SENTRY_DSN,
  sentryTracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
});

const { createApp } = await import('./bootstrap.js');
const app = await createApp(env);
app
  .getHttpAdapter()
  .getInstance()
  .addHook('onClose', async () => telemetry.shutdown());
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
