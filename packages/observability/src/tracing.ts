/**
 * Optional OpenTelemetry + Sentry bootstrap. Both are no-ops unless configured, so local
 * startup never depends on observability credentials. Import and call this FIRST in a
 * service entrypoint (before importing instrumented libraries).
 */
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import * as Sentry from '@sentry/node';

export interface TelemetryConfig {
  serviceName: string;
  environment: string;
  otlpEndpoint?: string | undefined;
  sentryDsn?: string | undefined;
  sentryTracesSampleRate?: number;
}

export interface TelemetryHandle {
  tracingEnabled: boolean;
  errorReportingEnabled: boolean;
  shutdown(): Promise<void>;
}

export function initTelemetry(config: TelemetryConfig): TelemetryHandle {
  let sdk: NodeSDK | undefined;
  if (config.otlpEndpoint) {
    const base = config.otlpEndpoint.replace(/\/$/, '');
    sdk = new NodeSDK({
      serviceName: config.serviceName,
      traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
      // Latency histograms + DB pool gauges (metrics.ts); p95/p99 computed by the backend.
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
          exportIntervalMillis: 60_000,
        }),
      ],
      instrumentations: [
        new HttpInstrumentation({
          // Health probes are noise; never trace them.
          ignoreIncomingRequestHook: (req) => (req.url ?? '').startsWith('/health'),
        }),
      ],
    });
    sdk.start();
  }
  if (config.sentryDsn) {
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.environment,
      tracesSampleRate: config.sentryTracesSampleRate ?? 0,
      // Privacy-first: never ship bodies, cookies, user info, query strings or AI
      // inputs/outputs to the error tracker (spec SEC-06). Sentry v11 defaults are permissive.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: {
          request: { allow: ['user-agent', 'content-type', 'x-request-id'] },
          response: false,
        },
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
      },
    });
  }
  return {
    tracingEnabled: sdk !== undefined,
    errorReportingEnabled: Boolean(config.sentryDsn),
    async shutdown() {
      await Promise.allSettled([
        sdk?.shutdown(),
        config.sentryDsn ? Sentry.close(2000) : undefined,
      ]);
    },
  };
}

export const captureException = (error: unknown): void => {
  if (Sentry.isInitialized()) Sentry.captureException(error);
};
