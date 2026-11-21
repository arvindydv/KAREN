/**
 * Service metrics (roadmap F00-02: p95/p99 latency, DB pool utilisation).
 *
 * Instruments use the OpenTelemetry API only, so they are free no-ops until `initTelemetry`
 * installs a meter provider with an OTLP endpoint. Percentiles are computed by the metrics
 * backend from the histogram buckets below (CloudWatch/Grafana `histogram_quantile`), never by
 * averaging in-process.
 *
 * Ordering: the OTel JS metrics API has no proxy meter — `initTelemetry` must run BEFORE any
 * instrument is created (service entrypoints import the app only after initialising it).
 *
 * Cardinality / privacy rules: attributes are low-cardinality and never contain user data —
 * route TEMPLATES (`/v1/me`), never raw URLs, IDs or query strings.
 */
import { metrics, ValueType } from '@opentelemetry/api';

/** Seconds. Dense below 1 s so p95/p99 of fast API calls resolve to a useful bucket. */
export const HTTP_DURATION_BUCKETS_S = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2.5, 5, 10,
] as const;

/** Label for requests that matched no route (keeps scanners from exploding cardinality). */
export const UNMATCHED_ROUTE = '__unmatched__';

export interface HttpRequestSample {
  method: string;
  /** Route template from the router, or undefined when no route matched. */
  route: string | undefined;
  statusCode: number;
  durationSeconds: number;
}

export function createHttpServerMetrics(serviceName: string) {
  const histogram = metrics.getMeter(serviceName).createHistogram('http.server.request.duration', {
    description: 'Duration of inbound HTTP requests',
    unit: 's',
    valueType: ValueType.DOUBLE,
    advice: { explicitBucketBoundaries: [...HTTP_DURATION_BUCKETS_S] },
  });
  return {
    record(sample: HttpRequestSample): void {
      if (!Number.isFinite(sample.durationSeconds) || sample.durationSeconds < 0) return;
      histogram.record(sample.durationSeconds, {
        'http.request.method': sample.method.toUpperCase(),
        'http.route': sample.route ?? UNMATCHED_ROUTE,
        'http.response.status_code': sample.statusCode,
      });
    },
  };
}

/** The subset of node-postgres `Pool` used for metrics (kept structural for testability). */
export interface PoolStats {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

/**
 * Observable DB pool metrics (OTel semantic-convention names):
 *   db.client.connection.count{state=idle|used}, db.client.connection.max,
 *   db.client.connection.pending_requests — alert when pending > 0 for a sustained period
 *   or used/max > 0.8.
 */
export function registerDbPoolMetrics(
  serviceName: string,
  poolName: string,
  pool: PoolStats,
  maxConnections: number,
): void {
  const meter = metrics.getMeter(serviceName);
  const attrs = { 'db.client.connection.pool.name': poolName };
  meter
    .createObservableUpDownCounter('db.client.connection.count', {
      description: 'Connections in the pool by state',
      unit: '{connection}',
    })
    .addCallback((result) => {
      result.observe(pool.idleCount, { ...attrs, 'db.client.connection.state': 'idle' });
      result.observe(Math.max(0, pool.totalCount - pool.idleCount), {
        ...attrs,
        'db.client.connection.state': 'used',
      });
    });
  meter
    .createObservableUpDownCounter('db.client.connection.max', {
      description: 'Configured maximum pool size',
      unit: '{connection}',
    })
    .addCallback((result) => result.observe(maxConnections, attrs));
  meter
    .createObservableUpDownCounter('db.client.connection.pending_requests', {
      description: 'Requests waiting for a free connection',
      unit: '{request}',
    })
    .addCallback((result) => result.observe(pool.waitingCount, attrs));
}

/**
 * Estimate a quantile from cumulative-free histogram buckets (same linear interpolation as
 * Prometheus `histogram_quantile`). `counts[i]` is the count for the bucket ending at
 * `boundaries[i]`; the final element is the +Inf bucket. Used for local reports and tests.
 */
export function histogramQuantile(
  q: number,
  boundaries: readonly number[],
  counts: readonly number[],
): number | undefined {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0 || q < 0 || q > 1) return undefined;
  const rank = q * total;
  let seen = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const c = counts[i] ?? 0;
    if (seen + c >= rank && c > 0) {
      const upper = boundaries[i];
      if (upper === undefined) return boundaries[boundaries.length - 1]; // +Inf bucket
      const lower = i === 0 ? 0 : (boundaries[i - 1] ?? 0);
      return lower + (upper - lower) * ((rank - seen) / c);
    }
    seen += c;
  }
  return boundaries[boundaries.length - 1];
}

/**
 * Low-cardinality event counter (e.g. security events). Attributes must come from a fixed
 * vocabulary — never user ids, e-mails, tokens or free text.
 */
export function createEventCounter(serviceName: string, name: string, description: string) {
  const counter = metrics
    .getMeter(serviceName)
    .createCounter(name, { description, valueType: ValueType.INT });
  return {
    add(value: number, attributes: Record<string, string>): void {
      counter.add(value, attributes);
    },
  };
}
