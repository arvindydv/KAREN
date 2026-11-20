import {
  baseServiceEnv,
  internalAuthEnv,
  isDeployedEnv,
  loadEnv,
  observabilityEnv,
  port,
  temporalEnv,
} from '@karen/config';
import { z } from 'zod';

export const loadWorkerEnv = (source: Record<string, string | undefined> = process.env) =>
  loadEnv(
    {
      ...baseServiceEnv,
      ...temporalEnv,
      ...observabilityEnv,
      ...internalAuthEnv,
      /** Base URL of the API's internal endpoints (data-rights steps, M7). */
      API_INTERNAL_URL: z.string().url().default('http://localhost:4100'),
      TEMPORAL_WORKER_HEALTH_PORT: port(4300),
      TEMPORAL_MAX_CONCURRENT_ACTIVITIES: z.coerce.number().int().min(1).max(500).default(50),
      TEMPORAL_MAX_CONCURRENT_WORKFLOW_TASKS: z.coerce.number().int().min(1).max(500).default(50),
    },
    {
      source,
      rules: [
        (env) =>
          (env.APP_ENV === 'staging' || env.APP_ENV === 'production') && !env.TEMPORAL_TLS_ENABLED
            ? 'TEMPORAL_TLS_ENABLED must be true in staging/production (Temporal Cloud)'
            : undefined,
        (env) =>
          isDeployedEnv(env.APP_ENV) && (env.INTERNAL_SERVICE_HMAC_SECRET?.length ?? 0) < 32
            ? 'INTERNAL_SERVICE_HMAC_SECRET: required (>= 32 chars) when deployed'
            : undefined,
      ],
    },
  );

export type WorkerEnv = ReturnType<typeof loadWorkerEnv>;
