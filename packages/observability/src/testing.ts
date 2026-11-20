/**
 * TEST-ONLY helpers: an in-memory OpenTelemetry meter provider so services can assert on the
 * metrics they emit without a collector. Never import from production code.
 */
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';

export interface InMemoryMetrics {
  collect(): Promise<ResourceMetrics>;
  shutdown(): Promise<void>;
}

export function installInMemoryMetrics(): InMemoryMetrics {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  return {
    async collect() {
      const { resourceMetrics } = await reader.collect();
      return resourceMetrics;
    },
    async shutdown() {
      await provider.shutdown();
      metrics.disable();
    },
  };
}
export type { Histogram, ResourceMetrics } from '@opentelemetry/sdk-metrics';
